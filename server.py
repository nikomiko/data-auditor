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
import os
import time
import threading
import uuid
from flask import Flask, request, jsonify, send_file, send_from_directory, Response, stream_with_context

from config_loader import load_config, ConfigError
from parser        import parse_file
from normalizer    import normalize_dataframe
from unpivot       import unpivot_dataframe
from comparator    import compare_with_progress
import report
from report        import save_history, list_history, load_history, to_csv, to_html, to_xlsx

app = Flask(__name__, static_folder=".", static_url_path="")

# ── Stockage session ──────────────────────────────────────────
# Token → {status, results, summary, config, queue}
_sessions: dict = {}
_sessions_lock  = threading.Lock()

MAX_PREVIEW = 500   # lignes max en mémoire pour l'UI


@app.route("/")
def index():
    return send_from_directory(".", "index.html")


@app.route("/docs/<path:filename>")
def serve_docs(filename):
    return send_from_directory("docs", filename)


@app.route("/sample/<path:filename>")
def serve_sample(filename):
    """Téléchargement des fichiers exemples."""
    ALLOWED = {"test_audit_demo.yaml", "test_reference.dat", "test_target.csv"}
    if filename not in ALLOWED:
        return jsonify({"error": "Fichier non disponible."}), 404
    return send_from_directory(".", filename, as_attachment=True)


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
            "status":  "running",
            "results": [],
            "summary": {},
            "config":  config,
            "events":  [],          # buffer d'événements SSE
            "done":    False,
            "error":   None,
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
        df_ref = normalize_dataframe(df_ref, src_ref)
        df_tgt = normalize_dataframe(df_tgt, src_tgt)

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

        def _make_key(row_dict, cols):
            def _p(v):
                if v is None or (isinstance(v, float) and v != v): return ""
                s = str(v).strip()
                return "" if s in ("nan", "NaT", "None", "<NA>") else s
            return "§".join(_p(row_dict.get(c)) for c in cols)

        def _row_dict(row):
            return {c: ('' if str(v) in ('nan', 'NaT', 'None', '<NA>') else str(v))
                    for c, v in row.items()}

        ref_rows_map = {}
        for _, row in df_ref.iterrows():
            k = _make_key(row.to_dict(), ref_key_cols)
            if k not in ref_rows_map:
                ref_rows_map[k] = _row_dict(row)

        tgt_rows_map = {}
        for _, row in df_tgt.iterrows():
            k = _make_key(row.to_dict(), tgt_key_cols)
            if k not in tgt_rows_map:
                tgt_rows_map[k] = _row_dict(row)

        sess["ref_rows_map"]    = ref_rows_map
        sess["tgt_rows_map"]    = tgt_rows_map
        sess["all_keys_sorted"] = sorted(set(ref_rows_map) | set(tgt_rows_map))

        # Historisation
        history_file = save_history(results, summary, config)
        _push(token, {"event": "done", "history_file": history_file,
                      "total_results": len(results)})

    except (ConfigError, Exception) as e:
        msg = str(e)
        sess["error"] = msg
        _push(token, {"event": "error", "message": msg})
    finally:
        sess["done"] = True


def apply_filters(df_ref, df_tgt, filters, config):
    """
    Filtre chaque source par les valeurs déclarées dans 'filters'.
    Pas de propagation croisée : les orphelins restent visibles dans le comparateur.
    """
    for f in filters:
        field  = f.get("field")
        src    = f.get("source", "reference")
        values = f.get("values")
        if not field or values is None:
            continue
        values_set = set(str(v) for v in values)

        if src == "reference":
            if field not in df_ref.columns:
                raise ConfigError(f"filters: champ '{field}' introuvable dans la reference.")
            df_ref = df_ref[df_ref[field].astype(str).isin(values_set)].reset_index(drop=True)
        elif src == "target":
            if field not in df_tgt.columns:
                raise ConfigError(f"filters: champ '{field}' introuvable dans la cible.")
            df_tgt = df_tgt[df_tgt[field].astype(str).isin(values_set)].reset_index(drop=True)
    return df_ref, df_tgt


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
#  GET /api/export  — CSV ou HTML
# ─────────────────────────────────────────────────────────────
@app.route("/api/export")
def export():
    token  = request.args.get("token", "")
    fmt    = request.args.get("format", "csv").lower()
    with _sessions_lock:
        sess = _sessions.get(token, {})

    results = sess.get("results", [])
    summary = sess.get("summary", {})
    config  = sess.get("config", {})

    if fmt == "csv":
        content = "\ufeff" + to_csv(results)   # BOM pour Excel
        return send_file(
            io.BytesIO(content.encode("utf-8")),
            mimetype="text/csv", as_attachment=True,
            download_name="rapport_audit.csv"
        )
    elif fmt == "html":
        content = to_html(results, summary, config)
        return send_file(
            io.BytesIO(content.encode("utf-8")),
            mimetype="text/html", as_attachment=True,
            download_name="rapport_audit.html"
        )
    elif fmt == "xlsx":
        content = to_xlsx(results, summary, config)
        return send_file(
            io.BytesIO(content),
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            as_attachment=True, download_name="rapport_audit.xlsx"
        )
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

        df_ref = normalize_dataframe(parse_file(ref_bytes, src_ref), src_ref)
        df_tgt = normalize_dataframe(parse_file(tgt_bytes, src_tgt), src_tgt)

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

        def _key_part(v) -> str:
            if v is None or (isinstance(v, float) and v != v):
                return ""
            s = str(v).strip()
            return "" if s in ("nan", "NaT", "None", "<NA>") else s

        def make_key(row, cols):
            return "§".join(_key_part(row.get(c) if hasattr(row, "get") else (row[c] if c in row.index else None)) for c in cols)

        ref_map = {}
        for _, row in df_ref.iterrows():
            k = make_key(row, ref_cols)
            if k not in ref_map:
                ref_map[k] = {c: str(row.get(c, "")) for c in ref_cols}

        tgt_map = {}
        for _, row in df_tgt.iterrows():
            k = make_key(row, tgt_cols)
            if k not in tgt_map:
                tgt_map[k] = {c: str(row.get(c, "")) for c in tgt_cols}

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
        })
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
        max_p   = data.get("meta", {}).get("config", {}).get(
            "report", {}
        ).get("max_diff_preview", MAX_PREVIEW)
        return jsonify({
            "summary":       data.get("summary", {}),
            "results":       results[:max_p],
            "truncated":     len(results) > max_p,
            "total_results": len(results),
            "config":        data.get("meta", {}).get("config", {}),
            "token":         None,
        })
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404


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


if __name__ == "__main__":
    print("=" * 55)
    print("  DataAuditor v2 — serveur Flask")
    print("  → http://localhost:5000")
    print("=" * 55)
    app.run(debug=False, host="0.0.0.0", port=5000, threaded=True)
