"""
unpivot.py — Transformation format large → format long (dépivotage).
"""
import pandas as pd
from config_loader import ConfigError


def unpivot_dataframe(df: pd.DataFrame, unpivot_cfg: dict) -> pd.DataFrame:
    """
    Dépivote un DataFrame selon la config unpivot.

    Config attendue :
      anchor_fields  : colonnes conservées sur chaque ligne générée
      location_field : nom du champ généré contenant la location (défaut: location_key)
      value_field    : nom du champ généré contenant la valeur   (défaut: pivot_value)
      pivot_fields   : liste de {source: str, location: str}
    """
    anchors    = unpivot_cfg.get("anchor_fields", [])
    loc_field  = unpivot_cfg.get("location_field", "location_key")
    val_field  = unpivot_cfg.get("value_field",    "pivot_value")
    pivots     = unpivot_cfg.get("pivot_fields",   [])

    if not pivots:
        raise ConfigError("unpivot.pivot_fields est vide.")

    # Vérifier colonnes source
    missing = [p["source"] for p in pivots if p["source"] not in df.columns]
    if missing:
        raise ConfigError(
            f"Colonnes introuvables pour le dépivotage : {', '.join(missing)}. "
            f"Disponibles : {', '.join(df.columns)}"
        )
    missing_anchors = [a for a in anchors if a not in df.columns]
    if missing_anchors:
        raise ConfigError(
            f"anchor_fields introuvables : {', '.join(missing_anchors)}."
        )

    records = []
    for _, row in df.iterrows():
        base = {a: row[a] for a in anchors}
        for pf in pivots:
            new_row = dict(base)
            new_row[loc_field] = pf["location"]
            new_row[val_field] = row[pf["source"]]
            records.append(new_row)

    return pd.DataFrame(records)
