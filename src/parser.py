"""
parser.py — Parse les fichiers source en DataFrame pandas.
Supporte : csv/txt/dat (délimité ou fixed_width), json, xlsx.
Fonctions avancées : record_filter, max_columns.
"""
import io
import csv
import json
import unicodedata
import pandas as pd
from config_loader import ConfigError


def _clean_name(s: str) -> str:
    """Normalise un nom de colonne : NFC, strip BOM et espaces non-standard."""
    s = unicodedata.normalize("NFC", s)
    return s.replace("\ufeff", "").replace("\xa0", " ").replace("\u200b", "").strip()


def _fix_encoding_artifact(s: str) -> str:
    """Tente de corriger un nom décodé avec le mauvais encodage.
    Cas : bytes UTF-8 interprétés comme latin-1 → réencode latin-1, décode UTF-8."""
    try:
        return s.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s


def _encoding_candidates(declared: str) -> list[str]:
    """Retourne l'encodage déclaré + fallbacks dans l'ordre d'essai.
    utf-8-sig est toujours essayé en premier pour gérer le BOM automatiquement."""
    enc = declared.lower().replace("-", "").replace("_", "")
    candidates = [declared]
    # Ajouter utf-8-sig si utf-8 déclaré (gère le BOM Excel)
    if enc in ("utf8", "utf8sig"):
        candidates = ["utf-8-sig", "utf-8"] + [c for c in candidates if c not in ("utf-8-sig", "utf-8")]
    # Fallbacks universels
    for fb in ("utf-8-sig", "utf-8", "windows-1252", "latin-1"):
        if fb not in candidates:
            candidates.append(fb)
    return candidates


def parse_file(file_bytes: bytes, src_cfg: dict) -> pd.DataFrame:
    fmt      = src_cfg.get("format", "csv").lower()
    encoding = src_cfg.get("encoding", "utf-8")
    try:
        if fmt == "json":
            return _parse_json(file_bytes, encoding, src_cfg)
        if fmt == "jsonl":
            return _parse_jsonl(file_bytes, encoding, src_cfg)
        if fmt == "xlsx":
            return _parse_xlsx(file_bytes, src_cfg)
        return _parse_text(file_bytes, src_cfg, encoding)
    except ConfigError:
        raise
    except Exception as e:
        raise ConfigError(f"Erreur de parsing ({src_cfg.get('label','?')}) : {e}")


# ── JSON / JSONL ──────────────────────────────────────────────
def _dot_get(obj, path: str):
    """Descend dans obj en suivant un chemin dot-notation ('a.b.c')."""
    for key in path.lstrip(".").split("."):
        if not key or not isinstance(obj, dict):
            return None
        obj = obj.get(key)
        if obj is None:
            return None
    return obj


def _apply_fields(records: list, fields_cfg: list) -> pd.DataFrame:
    """Construit un DataFrame en extrayant les champs configurés depuis les enregistrements."""
    if not fields_cfg:
        return pd.DataFrame(records)
    rows = []
    for rec in records:
        row = {}
        for fc in fields_cfg:
            name  = fc["name"]
            fpath = fc.get("path") or name
            row[name] = _dot_get(rec, fpath) if "." in fpath else rec.get(fpath)
        rows.append(row)
    return pd.DataFrame(rows)


def _decode_text(data: bytes, encoding: str) -> str:
    for enc in _encoding_candidates(encoding):
        try:
            return data.decode(enc).lstrip("\ufeff")
        except (UnicodeDecodeError, LookupError):
            continue
    return data.decode("latin-1")


def _parse_json(data: bytes, encoding: str, src_cfg: dict = None) -> pd.DataFrame:
    src_cfg = src_cfg or {}
    text = _decode_text(data, encoding)
    obj = json.loads(text)

    json_path = src_cfg.get("json_path", "")
    if json_path:
        records = _dot_get(obj, json_path)
        if not isinstance(records, list):
            raise ConfigError(f"json_path '{json_path}' ne pointe pas vers un tableau JSON.")
    elif isinstance(obj, list):
        records = obj
    else:
        records = next(
            (obj[k] for k in ("records", "data", "items", "rows") if isinstance(obj.get(k), list)),
            [obj],
        )
    return _apply_fields(records, src_cfg.get("fields") or [])


