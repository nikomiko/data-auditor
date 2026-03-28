"""
calculator.py — Évaluation des champs calculés (expressions pandas/numpy).

Les formules sont évaluées avec eval() dans un namespace restreint :
  - Les colonnes du DataFrame sont exposées comme variables pandas Series
  - numpy est exposé via `np`
  - __builtins__ est vide (pas d'accès au système)

Résultat : Series (N→N) ou scalaire broadcasté sur toute la colonne.
"""
import numpy as np
import pandas as pd
from config_loader import ConfigError


_SAFE_NS: dict = {
    "__builtins__": {},
    # Librairies
    "np": np,
    "pd": pd,
    # Fonctions utilitaires courantes
    "abs":   np.abs,
    "round": np.round,
    "where": np.where,        # np.where(cond, a, b) — équivalent IF vectorisé
    "clip":  np.clip,
    "sqrt":  np.sqrt,
    "log":   np.log,
    "exp":   np.exp,
    # Conversions de type
    "str":   str,
    "int":   int,
    "float": float,
    "bool":  bool,
    "len":   len,
}


def evaluate_calculated_fields(df: pd.DataFrame, src_cfg: dict) -> pd.DataFrame:
    """
    Ajoute au DataFrame les colonnes calculées déclarées dans src_cfg['calculated_fields'].

    Chaque entrée doit avoir :
        name    : nom de la colonne résultante
        formula : expression Python/pandas (ex: "Qty * Prix * 1.2")

    Les colonnes existantes du DataFrame sont accessibles par leur nom.
    numpy est accessible via `np`.

    Retourne le DataFrame avec les nouvelles colonnes ajoutées à la fin.
    Lève ConfigError si une formule est invalide ou produit une erreur.
    """
    calc_fields = src_cfg.get("calculated_fields", [])
    if not calc_fields:
        return df

    df = df.copy()
    for cf in calc_fields:
        name    = cf["name"]
        formula = cf["formula"]

        # Namespace : colonnes courantes (inclut les champs calculés précédents)
        ns = {col: df[col] for col in df.columns}
        ns.update(_SAFE_NS)

        try:
            result = eval(formula, ns)  # noqa: S307
        except Exception as e:
            raise ConfigError(
                f"Champ calculé '{name}' — formule {formula!r} : {e}"
            )

        if isinstance(result, pd.Series):
            df[name] = result.values
        else:
            # Scalaire : broadcast sur toute la colonne
            df[name] = result

    return df
