"""
filters.py — Application des filtres YAML sur les DataFrames source et cible.
Utilisé par server.py (mode web) et cli.py (mode ligne de commande).
"""
import pandas as pd
from config_loader import ConfigError


def apply_filters(df_ref, df_tgt, filters, config, debug: bool = False):
    """
    Filtre chaque source par les valeurs déclarées dans 'filters'.
    Pas de propagation croisée : les orphelins restent visibles dans le comparateur.
    """
    for f in filters:
        field      = f.get("field")
        src        = f.get("source", "reference")
        operator   = f.get("operator", "equals")
        value_type = f.get("value_type", "value")
        value      = f.get("value", "")
        # Compat ascendante : ancien format { values: [...] }
        legacy_values = f.get("values")

        if not field:
            continue

        def _make_mask(fld, op, vt, val, lv):

            def _as_str(series):
                """NaN → '' pour toutes les comparaisons string."""
                return series.where(series.notna(), other="").astype(str).str.strip()

            def _debug_log(fld, result, computed_series, raw_series=None, cmp_val=None):
                if not debug:
                    return
                true_count  = int(result.sum())
                false_count = int((~result).sum())
                label = f"[filter debug] champ={fld!r}  op={op!r}  value_type={vt!r}"
                if cmp_val is not None:
                    label += f"  valeur_comparée={cmp_val!r}"
                print(f"{label}  →  TRUE={true_count}  FALSE={false_count}  TOTAL={true_count+false_count}")

            if vt == "empty":
                def _m(df, _f=fld):
                    s = df[_f].fillna("").astype(str).str.strip()
                    r = s == ""
                    _debug_log(_f, r, s, raw_series=df[_f])
                    return r
                return _m
            if vt == "not_empty":
                def _m(df, _f=fld):
                    s = df[_f].fillna("").astype(str).str.strip()
                    r = s != ""
                    _debug_log(_f, r, s, raw_series=df[_f])
                    return r
                return _m
            if vt == "list":
                raw_list = lv if lv is not None else (str(val).split("\n") if val else [])
                vs = set(str(v).strip() for v in raw_list if str(v).strip())
                vs = set(list(vs)[:100])
                def _m(df, _f=fld, _vs=vs):
                    s = _as_str(df[_f])
                    r = s.isin(_vs)
                    _debug_log(_f, r, s, cmp_val=sorted(_vs))
                    return r
                return _m
            # value_type == "value" (ou valeur brute)
            if lv is not None and not val:
                vs = set(str(v) for v in lv)
                def _m(df, _f=fld, _vs=vs):
                    s = _as_str(df[_f])
                    r = s.isin(_vs)
                    _debug_log(_f, r, s, cmp_val=sorted(_vs))
                    return r
                return _m
            v = str(val).strip() if val is not None else ""
            if op == "equals":
                def _m(df, _f=fld, _v=v):
                    s = _as_str(df[_f]); r = s == _v; _debug_log(_f, r, s, cmp_val=_v); return r
                return _m
            if op == "differs":
                def _m(df, _f=fld, _v=v):
                    s = _as_str(df[_f]); r = s != _v; _debug_log(_f, r, s, cmp_val=_v); return r
                return _m
            if op == "greater":
                def _m(df, _f=fld, _v=v):
                    n = pd.to_numeric(df[_f], errors="coerce")
                    r = n > pd.to_numeric(_v, errors="coerce")
                    _debug_log(_f, r.fillna(False), n.astype(str), cmp_val=_v); return r
                return _m
            if op == "less":
                def _m(df, _f=fld, _v=v):
                    n = pd.to_numeric(df[_f], errors="coerce")
                    r = n < pd.to_numeric(_v, errors="coerce")
                    _debug_log(_f, r.fillna(False), n.astype(str), cmp_val=_v); return r
                return _m
            if op == "contains":
                def _m(df, _f=fld, _v=v):
                    s = _as_str(df[_f]); r = s.str.contains(_v, regex=False); _debug_log(_f, r, s, cmp_val=_v); return r
                return _m
            if op == "not_contains":
                def _m(df, _f=fld, _v=v):
                    s = _as_str(df[_f]); r = ~s.str.contains(_v, regex=False); _debug_log(_f, r, s, cmp_val=_v); return r
                return _m
            def _m(df, _f=fld, _v=v):
                s = _as_str(df[_f]); r = s == _v; _debug_log(_f, r, s, cmp_val=_v); return r
            return _m

        mask = _make_mask(field, operator, value_type, value, legacy_values)

        if src == "reference":
            if field not in df_ref.columns:
                raise ConfigError(f"filters: champ '{field}' introuvable dans la reference.")
            df_ref = df_ref[mask(df_ref)].reset_index(drop=True)
        elif src == "target":
            if field not in df_tgt.columns:
                raise ConfigError(f"filters: champ '{field}' introuvable dans la cible.")
            df_tgt = df_tgt[mask(df_tgt)].reset_index(drop=True)
    return df_ref, df_tgt
