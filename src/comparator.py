"""
comparator.py — Jointure + détection des écarts avec progression SSE.
Modèle unifié : rule_name + rule_type (ko/ok/_ko/_ok).
Supporte : rules nommées (AND/OR), target_value, source_data/target_data.
"""
import math
from typing import Generator
import pandas as pd
from normalizer import apply_comparison_norm


# Alias pour compatibilité descendante avec les anciens YAML (=, <>, >, <)
_OP_ALIAS = {"=": "equals", "<>": "differs", ">": "greater", "<": "less"}

_OP_LABEL = {"equals": "=", "differs": "≠", "greater": ">", "less": "<",
             "contains": "∋", "not_contains": "∌",
             "matches": "∼", "not_matches": "≁"}


# ── Résolution d'une field-rule ───────────────────────────────
def resolve_field_rule(field_rule: dict, ref_row, tgt_row) -> dict | None:
    """
    Résout une règle de champ en (label, sf, tf, v_ref, v_tgt, tolerance, normalize, operator).
    Supporte syntaxe courte (source_field/target_field/target_value)
    et longue (source_data/target_data).
    """
    op_raw = field_rule.get("operator", "equals")
    op     = _OP_ALIAS.get(op_raw, op_raw)
    op_lbl = _OP_LABEL.get(op, op)

    if "source_field" in field_rule:
        sf    = field_rule["source_field"]
        side_a = field_rule.get("side_a", "reference")
        row_a = ref_row if side_a == "reference" else tgt_row
        v_ref = row_a.get(sf) if row_a is not None else None
        if "target_value" in field_rule:
            v_tgt = field_rule["target_value"]
            tf    = ""
            label = f'{sf} {op_lbl} "{v_tgt}"'
        else:
            tf    = field_rule.get("target_field", sf)
            side_b = field_rule.get("side_b", "target")
            row_b = ref_row if side_b == "reference" else tgt_row
            v_tgt = row_b.get(tf) if row_b is not None else None
            label = sf if op == "equals" else f"{sf} {op_lbl} {tf}"
        return dict(label=label, sf=sf, tf=tf, v_ref=v_ref, v_tgt=v_tgt,
                    tolerance=field_rule.get("tolerance"),
                    tolerance_pct=field_rule.get("tolerance_pct", False),
                    normalize=field_rule.get("normalize", "none"),
                    operator=op)

    if "source_data" in field_rule:
        sd    = field_rule["source_data"]
        td    = field_rule.get("target_data", {})
        sf    = sd.get("field", "") or sd.get("value", "")
        # side_a pour source_data
        side_a = sd.get("source", "reference")
        row_a = ref_row if side_a == "reference" else tgt_row
        v_ref = sd["value"] if "value" in sd else (row_a.get(sf) if row_a is not None else None)
        if "value" in td:
            v_tgt = td["value"]
            tf    = ""
            label = f'{sf} {op_lbl} "{v_tgt}"'
        else:
            tf    = td.get("field", sf)
            # side_b pour target_data
            side_b = td.get("source", "target")
            row_b = ref_row if side_b == "reference" else tgt_row
            v_tgt = row_b.get(tf) if row_b is not None else None
            label = sf if op == "equals" else f"{sf} {op_lbl} {tf}"
        return dict(label=label, sf=sf, tf=tf, v_ref=v_ref, v_tgt=v_tgt,
                    tolerance=td.get("tolerance", sd.get("tolerance")),
                    tolerance_pct=td.get("tolerance_pct", sd.get("tolerance_pct", False)),
                    normalize=sd.get("normalize", "none"),
                    operator=op)
    return None


def _fmt(v) -> str:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return ""
    if isinstance(v, pd.Timestamp):
        return "" if pd.isna(v) else str(v)
    return str(v)


def _is_null(v) -> bool:
    if isinstance(v, pd.Timestamp):
        return pd.isna(v)
    return v is None or (isinstance(v, float) and math.isnan(v)) \
           or str(v).strip() in ("", "nan", "NaT", "None", "<NA>")


def _ts_delta_seconds(a, b) -> float | None:
    """Retourne l'écart en secondes entre deux valeurs datetime, ou None si impossible."""
    try:
        return abs((pd.Timestamp(a) - pd.Timestamp(b)).total_seconds())
    except (ValueError, TypeError):
        return None