def _parse_jsonl(data: bytes, encoding: str, src_cfg: dict = None) -> pd.DataFrame:
    src_cfg = src_cfg or {}
    text = _decode_text(data, encoding)
    records = []
    for line in text.splitlines():
        line = line.strip()
        if line:
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                pass  # ligne invalide ignorée
    return _apply_fields(records, src_cfg.get("fields") or [])


# ── XLSX ──────────────────────────────────────────────────────
def _parse_xlsx(data: bytes, cfg: dict) -> pd.DataFrame:
    sheet    = cfg.get("sheet_name", 0)
    skip     = cfg.get("skip_rows", 0)
    has_hdr  = cfg.get("has_header", True)
    header_row = skip if has_hdr else None
    fields   = cfg.get("fields", [])
    usecols  = [f["name"] for f in fields] if fields else None
    df = pd.read_excel(
        io.BytesIO(data), sheet_name=sheet,
        header=header_row, skiprows=0 if has_hdr else skip,
        dtype=str, keep_default_na=False
    )
    if usecols:
        missing = [c for c in usecols if c not in df.columns]
        if missing:
            raise ConfigError(f"Colonnes XLSX manquantes : {', '.join(missing)}. Disponibles : {', '.join(df.columns)}")
        df = df[usecols]
    return df


# ── Texte délimité / fixed-width ──────────────────────────────
def _parse_text(data: bytes, cfg: dict, encoding: str) -> pd.DataFrame:
    # Tenter le décodage avec l'encodage déclaré, puis fallbacks courants
    for enc in _encoding_candidates(encoding):
        try:
            text = data.decode(enc)
            break
        except (UnicodeDecodeError, LookupError):
            continue
    else:
        raise ConfigError(
            f"Impossible de décoder le fichier (encodage déclaré : {encoding}). "
            "Essayez utf-8, utf-8-sig, latin-1 ou windows-1252."
        )
    # Supprimer le BOM quelle que soit l'encodage déclaré
    text = text.lstrip("\ufeff")
    delimiter = cfg.get("delimiter", ",")
    has_hdr   = cfg.get("has_header", True)
    skip_rows = cfg.get("skip_rows", 0)
    fixed_w   = cfg.get("fixed_width", False)
    max_cols  = cfg.get("max_columns", None)
    rec_filter= cfg.get("record_filter", {})
    marker_re = None
    if rec_filter and rec_filter.get("marker"):
        import re
        marker_re = re.compile(rec_filter["marker"])

    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    lines = lines[skip_rows:]
    lines = [l for l in lines if l.strip()]

    if marker_re:
        before = len(lines)
        lines  = [l for l in lines if marker_re.search(l)]
        if not lines:
            raise ConfigError(
                f"record_filter.marker '{rec_filter['marker']}' : "
                f"aucune ligne correspondante sur {before} testées."
            )

    if not lines:
        raise ConfigError("Le fichier est vide après filtrage.")

    # ── Fixed-width ───────────────────────────────────────────
    if fixed_w:
        positions = cfg.get("column_positions", [])
        if not positions:
            raise ConfigError("fixed_width: true requiert column_positions avec width.")
        records = []
        for i, line in enumerate(lines):
            row = {}
            for p in positions:
                start = p["position"]
                end   = start + p["width"] if "width" in p else p.get("end", len(line))
                if start > len(line):
                    raise ConfigError(
                        f"Ligne {i+1} trop courte ({len(line)} car.) "
                        f"pour le champ '{p['name']}' (position {start})."
                    )
                row[p["name"]] = line[start:end].strip()
            records.append(row)
        return pd.DataFrame(records)

    # ── Délimité ──────────────────────────────────────────────
    if has_hdr:
        fields    = cfg.get("fields", [])
        wanted    = [f["name"] for f in fields]
        # Header sans limite de colonnes — normaliser les noms (BOM, NFC, espaces)
        hdr_cells = [_clean_name(h) for h in _split_line(lines[0], delimiter, None)]
        n_hdr     = len(hdr_cells)
        limit     = max_cols if max_cols else n_hdr

        # Résolution de la colonne pour chaque champ déclaré :
        # 1. Lookup par nom (avec correction d'artefact d'encodage) — permet de
        #    sélectionner des colonnes spécifiques dans un fichier plus large.
        # 2. Si au moins un champ n'est pas trouvé par nom → mapping positionnel
        #    pour tous les champs (config = surcharge des headers du fichier).
        col_idx   = {}
        use_positional = False
        for i, name in enumerate(wanted):
            name_clean = _clean_name(name)
            matches = [j for j, h in enumerate(hdr_cells) if h == name_clean]
            if not matches:
                name_fixed = _fix_encoding_artifact(name_clean)
                if name_fixed != name_clean:
                    matches = [j for j, h in enumerate(hdr_cells) if h == name_fixed]
            if not matches:
                use_positional = True
                break
            col_idx[name] = matches[0]

        if use_positional:
            # Les noms config ne correspondent pas aux headers : mapping positionnel
            if len(wanted) > n_hdr:
                raise ConfigError(
                    f"Mapping positionnel : {len(wanted)} champs déclarés mais seulement "
                    f"{n_hdr} colonnes dans le fichier."
                )
            col_idx = {name: i for i, name in enumerate(wanted)}

        records    = []
        _dbg_shown = 0  # lignes problématiques affichées
        for line_no, line in enumerate(lines[1:]):
            cells = _split_line(line, delimiter, limit)
            row   = {}
            _missing = []
            for name in wanted:
                idx = col_idx[name]
                if idx < len(cells):
                    row[name] = cells[idx].strip()
                else:
                    row[name] = ""
                    _missing.append((name, idx))
            if _missing and _dbg_shown < 3:
                import os
                if os.environ.get("FLASK_DEBUG") or os.environ.get("DA_DEBUG"):
                    print(f"[parser debug] ligne {line_no+2}  n_cells={len(cells)}  limit={limit}  n_hdr={n_hdr}")
                    print(f"  champs manquants (idx >= n_cells) : {_missing}")
                    print(f"  début ligne : {repr(line[:120])}")
                    print(f"  cells[:{min(len(cells),8)}] : {cells[:8]}")
                    _dbg_shown += 1
            records.append(row)
        return pd.DataFrame(records)
    else:
        positions = cfg.get("column_positions", [])
        if not positions:
            # Pas de column_positions → utiliser fields comme mapping positionnel (0-indexé)
            positions = [{"name": f["name"], "position": i}
                         for i, f in enumerate(cfg.get("fields", []))]
        records   = []
        for line in lines:
            cells = _split_line(line, delimiter, None)
            row   = {}
            for p in positions:
                idx = p["position"]
                row[p["name"]] = cells[idx].strip() if idx < len(cells) else ""
            records.append(row)
        return pd.DataFrame(records)


