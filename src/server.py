"""
server.py — Serveur Flask avec streaming SSE pour la progression.

Endpoints :
  POST /api/audit          → lance l'audit (multipart : file_ref, file_tgt, config_yaml)
  GET  /api/stream/<token> → flux SSE de progression et résultats
  GET  /api/export         → export CSV ou HTML (?format=csv|html)
  GET  /api/history        → liste des audits
  GET  /api/history/<f>    → charge un audit historisé
"""
import io
import json
import math
import os
from datetime import datetime
import socket
import sys
import time
import threading
import uuid
import webbrowser
from flask import Flask, request, jsonify, send_file, send_from_directory, Response, stream_with_context

from config_loader import load_config, ConfigError
from parser        import parse_file
from normalizer    import normalize_dataframe
from calculator    import evaluate_calculated_fields
from unpivot       import unpivot_dataframe
from comparator    import compare_with_progress, _build_key_series
from filters       import apply_filters as _apply_filters_base
import report
from report        import save_history, list_history, load_history, to_csv, to_html, to_xlsx
import settings as _settings_mod
from settings      import load_settings, save_settings, resolve_path

APP_VERSION = "3.30.0"

# ── Résolution des chemins (dev vs frozen PyInstaller) ────────
# _BASE_DIR : ressources statiques (index.html, static/, docs/, sample/)
#             → dans _MEIPASS quand frozen (répertoire d'extraction temporaire)
# _DATA_DIR : données persistantes (reports/)
#             → à côté du .exe quand frozen (survit aux mises à jour)
if getattr(sys, "frozen", False):
    _BASE_DIR = sys._MEIPASS
    _DATA_DIR = os.path.dirname(sys.executable)
else:
    _SRC_DIR  = os.path.dirname(os.path.abspath(__file__))   # …/src
    _BASE_DIR = os.path.dirname(_SRC_DIR)                    # …/ (repo root)
    _DATA_DIR = _BASE_DIR

# Synchroniser report.REPORTS_DIR avec _DATA_DIR
report.REPORTS_DIR = os.path.join(_DATA_DIR, "reports")

# Synchroniser settings.SETTINGS_FILE avec _DATA_DIR
_settings_mod.SETTINGS_FILE = os.path.join(_DATA_DIR, "settings.json")

app = Flask(__name__, static_folder=_BASE_DIR, static_url_path="")

# ── Stockage session ──────────────────────────────────────────
# Token → {status, results, summary, config, queue}
_sessions: dict = {}
_sessions_lock  = threading.Lock()

MAX_PREVIEW = 500   # lignes max en mémoire pour l'UI


@app.route("/api/version")
def api_version():
    return jsonify({"version": APP_VERSION})


@app.route("/")
def index():
    return send_from_directory(_BASE_DIR, "index.html")


@app.route("/docs/<path:filename>")
def serve_docs(filename):
    return send_from_directory(os.path.join(_BASE_DIR, "docs"), filename)


@app.route("/sw.js")
def service_worker():
    """Service Worker servi depuis la racine (scope = /) pour couvrir toute l'app."""
    return send_from_directory(
        os.path.join(_BASE_DIR, "static"), "sw.js",
        mimetype="application/javascript",
    )


@app.route("/manifest.json")
def manifest():
    """Alias racine → /static/manifest.json (pratique pour les PWA scanners)."""
    return send_from_directory(
        os.path.join(_BASE_DIR, "static"), "manifest.json",
        mimetype="application/manifest+json",
    )


@app.route("/sample/<path:filename>")
def serve_sample(filename):
    """Téléchargement des fichiers exemples."""
    ALLOWED = {"test_audit_demo.yaml", "test_reference.dat", "test_target.csv",
               "test_unpivot.yaml", "unpivot_ref.csv", "unpivot_target.csv"}
    if filename not in ALLOWED:
        return jsonify({"error": "Fichier non disponible."}), 404
    sample_dir = os.path.join(_BASE_DIR, "sample")
    if not os.path.exists(os.path.join(sample_dir, filename)):
        sample_dir = _BASE_DIR   # fallback : fichiers à la racine
    return send_from_directory(sample_dir, filename, as_attachment=True)


# ─────────────────────────────────────────────────────────────
#  POST /api/validate  — valide la config YAML (sans lancer l'audit)
# ─────────────────────────────────────────────────────────────
@app.route("/api/validate", methods=["POST"])
def validate_config():
    """Valide la configuration YAML.

    Body (multipart ou form) :
        config_yaml : texte YAML obligatoire
        file_ref    : fichier optionnel — si fourni, vérifie les noms de champs de jointure
        file_tgt    : fichier optionnel — idem pour la cible

    Returns :
        {"valid": true}
        {"valid": false, "errors": ["…"]}
    """
    config_yaml = request.form.get("config_yaml", "")
    if not config_yaml.strip():
        return jsonify({"valid": False, "errors": ["config_yaml manquant."]}), 400

    errors = []

    # 1. Validation structurelle YAML
    try:
        config = load_config(config_yaml)
    except ConfigError as e:
        return jsonify({"valid": False, "errors": [str(e)]}), 200

    # 2. Validation optionnelle des colonnes si les fichiers sont fournis
    for role, form_key in [("reference", "file_ref"), ("target", "file_tgt")]:
        if form_key not in request.files:
            continue
        try:
            fbytes = request.files[form_key].read()
            src    = config["sources"][role]
            df     = parse_file(fbytes, src)
            df     = normalize_dataframe(df, src)
            df     = evaluate_calculated_fields(df, src)
            if src.get("unpivot"):
                df = unpivot_dataframe(df, src["unpivot"])

            # Vérifier les clés de jointure
            join_keys = config.get("join", {}).get("keys", [])
            fld_key   = "source_field" if role == "reference" else "target_field"
            for jk in join_keys:
                col = jk.get(fld_key)
                if col and col not in df.columns:
                    errors.append(f"Clé de jointure '{col}' introuvable dans la source '{role}'.")

            # Vérifier les champs de règles
            for rule in config.get("rules", []):
                for rf in rule.get("fields", []):
                    fld = rf.get("source_field" if role == "reference" else "target_field")
                    if fld and fld not in df.columns:
                        errors.append(
                            f"Règle '{rule.get('name','')}' : champ '{fld}' introuvable dans '{role}'."
                        )
        except Exception as e:
            errors.append(f"Erreur lors de la lecture de la source '{role}' : {e}")

    if errors:
        return jsonify({"valid": False, "errors": errors}), 200
    return jsonify({"valid": True, "errors": []}), 200


