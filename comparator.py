"""
comparator.py — Jointure + détection des écarts avec progression SSE.
Supporte : legacy comparison.fields, rules nommées (AND/OR),
           target_value, source_data/target_data.
"""
import math
from typing import Generator
import pandas as pd
from normalizer import apply_comparison_norm


# ── Résolution d'une field-rule ───────────────────────────────
def resolve_field_rule(field_rule: dict, ref_row, tgt_row) -> dict | None:
    """
    Résout une règle de champ en (label, v_ref, v_tgt, tolerance, normalize).
    Supporte syntaxe courte (source_field/target_field/target_value)
    et longue (source_data/target_data).
    """
    if "source_field" in field_rule:
        sf    = field_rule["source_field"]
        v_ref = ref_row.get(sf) if ref_row is not None else None
        if "target_value" in field_rule:
            v_tgt = field_rule["target_value"]
            label = f'{sf} = "{v_tgt}"'
        else:
            tf    = field_rule.get("target_field", sf)
            v_tgt = tgt_row.get(tf) if tgt_row is not None else None
            label = sf
        return dict(label=label, v_ref=v_ref, v_tgt=v_tgt,
                    tolerance=field_rule.get("tolerance"),
                    normalize=field_rule.get("normalize", "none"))

    if "source_data" in field_rule:
        sd    = field_rule["source_data"]
        td    = field_rule.get("target_data", {})
        sf    = sd.get("field", "")
        v_ref = ref_row.get(sf) if ref_row is not None else None
        if "value" in td:
            v_tgt = td["value"]
            label = f'{sf} = "{v_tgt}"'
        else:
            tf    = td.get("field", sf)
            v_tgt = tgt_row.get(tf) if tgt_row is not None else None
            label = sf
        return dict(label=label, v_ref=v_ref, v_tgt=v_tgt,
                    tolerance=td.get("tolerance", sd.get("tolerance")),
                    normalize=sd.get("normalize", "none"))
    return None


def _fmt(v) -> str:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return ""
    return str(v)


def _values_differ(v_ref, v_tgt, tolerance, normalize) -> bool:
    def is_null(v):
        return v is None or (isinstance(v, float) and math.isnan(v)) or str(v).strip() in ("", "nan", "NaT", "None", "<NA>")

    if is_null(v_ref) and is_null(v_tgt):
        return False
    if is_null(v_ref) != is_null(v_tgt):
        return True

    if tolerance is not None:
        try:
            return abs(float(v_ref) - float(v_tgt)) > float(tolerance)
        except (ValueError, TypeError):
            pass

    rule = normalize or "none"
    return apply_comparison_norm(v_ref, rule) != apply_comparison_norm(v_tgt, rule)