# ── Évaluation d'une condition de champ ───────────────────────
def check_field_condition(resolved: dict) -> bool:
    """
    Retourne True quand la condition de l'opérateur est mathématiquement satisfaite :
      equals      : A = B
      differs     : A ≠ B
      greater     : A > B
      less        : A < B
      contains    : B ∈ A
      not_contains: B ∉ A
    """
    v_ref     = resolved["v_ref"]
    v_tgt     = resolved["v_tgt"]
    tolerance = resolved["tolerance"]
    norm      = resolved.get("normalize", "none") or "none"
    op        = resolved["operator"]

    is_ts = isinstance(v_ref, pd.Timestamp) or isinstance(v_tgt, pd.Timestamp)

    if op == "equals":
        if _is_null(v_ref) and _is_null(v_tgt):
            return True
        if _is_null(v_ref) != _is_null(v_tgt):
            return False
        if tolerance is not None:
            if is_ts:
                delta = _ts_delta_seconds(v_ref, v_tgt)
                if delta is not None:
                    return delta <= float(tolerance)
            try:
                if resolved.get("tolerance_pct", False):
                    # Écart relatif (%)
                    return abs(float(v_ref) - float(v_tgt)) / max(abs(float(v_ref)), 1e-9) * 100 <= float(tolerance)
                else:
                    # Écart absolu
                    return abs(float(v_ref) - float(v_tgt)) <= float(tolerance)
            except (ValueError, TypeError):
                pass
        if is_ts:
            try:
                return pd.Timestamp(v_ref) == pd.Timestamp(v_tgt)
            except (ValueError, TypeError):
                return False
        return apply_comparison_norm(v_ref, norm) == apply_comparison_norm(v_tgt, norm)

    if op == "differs":
        if _is_null(v_ref) and _is_null(v_tgt):
            return False
        if _is_null(v_ref) != _is_null(v_tgt):
            return True
        if tolerance is not None:
            if is_ts:
                delta = _ts_delta_seconds(v_ref, v_tgt)
                if delta is not None:
                    return delta > float(tolerance)
            try:
                if resolved.get("tolerance_pct", False):
                    # Écart relatif (%)
                    return abs(float(v_ref) - float(v_tgt)) / max(abs(float(v_ref)), 1e-9) * 100 > float(tolerance)
                else:
                    # Écart absolu
                    return abs(float(v_ref) - float(v_tgt)) > float(tolerance)
            except (ValueError, TypeError):
                pass
        if is_ts:
            try:
                return pd.Timestamp(v_ref) != pd.Timestamp(v_tgt)
            except (ValueError, TypeError):
                return False
        return apply_comparison_norm(v_ref, norm) != apply_comparison_norm(v_tgt, norm)

    if op in ("greater", "less"):
        if _is_null(v_ref) or _is_null(v_tgt):
            return False
        if is_ts:
            try:
                a, b = pd.Timestamp(v_ref), pd.Timestamp(v_tgt)
                return a > b if op == "greater" else a < b
            except (ValueError, TypeError):
                return False
        try:
            a, b = float(str(v_ref)), float(str(v_tgt))
            return a > b if op == "greater" else a < b
        except (ValueError, TypeError):
            return False

    if op == "contains":
        if _is_null(v_ref) or _is_null(v_tgt):
            return False
        return str(apply_comparison_norm(v_tgt, norm)) in str(apply_comparison_norm(v_ref, norm))

    if op == "not_contains":
        if _is_null(v_ref) or _is_null(v_tgt):
            return False
        return str(apply_comparison_norm(v_tgt, norm)) not in str(apply_comparison_norm(v_ref, norm))

    if op in ("matches", "not_matches"):
        import re
        if _is_null(v_ref) or _is_null(v_tgt):
            return False
        try:
            hit = bool(re.search(str(v_tgt), str(apply_comparison_norm(v_ref, norm))))
            return hit if op == "matches" else not hit
        except re.error:
            return False

    return False