# ─────────────────────────────────────────────────────────────
#  POST /api/preview_calculated  — prévisualise les champs calculés
# ─────────────────────────────────────────────────────────────
@app.route("/api/preview_calculated", methods=["POST"])
def preview_calculated():
    """Parse + normalise + champs calculés d'une source, retourne un aperçu tabulaire.

    Body (multipart) :
        file        : fichier source (obligatoire)
        config_yaml : texte YAML complet (obligatoire)
        role        : 'reference' ou 'target' (défaut: 'reference')
        max_rows    : nombre max de lignes à retourner (défaut: 200)

    Returns :
        {"columns": [...], "calc_columns": [...], "rows": [[...], ...]}
        {"error": "..."}
    """
    if "file" not in request.files:
        return jsonify({"error": "Fichier manquant."}), 400
    config_yaml = request.form.get("config_yaml", "")
    if not config_yaml.strip():
        return jsonify({"error": "config_yaml manquant."}), 400
    role     = request.form.get("role", "reference")
    max_rows = int(request.form.get("max_rows", 200))

    try:
        config = load_config(config_yaml)
    except ConfigError as e:
        return jsonify({"error": str(e)}), 422

    src = config.get("sources", {}).get(role)
    if not src:
        return jsonify({"error": f"Source '{role}' introuvable dans la config."}), 422

    try:
        fbytes = request.files["file"].read()
        df     = parse_file(fbytes, src)
        df     = normalize_dataframe(df, src)
        if src.get("unpivot"):
            df = unpivot_dataframe(df, src["unpivot"])
        df = evaluate_calculated_fields(df, src)
    except ConfigError as e:
        return jsonify({"error": str(e)}), 200
    except Exception as e:
        return jsonify({"error": f"Erreur lors du calcul : {e}"}), 200

    calc_col_names = [cf["name"] for cf in src.get("calculated_fields", []) if cf.get("name")]

    preview_df = df.head(max_rows)

    def _fmt(v):
        if v is None:
            return ""
        if isinstance(v, float):
            if math.isnan(v):
                return ""
            return str(round(v, 2))
        return str(v)

    columns = list(preview_df.columns)
    rows    = [[_fmt(v) for v in row] for row in preview_df.itertuples(index=False)]
    return jsonify({"columns": columns, "calc_columns": calc_col_names, "rows": rows}), 200


# ─────────────────────────────────────────────────────────────
#  POST /api/audit  — démarre l'audit en arrière-plan
# ─────────────────────────────────────────────────────────────
@app.route("/api/audit", methods=["POST"])
def start_audit():
    if "file_ref" not in request.files:
        return jsonify({"error": "Fichier de référence (file_ref) manquant."}), 400
    if "file_tgt" not in request.files:
        return jsonify({"error": "Fichier cible (file_tgt) manquant."}), 400
    config_yaml = request.form.get("config_yaml", "")
    if not config_yaml.strip():
        return jsonify({"error": "config_yaml manquant."}), 400
    run_label = request.form.get("run_label", "").strip()

    file_ref_bytes = request.files["file_ref"].read()
    file_tgt_bytes = request.files["file_tgt"].read()

    # Valider la config avant de démarrer
    try:
        config = load_config(config_yaml)
    except ConfigError as e:
        return jsonify({"error": str(e)}), 422

    token = str(uuid.uuid4())
    with _sessions_lock:
        _sessions[token] = {
            "status":    "running",
            "results":   [],
            "summary":   {},
            "config":    config,
            "run_label": run_label,
            "events":    [],
            "done":      False,
            "error":     None,
        }

    thread = threading.Thread(
        target=_run_audit,
        args=(token, file_ref_bytes, file_tgt_bytes, config),
        daemon=True,
    )
    thread.start()
    return jsonify({"token": token})


