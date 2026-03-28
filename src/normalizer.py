"""
normalizer.py — Normalisation des valeurs selon les types déclarés.
"""
import unicodedata
import pandas as pd
from config_loader import ConfigError, get_field_map


def _clean_str(s: str) -> str:
    """Normalisation Unicode NFC + remplacement des espaces non-standard."""
    s = unicodedata.normalize("NFC", s)
    # Remplacer les variantes d'espaces (non-breakable, fine, em, etc.)
    s = s.replace("\xa0", " ").replace("\u202f", " ").replace("\u2009", " ") \
         .replace("\u200b", "").replace("\ufeff", "")
    return s.strip()


def normalize_dataframe(df: pd.DataFrame, src_cfg: dict, debug: bool = False) -> pd.DataFrame:
    df        = df.copy()
    field_map = get_field_map(src_cfg)
    for col in df.columns:
        fdef  = field_map.get(col, {})
        ftype = fdef.get("type", "string")
        try:
            if ftype == "skip":
                continue   # champ lu mais non normalisé (blob, opaque, etc.)
            if ftype == "string":
                raw = df[col]
                # where(notna, "") → NaN reste "" (pas "nan") avant astype(str)
                normalized = (raw.where(raw.notna(), other="")
                                 .astype(str).map(_clean_str))
                if debug:
                    n_empty_before = int(raw.isna().sum())
                    n_empty_after  = int((normalized == "").sum())
                    n_changed      = int((raw.astype(str) != normalized).sum())
                    print(f"[norm debug] col={col!r}  dtype_avant={raw.dtype}  "
                          f"NaN_avant={n_empty_before}  vides_après={n_empty_after}  "
                          f"valeurs_modifiées={n_changed}")
                    # Lignes dont la valeur est devenue "" après normalisation
                    became_empty = normalized == ""
                    if became_empty.any():
                        print(f"  → {became_empty.sum()} valeurs devenues vides :")
                        sample = raw[became_empty].head(10)
                        for idx, v in sample.items():
                            print(f"    [{idx}] {repr(v)}")
                    # Échantillon des 5 premières valeurs avant/après
                    print(f"  Échantillon (5 premières lignes) :")
                    for idx in df.index[:5]:
                        print(f"    [{idx}] {repr(raw[idx])} → {repr(normalized[idx])}")
                df[col] = normalized
            elif ftype == "date":
                fmt = fdef.get("date_format", "%Y-%m-%d")
                df[col] = pd.to_datetime(
                    df[col].astype(str).str.strip(), format=fmt, errors="coerce"
                )
            elif ftype == "decimal":
                df[col] = (df[col].astype(str).str.strip()
                           .str.replace(",", ".", regex=False))
                df[col] = pd.to_numeric(df[col], errors="coerce")
            elif ftype == "integer":
                df[col] = pd.to_numeric(
                    df[col].astype(str).str.strip(), errors="coerce"
                ).astype("Int64")
            elif ftype == "boolean":
                mapping = {
                    "true": True, "1": True, "yes": True, "oui": True,
                    "false": False, "0": False, "no": False, "non": False,
                }
                df[col] = (df[col].astype(str).str.strip().str.lower()
                           .map(mapping))
        except Exception as e:
            raise ConfigError(f"Normalisation '{col}' (type={ftype}) : {e}")
    return df


def apply_comparison_norm(val, rule: str):
    if pd.isna(val) or val is None:
        return None
    s = str(val)
    if rule in ("trim", "both"):
        s = s.strip()
    if rule in ("lowercase", "both"):
        s = s.lower()
    return s
