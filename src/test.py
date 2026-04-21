import math
from typing import Generator
import pandas as pd
from normalizer import apply_comparison_norm

# --- CHOIX D'IMPLÉMENTATION : Mapping pour la flexibilité ---
# On utilise des dictionnaires pour traduire les symboles mathématiques en noms de fonctions.
# Cela permet d'accepter plusieurs syntaxes dans les fichiers de configuration (YAML/JSON).
_OP_ALIAS = {"=": "equals", "<>": "differs", ">": "greater", "<": "less"}
_OP_LABEL = {"equals": "=", "differs": "≠", "greater": ">", "less": "<",
             "contains": "∋", "not_contains": "∌",
             "matches": "∼", "not_matches": "≁"}

def resolve_field_rule(field_rule: dict, ref_row, tgt_row) -> dict | None:
    """
    LOGIQUE : Extraire les valeurs réelles depuis les lignes (rows) selon la règle.
    CHOIX TECHNIQUE : Support de la syntaxe 'courte' et 'longue'.
    Le code vérifie si on compare un champ à un autre champ, ou un champ à une valeur fixe.
    """
    op_raw = field_rule.get("operator", "equals")
    op     = _OP_ALIAS.get(op_raw, op_raw)
    op_lbl = _OP_LABEL.get(op, op)

    if "source_field" in field_rule:
        # --- Gestion des sources de données ---
        # side_a / side_b permettent de comparer deux colonnes du MÊME fichier si besoin.
        sf    = field_rule["source_field"]
        side_a = field_rule.get("side_a", "reference")
        row_a = ref_row if side_a == "reference" else tgt_row
        v_ref = row_a.get(sf) if row_a is not None else None
        
        # Comparaison : Champ vs Valeur fixe ou Champ vs Champ
        if "target_value" in field_rule:
            v_tgt = field_rule["target_value"]
            tf    = "" # Pas de champ cible car c'est une valeur fixe
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
    # ... (logique similaire pour "source_data" qui est une syntaxe alternative)
    return None

def _is_null(v) -> bool:
    """
    LOGIQUE DE ROBUSTESSE : En data science, le 'vide' a plusieurs visages.
    Cette fonction unifie None, NaN (Not a Number), NaT (Not a Time) et les chaînes vides.
    """
    if isinstance(v, pd.Timestamp):
        return pd.isna(v)
    return v is None or (isinstance(v, float) and math.isnan(v)) \
           or str(v).strip() in ("", "nan", "NaT", "None", "<NA>")

def check_field_condition(resolved: dict) -> bool:
    """
    LOGIQUE MÉTIER : C'est ici qu'on décide si la donnée est "OK" ou "KO".
    """
    v_ref     = resolved["v_ref"]
    v_tgt     = resolved["v_tgt"]
    tolerance = resolved["tolerance"]
    norm      = resolved.get("normalize", "none") or "none"
    op        = resolved["operator"]

    # On détecte si on manipule des dates pour utiliser les fonctions de temps de Pandas
    is_ts = isinstance(v_ref, pd.Timestamp) or isinstance(v_tgt, pd.Timestamp)

    if op == "equals":
        # Cas particulier : deux valeurs nulles sont considérées comme égales
        if _is_null(v_ref) and _is_null(v_tgt): return True
        if _is_null(v_ref) != _is_null(v_tgt): return False
        
        # --- Gestion de la Tolérance ---
        if tolerance is not None:
            if is_ts: # Tolérance en secondes pour les dates
                delta = _ts_delta_seconds(v_ref, v_tgt)
                if delta is not None: return delta <= float(tolerance)
            try:
                if resolved.get("tolerance_pct", False): # Écart relatif (ex: 1%)
                    return abs(float(v_ref) - float(v_tgt)) / max(abs(float(v_ref)), 1e-9) * 100 <= float(tolerance)
                else: # Écart absolu (ex: 0.5 unités)
                    return abs(float(v_ref) - float(v_tgt)) <= float(tolerance)
            except (ValueError, TypeError): pass
            
        # Normalisation : on nettoie les chaînes (ex: minuscules, sans espaces) avant de comparer
        return apply_comparison_norm(v_ref, norm) == apply_comparison_norm(v_tgt, norm)

    # ... (autres opérateurs : greater, contains, matches via regex)
    return False

# --- OPTIMISATION : Performance de la jointure ---

def _build_key_series(df: pd.DataFrame, cols: list) -> "pd.Series":
    """
    CHOIX TECHNIQUE : Vectorisation. 
    Au lieu de boucler sur les lignes, on traite toute la colonne d'un coup.
    On crée une 'super-clé' en concaténant les colonnes avec un séparateur (§).
    """
    parts = []
    for c in cols:
        s = df[c].fillna("").astype(str).str.strip()
        parts.append(s)
    return parts[0] if len(parts) == 1 else parts[0].str.cat(parts[1:], sep="§")

def _build_key_map(df: pd.DataFrame, cols: list) -> dict:
    """
    LOGIQUE : Transforme le DataFrame en dictionnaire indexé par la clé de jointure.
    L'accès à une donnée par sa clé dans un dict est en temps constant O(1), 
    ce qui rend le script extrêmement rapide.
    """
    return (
        df.assign(__key=_build_key_series(df, cols))
          .drop_duplicates("__key")
          .set_index("__key")
          .to_dict("index")
    )

def compare_with_progress(df_ref: pd.DataFrame, df_tgt: pd.DataFrame, config: dict) -> Generator[dict, None, None]:
    """
    LOGIQUE DE FLUX : Utilise un générateur (yield).
    C'est idéal pour les interfaces graphiques : on peut afficher une barre de progression
    sans attendre que tout l'audit soit terminé.
    """
    # 1. Préparation des index
    ref_map = _build_key_map(df_ref, ref_key_cols)
    tgt_map = _build_key_map(df_tgt, tgt_key_cols)
    all_keys = sorted(set(ref_map.keys()) | set(tgt_map.keys()))

    # 2. Boucle principale de comparaison
    for i, key in enumerate(all_keys):
        # ... Détection des orphelins (Source unique / Cible unique) ...

        # 3. Évaluation des règles nommées (AND / OR)
        # On ne stocke que les résultats qui correspondent au type de règle voulu.
        # logic="AND" -> Strict. logic="OR" -> Souple.
        
        # 4. Émission des résultats au fil de l'eau
        yield {"event": "result", "join_key": key, ...}

    # 5. Résumé final
    yield {"event": "summary", "total_ecarts": oa + ob + len(divergent_keys), ...}