def _run_audit(token: str, ref_bytes: bytes, tgt_bytes: bytes, config: dict):
    sess = _sessions[token]
    sess["started_at"] = datetime.now().isoformat()
    try:
        src_ref = config["sources"]["reference"]
        src_tgt = config["sources"]["target"]

        _push(token, {"event": "progress", "done": 0, "total": 0, "pct": 0,
                      "step": "Parsing du fichier de référence…"})
        df_ref = parse_file(ref_bytes, src_ref)

        _push(token, {"event": "progress", "done": 0, "total": 0, "pct": 0,
                      "step": "Parsing du fichier cible…"})
        df_tgt = parse_file(tgt_bytes, src_tgt)

        _push(token, {"event": "progress", "done": 0, "total": 0, "pct": 0,
                      "step": "Normalisation…"})
        df_ref = normalize_dataframe(df_ref, src_ref, debug=app.debug)
        df_tgt = normalize_dataframe(df_tgt, src_tgt, debug=app.debug)

        if src_ref.get("calculated_fields") or src_tgt.get("calculated_fields"):
            _push(token, {"event": "progress", "done": 0, "total": 0, "pct": 0,
                          "step": "Champs calculés…"})
            df_ref = evaluate_calculated_fields(df_ref, src_ref)
            df_tgt = evaluate_calculated_fields(df_tgt, src_tgt)

        if src_ref.get("unpivot"):
            _push(token, {"event": "progress", "done": 0, "total": 0, "pct": 0,
                          "step": "Dep. reference..."})
            df_ref = unpivot_dataframe(df_ref, src_ref["unpivot"])

        if src_tgt.get("unpivot"):
            _push(token, {"event": "progress", "done": 0, "total": 0, "pct": 0,
                          "step": "Dep. cible..."})
            df_tgt = unpivot_dataframe(df_tgt, src_tgt["unpivot"])

        # Filtres YAML appliques avant comparaison
        filters = config.get("filters", [])
        if filters:
            _push(token, {"event": "progress", "done": 0, "total": 0, "pct": 0,
                          "step": "Application des filtres..."})
            df_ref, df_tgt = apply_filters(df_ref, df_tgt, filters, config)
            _push(token, {"event": "filter_counts",
                          "ref_count": len(df_ref),
                          "tgt_count": len(df_tgt)})

        results = []
        summary = {}

        for event in compare_with_progress(df_ref, df_tgt, config):
            if event["event"] == "result":
                results.append(event)
            elif event["event"] == "summary":
                summary = {k: v for k, v in event.items() if k != "event"}
                sess["results"] = results
                sess["summary"] = summary
            _push(token, event)

        # Index des lignes pour la revue côte à côte
        join_keys_cfg = config.get("join", {}).get("keys", [])
        ref_key_cols  = [k["source_field"] for k in join_keys_cfg]
        tgt_key_cols  = [k["target_field"]  for k in join_keys_cfg]

        _NULL_SET = {"nan", "NaT", "None", "<NA>"}

        def _build_rows_map(df, cols):
            """Construit {clé: {col: str_val, ...}} de façon vectorisée."""
            tmp = (
                df.assign(__key=_build_key_series(df, cols))
                  .drop_duplicates("__key")
                  .set_index("__key")
                  .astype(str)
                  .replace(_NULL_SET, "")
            )
            return tmp.to_dict("index")

        ref_rows_map = _build_rows_map(df_ref, ref_key_cols)
        tgt_rows_map = _build_rows_map(df_tgt, tgt_key_cols)

        sess["ref_rows_map"]    = ref_rows_map
        sess["tgt_rows_map"]    = tgt_rows_map
        sess["all_keys_sorted"] = sorted(set(ref_rows_map) | set(tgt_rows_map))
        sess["ref_columns"]     = [c for c in df_ref.columns.tolist() if c not in ref_key_cols]
        sess["tgt_columns"]     = [c for c in df_tgt.columns.tolist() if c not in tgt_key_cols]

        # Historisation
        finished_at = datetime.now().isoformat()
        history_file = save_history(
            results, summary, config,
            run_label   = sess.get("run_label", ""),
            started_at  = sess.get("started_at", ""),
            finished_at = finished_at,
        )
        _push(token, {"event": "done", "history_file": history_file,
                      "total_results": len(results)})

    except (ConfigError, Exception) as e:
        msg = str(e)
        sess["error"] = msg
        _push(token, {"event": "error", "message": msg})
    finally:
        sess["done"] = True


def apply_filters(df_ref, df_tgt, filters, config):
    """Délègue à filters.apply_filters en passant le flag debug Flask."""
    return _apply_filters_base(df_ref, df_tgt, filters, config, debug=app.debug)


def _push(token: str, event: dict):
    with _sessions_lock:
        if token in _sessions:
            _sessions[token]["events"].append(event)


# ─────────────────────────────────────────────────────────────
#  GET /api/stream/<token>  — flux SSE
# ─────────────────────────────────────────────────────────────
@app.route("/api/stream/<token>")
def stream(token: str):
    def generate():
        cursor = 0
        while True:
            with _sessions_lock:
                sess = _sessions.get(token)
                if not sess:
                    yield _sse({"event": "error", "message": "Session introuvable."})
                    return
                events = sess["events"][cursor:]
                cursor += len(events)
                done   = sess["done"]

            for ev in events:
                yield _sse(ev)

            if done and cursor >= len(_sessions.get(token, {}).get("events", [])):
                return

            time.sleep(0.05)

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control":   "no-cache",
            "X-Accel-Buffering": "no",
        }
    )


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


# ─────────────────────────────────────────────────────────────
#  GET /api/results/<token>/meta  — colonnes disponibles + comptages
# ─────────────────────────────────────────────────────────────
@app.route("/api/results/<token>/meta")
def get_results_meta(token):
    with _sessions_lock:
        sess = _sessions.get(token)
    if not sess:
        return jsonify({"error": "Session introuvable"}), 404
    rule_counts = {}
    for r in sess.get("results", []):
        name = r.get("rule_name")
        if name:
            rule_counts[name] = rule_counts.get(name, 0) + 1
    return jsonify({
        "total":       len(sess.get("results", [])),
        "ref_columns": sess.get("ref_columns", []),
        "tgt_columns": sess.get("tgt_columns", []),
        "rule_counts": rule_counts,
    })