def _split_line(line: str, delimiter: str, limit: int | None) -> list[str]:
    """Split CSV avec gestion des guillemets et limite de colonnes.

    Conforme à la spec RFC 4180 : un champ est quoté uniquement s'il commence
    immédiatement par '"' (juste après un délimiteur ou en début de ligne).
    Un '"' apparaissant au milieu d'un champ non quoté est traité comme un
    caractère ordinaire — ce qui évite de rentrer en mode in_q sur un blob
    JSON/texte libre qui contient des guillemets internes.
    """
    result    = []
    cur       = ""
    in_q      = False
    field_start = True   # True juste après un délimiteur (ou au début)

    for i, ch in enumerate(line):
        if ch == '"' and field_start:
            # Ouverture d'un champ quoté (guillemet en tout début de champ)
            in_q = True
            field_start = False
        elif ch == '"' and in_q:
            # À l'intérieur d'un champ quoté : guillemet doublé ou fermeture
            if i + 1 < len(line) and line[i + 1] == '"':
                cur += '"'          # guillemet littéral ""
            else:
                in_q = False        # fermeture du champ quoté
        elif ch == delimiter and not in_q:
            if limit and len(result) >= limit - 1:
                cur += line[i:]     # absorber le reste de la ligne
                break
            result.append(cur)
            cur = ""
            field_start = True
        else:
            cur += ch
            field_start = False

    result.append(cur)
    return result