def _diff_detail(v_ref, v_tgt, tolerance) -> str:
    if tolerance is not None:
        try:
            delta = abs(float(v_ref) - float(v_tgt))
            return f"Écart : {delta:.4f} (tolérance : {tolerance})"
        except (ValueError, TypeError):
            pass
    return "Valeurs différentes"


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
    join_cfg     = config.get("join", {})
    legacy_fields= config.get("comparison", {}).get("fields", [])
    ignore_set   = set(config.get("comparison", {}).get("ignore_fields", []))
    show_ok      = config.get("report", {}).get("show_matching", False)
    rules        = config.get("rules", [])

    join_keys    = join_cfg.get("keys", [])
    ref_key_cols = [k["source_field"] for k in join_keys]
    tgt_key_cols = [k["target_field"] for k in join_keys]

    # ── Construction des clés de jointure ─────────────────────
    yield {"event": "progress", "done": 0, "total": 0, "pct": 0,
           "step": "Construction des index de jointure…"}

    def make_key(row: pd.Series, cols: list) -> str:
        return "§".join(str(row.get(c, "")).strip() for c in cols)

    ref_map = {}
    for _, row in df_ref.iterrows():
        k = make_key(row, ref_key_cols)
        if k not in ref_map:
            ref_map[k] = row.to_dict()

    tgt_map = {}
    for _, row in df_tgt.iterrows():
        k = make_key(row, tgt_key_cols)
        if k not in tgt_map:
            tgt_map[k] = row.to_dict()

    ref_keys  = set(ref_map.keys())
    tgt_keys  = set(tgt_map.keys())
    all_keys  = sorted(ref_keys | tgt_keys)
    total     = len(all_keys)

    yield {"event": "progress", "done": 0, "total": total, "pct": 0,
           "step": f"Comparaison de {total} clés…"}

    results      = []
    oa = ob = ok = 0
    divergent_keys = set()
    rule_ko_keys   = {r["name"]: set() for r in rules}

    BATCH = max(1, total // 200)   # émettre un événement tous les ~0.5%

    for i, key in enumerate(all_keys):

        # Progression
        if i % BATCH == 0 or i == total - 1:
            pct = round((i + 1) / total * 100, 1)
            yield {"event": "progress", "done": i + 1, "total": total,
                   "pct": pct, "step": f"Traitement clé {i+1}/{total}…"}

        in_ref = key in ref_keys
        in_tgt = key in tgt_keys
        ref_row = ref_map.get(key)
        tgt_row = tgt_map.get(key)

        # ── Orphelins ──────────────────────────────────────────
        if not in_tgt:
            r = {"join_key": key, "type_ecart": "ORPHELIN_A", "rule_name": "",
                 "champ": "", "valeur_reference": "", "valeur_cible": "",
                 "detail": "Clé présente dans la référence, absente dans la cible"}
            results.append(r)
            yield {"event": "result", **r}
            oa += 1
            continue

        if not in_ref:
            r = {"join_key": key, "type_ecart": "ORPHELIN_B", "rule_name": "",
                 "champ": "", "valeur_reference": "", "valeur_cible": "",
                 "detail": "Clé présente dans la cible, absente dans la référence"}
            results.append(r)
            yield {"event": "result", **r}
            ob += 1
            continue

        row_diffs = []

        # ── Legacy comparison.fields ───────────────────────────
        for rf in legacy_fields:
            sf = rf.get("source_field", "")
            tf = rf.get("target_field", sf)
            if sf in ignore_set or tf in ignore_set:
                continue
            resolved = resolve_field_rule(rf, ref_row, tgt_row)
            if not resolved:
                continue
            if _values_differ(resolved["v_ref"], resolved["v_tgt"],
                               resolved["tolerance"], resolved["normalize"]):
                r = {"join_key": key, "type_ecart": "DIVERGENT", "rule_name": "",
                     "champ": resolved["label"],
                     "valeur_reference": _fmt(resolved["v_ref"]),
                     "valeur_cible":     _fmt(resolved["v_tgt"]),
                     "detail": _diff_detail(resolved["v_ref"], resolved["v_tgt"],
                                            resolved["tolerance"])}
                row_diffs.append(r)

        # ── Named rules ────────────────────────────────────────
        for rule in rules:
            rule_name   = rule["name"]
            logic       = rule.get("logic", "AND").upper()
            rule_fields = rule.get("fields", [])
            field_diffs = []

            for rf in rule_fields:
                resolved = resolve_field_rule(rf, ref_row, tgt_row)
                if not resolved:
                    continue
                if _values_differ(resolved["v_ref"], resolved["v_tgt"],
                                   resolved["tolerance"], resolved["normalize"]):
                    field_diffs.append({
                        "join_key": key, "type_ecart": "DIVERGENT",
                        "rule_name": rule_name,
                        "champ": resolved["label"],
                        "valeur_reference": _fmt(resolved["v_ref"]),
                        "valeur_cible":     _fmt(resolved["v_tgt"]),
                        "detail": _diff_detail(resolved["v_ref"], resolved["v_tgt"],
                                               resolved["tolerance"])
                    })

            n_fail  = len(field_diffs)
            n_total = len(rule_fields)
            rule_ko = (logic == "OR" and n_fail > 0) or \
                      (logic == "AND" and n_fail > 0)

            if rule_ko:
                row_diffs.extend(field_diffs)
                rule_ko_keys[rule_name].add(key)

            elif show_ok:
                row_diffs.append({
                    "join_key": key, "type_ecart": "OK",
                    "rule_name": rule_name,
                    "champ": "", "valeur_reference": "", "valeur_cible": "",
                    "detail": f'Rule "{rule_name}" : conforme'
                })

        # ── Emit ───────────────────────────────────────────────
        if row_diffs:
            for r in row_diffs:
                results.append(r)
                yield {"event": "result", **r}
            divergent_keys.add(key)
        elif show_ok and not rules:
            r = {"join_key": key, "type_ecart": "OK", "rule_name": "",
                 "champ": "", "valeur_reference": "", "valeur_cible": "",
                 "detail": "Toutes les valeurs sont conformes"}
            results.append(r)
            yield {"event": "result", **r}
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