# ─────────────────────────────────────────────────────────────
#  GET /api/results/<token>  — résultats paginés + filtrés + triés
# ─────────────────────────────────────────────────────────────
_GRAVITY = {"ORPHELIN_A": 0, "ORPHELIN_B": 1, "KO": 2, "DIVERGENT": 2, "OK": 3, "PRESENT": 4}


@app.route("/api/results/<token>")
def get_results_page(token):
    with _sessions_lock:
        sess = _sessions.get(token)
    if not sess:
        return jsonify({"error": "Session introuvable"}), 404

    page      = max(1, int(request.args.get("page",  1)))
    size      = min(5000, max(1, int(request.args.get("size", 100))))
    sort_col  = request.args.get("sort",  "")
    sort_dir  = request.args.get("dir",   "asc")
    types_str = request.args.get("types", "")
    rules_str   = request.args.get("rules", "")
    rule_logic  = request.args.get("rule_logic", "OR").upper()
    q           = request.args.get("q",     "").lower().strip()
    extra_ref = [c for c in request.args.get("extra_ref", "").split(",") if c]
    extra_tgt = [c for c in request.args.get("extra_tgt", "").split(",") if c]

    raw          = sess.get("results", [])
    # 'types' présent mais vide → aucun type sélectionné → 0 lignes (set vide)
    # 'types' absent → pas de filtre (None = tout afficher)
    if 'types' in request.args:
        active_types = set(t for t in types_str.split(",") if t) if types_str else set()
    else:
        active_types = None
    # 'rules' présent dans la requête = filtre explicite ; absent = pas de filtre
    if 'rules' in request.args:
        active_rules = set(rules_str.split(",")) if rules_str else set()
    else:
        active_rules = None

    # ── Grouper par join_key ──────────────────────────────────
    from collections import OrderedDict
    grouped: dict = OrderedDict()
    for r in raw:
        k = r.get("join_key", "")
        if k not in grouped:
            grouped[k] = {"join_key": k, "ecarts": []}
        grouped[k]["ecarts"].append({
            "type_ecart":       r["type_ecart"],
            "rule_name":        r.get("rule_name"),
            "champ":            r.get("champ", ""),
            "valeur_reference": r.get("valeur_reference", ""),
            "valeur_cible":     r.get("valeur_cible", ""),
        })

    # ── Filtrer ──────────────────────────────────────────────
    def key_matches(row):
        ecarts = row["ecarts"]
        # Filtrage par type
        if active_types is not None:
            ecarts = [e for e in ecarts if e["type_ecart"] in active_types]
        if not ecarts:
            return False
        # Filtrage par règle
        if active_rules is not None:
            # Lignes sans rule_name (orphelins, PRESENT, OK/DIVERGENT de présence)
            # ne dépendent d'aucune règle → bypass du filtre règle
            orphan_ecarts = [e for e in ecarts
                             if e["type_ecart"] in ("ORPHELIN_A", "ORPHELIN_B", "PRESENT")
                             or not e.get("rule_name")]
            # Aucune règle sélectionnée → n'afficher que les orphelins/présents
            if not active_rules:
                return bool(orphan_ecarts)
            rule_ecarts = [e for e in ecarts
                           if e.get("rule_name") in active_rules]
            if rule_logic == "AND":
                # Toutes les règles actives doivent être présentes
                matched = {e.get("rule_name") for e in rule_ecarts}
                if not active_rules.issubset(matched):
                    return bool(orphan_ecarts)  # orphelins passent toujours
            else:
                # OR : au moins une règle présente
                if not rule_ecarts and not orphan_ecarts:
                    return False
        return True

    rows = list(grouped.values())
    if active_types is not None:
        rows = [r for r in rows if key_matches(r)]

    if q:
        ref_rows_map = sess.get("ref_rows_map", {})
        tgt_rows_map = sess.get("tgt_rows_map", {})

        def _row_matches_q(row):
            if q in str(row["join_key"]).lower():
                return True
            for e in row["ecarts"]:
                if q in str(e.get("rule_name") or "").lower():
                    return True
                if q in str(e.get("valeur_reference") or "").lower():
                    return True
                if q in str(e.get("valeur_cible") or "").lower():
                    return True
                if q in str(e.get("champ") or "").lower():
                    return True
            key = row["join_key"]
            for c in extra_ref:
                if q in str(ref_rows_map.get(key, {}).get(c, "")).lower():
                    return True
            for c in extra_tgt:
                if q in str(tgt_rows_map.get(key, {}).get(c, "")).lower():
                    return True
            return False

        rows = [r for r in rows if _row_matches_q(r)]

    # ── Tri ──────────────────────────────────────────────────
    reverse = (sort_dir == "desc")
    if sort_col == "key":
        rows.sort(key=lambda r: str(r["join_key"]).lower(), reverse=reverse)
    elif sort_col.startswith("key_"):
        try:
            _ki = int(sort_col[4:])
        except ValueError:
            _ki = 0
        def _key_part(r, ki=_ki):
            parts = str(r["join_key"] or "").split("§")
            return parts[ki].lower() if ki < len(parts) else ""
        rows.sort(key=_key_part, reverse=reverse)
    elif sort_col == "type":
        rows.sort(
            key=lambda r: min((_GRAVITY.get(e["type_ecart"], 99) for e in r["ecarts"]), default=99),
            reverse=reverse,
        )
    elif sort_col.startswith("xc_ref:") or sort_col.startswith("xc_tgt:"):
        _xc_side, _xc_col = sort_col.split(":", 1)
        _xc_map = sess.get("ref_rows_map" if _xc_side == "xc_ref" else "tgt_rows_map", {})

        def _xc_sort_key(r, _m=_xc_map, _c=_xc_col):
            s = str(_m.get(r["join_key"], {}).get(_c, "") or "").strip()
            if not s:
                return (2, 0.0, "")          # vide → toujours en dernier
            try:
                return (0, float(s.replace(",", ".")), "")   # numérique
            except ValueError:
                return (1, 0.0, s.lower())   # texte / date ISO (tri lexico correct)

        rows.sort(key=_xc_sort_key, reverse=reverse)

    # ── Pagination ───────────────────────────────────────────
    total  = len(rows)
    pages  = max(1, (total + size - 1) // size)
    page   = min(page, pages)
    page_r = rows[(page - 1) * size : page * size]

    # ── Enrichissement colonnes extra ────────────────────────
    if extra_ref or extra_tgt:
        ref_rows_map = sess.get("ref_rows_map", {})
        tgt_rows_map = sess.get("tgt_rows_map", {})
        result_rows = []
        for r in page_r:
            key = r["join_key"]
            row = {"join_key": key, "ecarts": r["ecarts"]}
            if extra_ref:
                row["_ref"] = {c: ref_rows_map.get(key, {}).get(c, "") for c in extra_ref}
            if extra_tgt:
                row["_tgt"] = {c: tgt_rows_map.get(key, {}).get(c, "") for c in extra_tgt}
            result_rows.append(row)
        page_r = result_rows

    return jsonify({"total": total, "page": page, "size": size, "pages": pages, "results": page_r})


# ─────────────────────────────────────────────────────────────
#  GET /api/export  — CSV / XLSX / HTML
# ─────────────────────────────────────────────────────────────

def _filter_results_flat(results, active_types, active_rules, rule_logic,
                         q, extra_ref, extra_tgt, ref_rows_map, tgt_rows_map):
    """Filtre une liste plate d'écarts (même logique que api_results)."""
    if active_types is None and active_rules is None and not q:
        return results

    from collections import defaultdict
    grouped = defaultdict(list)
    for r in results:
        grouped[r.get("join_key", "")].append(r)

    out = []
    for key, ecarts in grouped.items():
        if active_types is not None:
            ecarts = [e for e in ecarts if e.get("type_ecart") in active_types]
        if not ecarts:
            continue

        if active_rules is not None:
            orph_e = [e for e in ecarts
                      if e.get("type_ecart") in ("ORPHELIN_A", "ORPHELIN_B", "PRESENT")
                      or not e.get("rule_name")]
            if not active_rules:
                out.extend(orph_e)
                continue
            rule_e = [e for e in ecarts
                      if e.get("rule_name") in active_rules]
            if rule_logic == "AND":
                matched = {e.get("rule_name") for e in rule_e}
                if not active_rules.issubset(matched):
                    out.extend(orph_e)
                    continue
                ecarts = rule_e + orph_e
            else:
                if not rule_e and not orph_e:
                    continue
                ecarts = rule_e + orph_e

        if q:
            match = q in str(key).lower()
            if not match:
                for e in ecarts:
                    if any(q in str(e.get(f) or "").lower()
                           for f in ("rule_name", "valeur_reference",
                                     "valeur_cible", "champ")):
                        match = True
                        break
            if not match:
                for c in extra_ref:
                    if q in str(ref_rows_map.get(key, {}).get(c, "")).lower():
                        match = True
                        break
            if not match:
                for c in extra_tgt:
                    if q in str(tgt_rows_map.get(key, {}).get(c, "")).lower():
                        match = True
                        break
            if not match:
                continue

        out.extend(ecarts)
    return out


@app.route("/api/export")
def export():
    token  = request.args.get("token", "")
    fmt    = request.args.get("format", "csv").lower()
    with _sessions_lock:
        sess = _sessions.get(token, {})

    results      = sess.get("results", [])
    summary      = sess.get("summary", {})
    config       = sess.get("config", {})
    ref_rows_map = sess.get("ref_rows_map", {})
    tgt_rows_map = sess.get("tgt_rows_map", {})

    extra_ref = [c for c in request.args.get("extra_ref", "").split(",") if c]
    extra_tgt = [c for c in request.args.get("extra_tgt", "").split(",") if c]

    src_ref   = config.get("sources", {}).get("reference", {})
    src_tgt   = config.get("sources", {}).get("target", {})
    ref_label = src_ref.get("label", "Référence")
    tgt_label = src_tgt.get("label", "Cible")
    ref_fmt   = src_ref.get("format", "")
    tgt_fmt   = src_tgt.get("format", "")

    audit_name   = config.get("meta", {}).get("name", "audit").replace(" ", "_")
    _cfg_exports = load_settings().get("folder_default_reports", "")
    _exports_dir = resolve_path(_cfg_exports, _DATA_DIR) if _cfg_exports else None

    def _save_copy(filename: str, data: bytes):
        """Enregistre une copie dans le dossier exports configuré."""
        if not _exports_dir:
            return
        try:
            os.makedirs(_exports_dir, exist_ok=True)
            with open(os.path.join(_exports_dir, filename), "wb") as fh:
                fh.write(data)
        except OSError:
            pass

    if fmt == "csv":
        # Tous les résultats — format pivot-friendly
        content  = "\ufeff" + to_csv(results, config, extra_ref, extra_tgt,
                                     ref_rows_map, tgt_rows_map,
                                     ref_label, tgt_label)
        raw      = content.encode("utf-8")
        ts       = datetime.now().strftime("%Y%m%d%H%M")
        filename = f"audit_{audit_name}_{ts}.csv"
        _save_copy(filename, raw)
        return send_file(io.BytesIO(raw), mimetype="text/csv",
                         as_attachment=True, download_name=filename)

    elif fmt == "xlsx":
        # Tous les résultats — onglet DATA avec autofiltre
        content  = to_xlsx(results, summary, config,
                           extra_ref, extra_tgt, ref_rows_map, tgt_rows_map,
                           ref_label, tgt_label, ref_fmt, tgt_fmt)
        ts       = datetime.now().strftime("%Y%m%d%H%M")
        filename = f"audit_{audit_name}_{ts}.xlsx"
        _save_copy(filename, content)
        return send_file(
            io.BytesIO(content),
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            as_attachment=True, download_name=filename
        )

    elif fmt == "html":
        # Vue courante filtrée — filtres dynamiques conservés dans le HTML
        types_str  = request.args.get("types", "")
        rules_str  = request.args.get("rules", "")
        rule_logic = request.args.get("rule_logic", "OR").upper()
        q          = request.args.get("q", "").lower().strip()

        active_types = set(types_str.split(",")) if types_str else None
        if 'rules' in request.args:
            active_rules = set(rules_str.split(",")) if rules_str else set()
        else:
            active_rules = None

        filtered = _filter_results_flat(
            results, active_types, active_rules, rule_logic, q,
            extra_ref, extra_tgt, ref_rows_map, tgt_rows_map
        )
        content  = to_html(filtered, summary, config,
                           extra_ref, extra_tgt, ref_rows_map, tgt_rows_map,
                           ref_label, tgt_label, ref_fmt, tgt_fmt)
        ts       = datetime.now().strftime("%Y%m%d%H%M")
        filename = f"audit_{audit_name}_{ts}.html"
        raw      = content.encode("utf-8")
        _save_copy(filename, raw)
        return send_file(io.BytesIO(raw), mimetype="text/html",
                         as_attachment=True, download_name=filename)

    return jsonify({"error": "Format invalide."}), 400


# ─────────────────────────────────────────────────────────────
#  POST /api/test-join  — test de jointure (wizard)
# ─────────────────────────────────────────────────────────────
@app.route("/api/test-join", methods=["POST"])
def test_join():
    from config_loader import _Loader as _YamlLoader
    import yaml as pyyaml
    if "file_ref" not in request.files or "file_tgt" not in request.files:
        return jsonify({"error": "Fichiers manquants."}), 400
    config_yaml = request.form.get("config_yaml", "")
    if not config_yaml.strip():
        return jsonify({"error": "config_yaml manquant."}), 400
    try:
        config = pyyaml.load(config_yaml, Loader=_YamlLoader)
    except Exception as e:
        return jsonify({"error": f"YAML invalide : {e}"}), 422

    try:
        src_ref   = config.get("sources", {}).get("reference", {})
        src_tgt   = config.get("sources", {}).get("target", {})
        join_keys = config.get("join", {}).get("keys", [])
        if not join_keys:
            return jsonify({"error": "join.keys manquant ou vide."}), 422

        ref_bytes = request.files["file_ref"].read()
        tgt_bytes = request.files["file_tgt"].read()

        df_ref = normalize_dataframe(parse_file(ref_bytes, src_ref), src_ref, debug=app.debug)
        df_tgt = normalize_dataframe(parse_file(tgt_bytes, src_tgt), src_tgt, debug=app.debug)

        if src_ref.get("unpivot"):
            df_ref = unpivot_dataframe(df_ref, src_ref["unpivot"])
        if src_tgt.get("unpivot"):
            df_tgt = unpivot_dataframe(df_tgt, src_tgt["unpivot"])

        ref_cols = [k["source_field"] for k in join_keys]
        tgt_cols = [k["target_field"] for k in join_keys]

        # Validation des colonnes de jointure (après dépivotage éventuel)
        missing_ref = [c for c in ref_cols if c not in df_ref.columns]
        if missing_ref:
            raise ConfigError(
                f"join.keys : champ(s) introuvable(s) dans la référence : "
                f"{', '.join(missing_ref)}. Disponibles : {', '.join(df_ref.columns)}"
            )
        missing_tgt = [c for c in tgt_cols if c not in df_tgt.columns]
        if missing_tgt:
            raise ConfigError(
                f"join.keys : champ(s) introuvable(s) dans la cible : "
                f"{', '.join(missing_tgt)}. Disponibles : {', '.join(df_tgt.columns)}"
            )

        ref_map = (
            df_ref[ref_cols]
            .assign(__key=_build_key_series(df_ref, ref_cols))
            .drop_duplicates("__key")
            .set_index("__key")
            .astype(str)
            .to_dict("index")
        )
        tgt_map = (
            df_tgt[tgt_cols]
            .assign(__key=_build_key_series(df_tgt, tgt_cols))
            .drop_duplicates("__key")
            .set_index("__key")
            .astype(str)
            .to_dict("index")
        )

        matched_keys = set(ref_map) & set(tgt_map)
        sample = [
            {"key": k, "ref": ref_map[k], "tgt": tgt_map[k]}
            for k in sorted(matched_keys)[:5]
        ]
        return jsonify({
            "total_ref":   len(df_ref),
            "total_tgt":   len(df_tgt),
            "matched":     len(matched_keys),
            "orphelins_a": len(set(ref_map) - set(tgt_map)),
            "orphelins_b": len(set(tgt_map) - set(ref_map)),
            "sample":      sample,
            "keys_ref":    sorted(ref_map.keys())[:20],
            "keys_tgt":    sorted(tgt_map.keys())[:20],
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 422


# ─────────────────────────────────────────────────────────────
#  POST /api/test-filters  — test des filtres (wizard)
# ─────────────────────────────────────────────────────────────
@app.route("/api/test-filters", methods=["POST"])
def test_filters():
    from config_loader import _Loader as _YamlLoader
    import yaml as pyyaml
    if "file" not in request.files:
        return jsonify({"error": "Fichier manquant."}), 400
    config_yaml = request.form.get("config_yaml", "")
    which = request.form.get("source", "reference")  # "reference" ou "target"
    if not config_yaml.strip():
        return jsonify({"error": "config_yaml manquant."}), 400
    try:
        config = pyyaml.load(config_yaml, Loader=_YamlLoader)
    except Exception as e:
        return jsonify({"error": f"YAML invalide : {e}"}), 422

    try:
        src_key = "reference" if which == "reference" else "target"
        src_cfg = config.get("sources", {}).get(src_key, {})
        filters = config.get("filters", [])

        file_bytes = request.files["file"].read()
        df = normalize_dataframe(parse_file(file_bytes, src_cfg), src_cfg, debug=app.debug)

        if src_cfg.get("unpivot"):
            df = unpivot_dataframe(df, src_cfg["unpivot"])

        total = len(df)

        # Appliquer les filtres pour cette source uniquement
        dummy_other = df.iloc[0:0].copy()  # DataFrame vide pour l'autre source
        if which == "reference":
            df_ref, _ = apply_filters(df, dummy_other, filters, config)
            filtered = len(df_ref)
        else:
            _, df_tgt = apply_filters(dummy_other, df, filters, config)
            filtered = len(df_tgt)

        return jsonify({"total": total, "filtered": filtered})
    except Exception as e:
        return jsonify({"error": str(e)}), 422


# ─────────────────────────────────────────────────────────────
#  GET /api/context  — enregistrements contextuels pour la revue
# ─────────────────────────────────────────────────────────────
@app.route("/api/context")
def get_context():
    token = request.args.get("token", "")
    key   = request.args.get("key", "")
    n     = min(int(request.args.get("n", "2")), 20)

    with _sessions_lock:
        sess = _sessions.get(token, {})
        ref_rows_map    = sess.get("ref_rows_map", {})
        tgt_rows_map    = sess.get("tgt_rows_map", {})
        all_keys_sorted = sess.get("all_keys_sorted", [])
        results         = sess.get("results", [])

    # Champs différents pour la clé centrale (pour le surlignage)
    diff_fields = set()
    for r in results:
        if r.get("join_key") == key and r.get("type_ecart") == "DIVERGENT":
            champ = r.get("champ", "")
            if champ:
                # champ peut être "field", "field op field2" — on extrait les deux noms
                parts = champ.split()
                diff_fields.add(parts[0])
                if len(parts) >= 3 and not parts[2].startswith('"'):
                    diff_fields.add(parts[2])

    try:
        center_idx = all_keys_sorted.index(key)
    except ValueError:
        center_idx = 0

    start    = max(0, center_idx - n)
    end      = min(len(all_keys_sorted), center_idx + n + 1)
    ctx_keys = all_keys_sorted[start:end]

    return jsonify({
        "center_key": key,
        "ref_rows": [{"key": k, "data": ref_rows_map.get(k), "is_center": k == key}
                     for k in ctx_keys],
        "tgt_rows": [{"key": k, "data": tgt_rows_map.get(k), "is_center": k == key}
                     for k in ctx_keys],
        "diff_fields": list(diff_fields),
    })


# ─────────────────────────────────────────────────────────────
#  Historique
# ─────────────────────────────────────────────────────────────
@app.route("/api/history")
def get_history():
    return jsonify(list_history())


@app.route("/api/history/<filename>")
def get_history_entry(filename: str):
    try:
        data    = load_history(filename)
        results = data.get("results", [])
        return jsonify({
            "summary":       data.get("summary", {}),
            "results":       results,
            "truncated":     False,
            "total_results": len(results),
            "config":        data.get("meta", {}).get("config", {}),
            "token":         None,
        })
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404


@app.route("/api/history/delta")
def history_delta():
    """Compare deux runs : retourne les écarts apparus, résolus et persistants.

    Query params : a=<filename_ancien> & b=<filename_nouveau>
    La convention est A = ancien run, B = nouveau run.
    """
    import re
    fa = request.args.get("a", "")
    fb = request.args.get("b", "")
    for fn in (fa, fb):
        if not re.match(r'^[\w\-\.]+\.json$', fn):
            return jsonify({"error": f"Nom de fichier invalide : {fn!r}"}), 400
    try:
        da = load_history(fa)
        db = load_history(fb)
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404

    def _sig(r):
        """Signature unique d'un résultat (hors valeurs, seulement la clé fonctionnelle)."""
        return (r.get("join_key",""), r.get("type_ecart",""), r.get("rule_name","") or "")

    set_a = {_sig(r): r for r in da.get("results", []) if r.get("type_ecart") != "OK"}
    set_b = {_sig(r): r for r in db.get("results", []) if r.get("type_ecart") != "OK"}

    keys_a = set(set_a)
    keys_b = set(set_b)

    apparus    = [set_b[k] for k in sorted(keys_b - keys_a)]   # nouveaux dans B
    resolus    = [set_a[k] for k in sorted(keys_a - keys_b)]   # disparus de B (résolus)
    persistants = [set_b[k] for k in sorted(keys_a & keys_b)]  # présents dans les deux

    return jsonify({
        "apparus":     apparus,
        "resolus":     resolus,
        "persistants": persistants,
        "summary_a":   da.get("summary", {}),
        "summary_b":   db.get("summary", {}),
        "meta_a":      {k: v for k, v in da.get("meta", {}).items() if k != "config"},
        "meta_b":      {k: v for k, v in db.get("meta", {}).items() if k != "config"},
    })


@app.route("/api/history/<filename>", methods=["DELETE"])
def delete_history_entry(filename: str):
    import re
    if not re.match(r'^[\w\-\.]+\.json$', filename):
        return jsonify({"error": "Nom de fichier invalide"}), 400
    path = os.path.join(report.REPORTS_DIR, filename)
    if not os.path.exists(path):
        return jsonify({"error": "Introuvable"}), 404
    os.remove(path)
    return jsonify({"ok": True})


@app.route("/api/history", methods=["DELETE"])
def delete_all_history():
    import shutil
    d = report.REPORTS_DIR
    if os.path.isdir(d):
        shutil.rmtree(d)
        os.makedirs(d, exist_ok=True)
    return jsonify({"ok": True})


# ─────────────────────────────────────────────────────────────
#  GET/POST /api/settings
# ─────────────────────────────────────────────────────────────
@app.route("/api/settings", methods=["GET"])
def get_settings():
    return jsonify(load_settings())


@app.route("/api/configs")
def list_configs():
    """Liste les fichiers YAML dans le dossier folder_default_configs."""
    settings = load_settings()
    folder_rel = settings.get("folder_default_configs") or settings.get("folder_default_datasets") or ""
    if not folder_rel:
        return jsonify([])
    folder = resolve_path(folder_rel, _DATA_DIR)
    if not os.path.isdir(folder):
        return jsonify([])
    entries = []
    for fname in sorted(os.listdir(folder)):
        if fname.lower().endswith((".yaml", ".yml")):
            fpath = os.path.join(folder, fname)
            try:
                stat = os.stat(fpath)
                entries.append({
                    "filename": fname,
                    "modified": datetime.fromtimestamp(stat.st_mtime).strftime("%d/%m/%Y %H:%M"),
                    "size_kb":  round(stat.st_size / 1024, 1),
                })
            except OSError:
                pass
    return jsonify(entries)


@app.route("/api/configs/<filename>")
def get_config_file(filename: str):
    """Retourne le contenu d'un fichier YAML de la bibliothèque."""
    import re
    if not re.match(r'^[\w\-\. ]+\.(yaml|yml)$', filename, re.IGNORECASE):
        return jsonify({"error": "Nom de fichier invalide"}), 400
    settings = load_settings()
    folder_rel = settings.get("folder_default_configs") or settings.get("folder_default_datasets") or ""
    if not folder_rel:
        return jsonify({"error": "Dossier de configurations non configuré"}), 404
    folder = resolve_path(folder_rel, _DATA_DIR)
    path = os.path.join(folder, filename)
    if not os.path.isfile(path):
        return jsonify({"error": "Fichier introuvable"}), 404
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    return jsonify({"filename": filename, "content": content})


@app.route("/api/settings", methods=["POST"])
def post_settings():
    data = request.get_json(force=True) or {}
    saved = save_settings(data)
    # Recréer les dossiers si nécessaire
    for key in ("folder_default_datasets", "folder_default_reports", "folder_default_configs"):
        folder = saved.get(key, "")
        if folder:
            path = resolve_path(folder, _DATA_DIR)
            try:
                os.makedirs(path, exist_ok=True)
            except OSError:
                pass
    return jsonify(saved)


def _find_free_port(start: int = 5000) -> int:
    """Retourne le premier port TCP libre à partir de `start`."""
    for port in range(start, start + 50):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", port))
                return port
        except OSError:
            continue
    raise RuntimeError(f"Aucun port disponible entre {start} et {start + 50}.")


def _open_browser_when_ready(url: str, host: str, port: int) -> None:
    """Attend que le serveur réponde puis ouvre le navigateur."""
    def _wait_and_open():
        for _ in range(30):
            try:
                with socket.create_connection((host, port), timeout=0.5):
                    break
            except OSError:
                time.sleep(0.3)
        webbrowser.open(url)
    threading.Thread(target=_wait_and_open, daemon=True).start()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=f"DataAuditor v{APP_VERSION}")
    parser.add_argument("--port",       type=int, default=None,
                        help="Port d'écoute (défaut : premier port libre depuis 5000)")
    parser.add_argument("--host",       default="127.0.0.1",
                        help="Interface d'écoute (défaut : 127.0.0.1)")
    parser.add_argument("--debug",      action="store_true",
                        help="Active les logs de debug filtres")
    parser.add_argument("--no-browser", action="store_true",
                        help="Ne pas ouvrir le navigateur au démarrage")
    args = parser.parse_args()

    port = args.port or _find_free_port()
    url  = f"http://{'localhost' if args.host == '127.0.0.1' else args.host}:{port}"

    W = 58
    print("=" * W)
    print(f"  DataAuditor v{APP_VERSION}")
    print(f"  → {url}")
    print(f"  Rapports  : {report.REPORTS_DIR}")
    if args.debug:
        os.environ["DA_DEBUG"] = "1"
        print("  ⚠  mode DEBUG actif")
    print("=" * W)
    print("  Ctrl+C pour arrêter")
    print()

    if not args.no_browser:
        _open_browser_when_ready(url, args.host, port)

    app.run(debug=args.debug, host=args.host, port=port, threaded=True)