def _check_detail(resolved: dict, condition_met: bool) -> str:
    v_ref     = _fmt(resolved["v_ref"])
    v_tgt     = _fmt(resolved["v_tgt"])
    tolerance = resolved["tolerance"]
    tolerance_pct = resolved.get("tolerance_pct", False)
    op        = resolved["operator"]
    sym       = _OP_LABEL.get(op, op)

    rv, tv = resolved["v_ref"], resolved["v_tgt"]
    is_ts  = isinstance(rv, pd.Timestamp) or isinstance(tv, pd.Timestamp)

    if condition_met:
        if op == "equals" and tolerance is not None:
            if is_ts:
                delta = _ts_delta_seconds(rv, tv)
                if delta is not None:
                    return f"Condition {sym} vérifiée — écart : {delta:.3f}s ≤ {tolerance}s"
            try:
                delta = abs(float(rv) - float(tv))
                if tolerance_pct:
                    pct = delta / max(abs(float(rv)), 1e-9) * 100
                    return f"Condition {sym} vérifiée — écart : {pct:.2f}% ≤ {tolerance}%"
                else:
                    return f"Condition {sym} vérifiée — écart : {delta:.4f} ≤ {tolerance}"
            except (ValueError, TypeError):
                pass
        return f'Condition {sym} vérifiée : "{v_ref}" {sym} "{v_tgt}"'
    else:
        if op in ("equals", "differs") and tolerance is not None:
            if is_ts:
                delta = _ts_delta_seconds(rv, tv)
                if delta is not None:
                    return f"Écart : {delta:.3f}s (tolérance : {tolerance}s)"
            try:
                delta = abs(float(rv) - float(tv))
                if tolerance_pct:
                    pct = delta / max(abs(float(rv)), 1e-9) * 100
                    return f"Écart : {pct:.2f}% (tolérance : {tolerance}%)"
                else:
                    return f"Écart : {delta:.4f} (tolérance : {tolerance})"
            except (ValueError, TypeError):
                pass
        return f'"{v_ref}" {sym} "{v_tgt}" — condition non vérifiée'


# ── Construction vectorisée des maps de jointure ──────────────
_NULL_STRS = {"nan", "NaT", "None", "<NA>", ""}


def _build_key_series(df: pd.DataFrame, cols: list) -> "pd.Series":
    """Construit une Series de clés de jointure de façon vectorisée (×10–50 vs iterrows)."""
    parts = []
    for c in cols:
        s = df[c].fillna("").astype(str).str.strip()
        s = s.where(~s.isin(_NULL_STRS), "")
        parts.append(s)
    if len(parts) == 1:
        return parts[0]
    result = parts[0].copy()
    for p in parts[1:]:
        result = result + "§" + p
    return result


def _build_key_map(df: pd.DataFrame, cols: list) -> dict:
    """Retourne {clé: row_dict} en dédupliquant sur la première occurrence."""
    return (
        df.assign(__key=_build_key_series(df, cols))
          .drop_duplicates("__key")
          .set_index("__key")
          .to_dict("index")
    )


# ── Comparaison principale avec générateur de progression ─────
def compare_with_progress(
    df_ref: pd.DataFrame,
    df_tgt: pd.DataFrame,
    config: dict
) -> Generator[dict, None, None]:
    """
    Générateur qui yield des événements de progression et de résultats.
    Chaque événement est un dict avec un champ 'event' :
      - 'progress' : {done, total, pct, step}
      - 'result'   : ligne de résultat audit
      - 'summary'  : récapitulatif final
      - 'error'    : message d'erreur
    """
    join_cfg = config.get("join", {})
    rules    = config.get("rules", [])

    join_keys    = join_cfg.get("keys", [])
    ref_key_cols = [k["source_field"] for k in join_keys]
    tgt_key_cols = [k["target_field"] for k in join_keys]

    # ── Validation des colonnes de jointure ────────────────────
    # Effectuée après dépivotage éventuel : les colonnes disponibles peuvent
    # différer des champs déclarés dans la config source.
    from config_loader import ConfigError
    missing_ref = [c for c in ref_key_cols if c not in df_ref.columns]
    if missing_ref:
        raise ConfigError(
            f"join.keys : champ(s) introuvable(s) dans la référence (après dépivotage éventuel) : "
            f"{', '.join(missing_ref)}. Colonnes disponibles : {', '.join(df_ref.columns)}"
        )
    missing_tgt = [c for c in tgt_key_cols if c not in df_tgt.columns]
    if missing_tgt:
        raise ConfigError(
            f"join.keys : champ(s) introuvable(s) dans la cible (après dépivotage éventuel) : "
            f"{', '.join(missing_tgt)}. Colonnes disponibles : {', '.join(df_tgt.columns)}"
        )

    # ── Construction des clés de jointure (vectorisé) ─────────
    yield {"event": "progress", "done": 0, "total": 0, "pct": 0,
           "step": "Construction des index de jointure…"}

    ref_map = _build_key_map(df_ref, ref_key_cols)
    tgt_map = _build_key_map(df_tgt, tgt_key_cols)

    ref_keys = set(ref_map.keys())
    tgt_keys = set(tgt_map.keys())
    all_keys = sorted(ref_keys | tgt_keys)
    total    = len(all_keys)

    yield {"event": "progress", "done": 0, "total": total, "pct": 0,
           "step": f"Comparaison de {total} clés…"}

    results        = []
    oa = ob = ok = 0
    divergent_keys = set()
    rule_ko_keys   = {r["name"]: set() for r in rules}

    BATCH = max(1, total // 200)

    for i, key in enumerate(all_keys):

        if i % BATCH == 0 or i == total - 1:
            pct = round((i + 1) / total * 100, 1)
            yield {"event": "progress", "done": i + 1, "total": total,
                   "pct": pct, "step": f"Traitement clé {i+1}/{total}…"}

        in_ref  = key in ref_keys
        in_tgt  = key in tgt_keys
        ref_row = ref_map.get(key)
        tgt_row = tgt_map.get(key)

        # ── Orphelins ──────────────────────────────────────────
        if not in_tgt:
            r = {"join_key": key, "rule_id": -1, "rule_name": "Source uniq.", "rule_type": "_ko",
                 "source_field": "", "target_field": "", "source_value": "", "target_value": "",
                 "detail": "Clé présente dans la référence, absente dans la cible"}
            results.append(r); yield {"event": "result", **r}; oa += 1
            continue

        if not in_ref:
            r = {"join_key": key, "rule_id": -2, "rule_name": "Cible uniq.", "rule_type": "_ko",
                 "source_field": "", "target_field": "", "source_value": "", "target_value": "",
                 "detail": "Clé présente dans la cible, absente dans la référence"}
            results.append(r); yield {"event": "result", **r}; ob += 1
            continue

        row_results = []

        # ── Named rules ────────────────────────────────────────
        for rule_idx, rule in enumerate(rules):
            rule_id     = rule_idx + 1  # 1-based ID
            rule_name   = rule["name"]
            logic       = rule.get("logic", "AND").upper()
            rule_type   = rule.get("rule_type", "coherence")
            rule_fields = rule.get("fields", [])

            # Évaluation de chaque champ de la règle
            field_evals = []   # list of (resolved, condition_met: bool)
            for rf in rule_fields:
                resolved = resolve_field_rule(rf, ref_row, tgt_row)
                if resolved is None:
                    continue
                field_evals.append((resolved, check_field_condition(resolved)))

            if not field_evals:
                continue

            n_pass  = sum(1 for _, met in field_evals if met)
            n_total = len(field_evals)

            # Logique AND / OR
            if logic == "AND":
                rule_passes = (n_pass == n_total)   # toutes les conditions satisfaites
            else:  # OR
                rule_passes = (n_pass > 0)           # au moins une condition satisfaite

            if rule_passes:
                # Nouveau modèle : rule_type au lieu de type_ecart
                type_rt = "ok" if rule_type == "coherence" else "ko"

                # On n'émet que les champs qui ont satisfait la condition
                passing_fields = [(res, met) for res, met in field_evals if met]
                for resolved, _ in passing_fields:
                    sf_out = resolved.get("sf", "")
                    tf_out = resolved.get("tf", "")
                    row_results.append({
                        "join_key": key,
                        "rule_id": rule_id,
                        "rule_name": rule_name,
                        "rule_type": type_rt,
                        "source_field": f"source.{sf_out}" if sf_out else "",
                        "target_field": f"target.{tf_out}" if tf_out else "",
                        "source_value": _fmt(resolved["v_ref"]),
                        "target_value": _fmt(resolved["v_tgt"]),
                        "detail": _check_detail(resolved, True),
                    })

                if type_rt == "ko":
                    rule_ko_keys[rule_name].add(key)

            # Règle non passante (coherence ou incoherence) → on n'émet rien

        # ── Emit ───────────────────────────────────────────────
        # Toujours émettre "Présence OK" quand la clé est dans les deux sources
        r_presence = {"join_key": key, "rule_id": -3, "rule_name": "Présence OK", "rule_type": "_ok",
                      "source_field": "", "target_field": "", "source_value": "", "target_value": "",
                      "detail": "Clé présente dans les deux sources"}
        results.append(r_presence)
        yield {"event": "result", **r_presence}

        # Émettre les résultats des règles évaluées
        if row_results:
            for r in row_results:
                results.append(r)
                yield {"event": "result", **r}
            if any(r["rule_type"] == "ko" for r in row_results):
                divergent_keys.add(key)
            else:
                ok += 1
        else:
            ok += 1

    rule_stats = {name: len(keys) for name, keys in rule_ko_keys.items()}

    summary = {
        "total_reference": len(df_ref),
        "total_cible":     len(df_tgt),
        "orphelins_a":     oa,
        "orphelins_b":     ob,
        "divergents":      len(divergent_keys),
        "ok":              ok,
        "total_ecarts":    oa + ob + len(divergent_keys),
        "rule_stats":      rule_stats,
    }
    yield {"event": "summary", **summary}
