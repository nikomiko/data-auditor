"""
config_loader.py — Chargement et validation de la config YAML.
Supporte : csv/txt/dat/json/xlsx, fixed_width, record_filter,
           max_columns, unpivot, rules, filters.
"""
import yaml

VALID_FORMATS      = {"csv", "txt", "dat", "json", "xlsx"}
VALID_TYPES        = {"string", "integer", "decimal", "date", "boolean"}
VALID_NORMALIZATIONS = {"none", "lowercase", "trim", "both"}


class ConfigError(Exception):
    pass


def load_config(yaml_text: str) -> dict:
    try:
        config = yaml.safe_load(yaml_text)
    except yaml.YAMLError as e:
        raise ConfigError(f"YAML invalide : {e}")
    if not isinstance(config, dict):
        raise ConfigError("La configuration doit être un dictionnaire YAML valide.")
    _validate_source(config, "reference")
    _validate_source(config, "target")
    _validate_join(config)
    _validate_rules(config)
    return config


def _validate_source(config: dict, role: str):
    src = config.get("sources", {}).get(role)
    if not src:
        raise ConfigError(f"Section sources.{role} manquante.")
    fmt = src.get("format", "").lower()
    if fmt not in VALID_FORMATS:
        raise ConfigError(f"sources.{role}.format invalide : '{fmt}'. Valeurs : {', '.join(VALID_FORMATS)}")
    if fmt not in ("json", "xlsx"):
        if not src.get("fields") and not src.get("column_positions"):
            raise ConfigError(f"sources.{role} : 'fields' ou 'column_positions' requis.")
    fields = src.get("fields") or src.get("column_positions") or []
    for f in fields:
        if "name" not in f:
            raise ConfigError(f"sources.{role} : chaque champ doit avoir un 'name'.")
        ftype = f.get("type", "string")
        if ftype not in VALID_TYPES:
            raise ConfigError(f"sources.{role}.{f['name']} : type '{ftype}' invalide.")
        if ftype == "date" and "date_format" not in f:
            raise ConfigError(f"sources.{role}.{f['name']} : date_format requis pour type date.")
    # Validation unpivot
    unpivot = src.get("unpivot")
    if unpivot:
        if not unpivot.get("pivot_fields"):
            raise ConfigError(f"sources.{role}.unpivot.pivot_fields est vide.")
        for pf in unpivot["pivot_fields"]:
            if "source" not in pf or "location" not in pf:
                raise ConfigError(f"sources.{role}.unpivot.pivot_fields : chaque entrée doit avoir 'source' et 'location'.")


def _validate_join(config: dict):
    keys = config.get("join", {}).get("keys", [])
    if not keys:
        raise ConfigError("join.keys doit contenir au moins une clé.")
    for k in keys:
        if "source_field" not in k or "target_field" not in k:
            raise ConfigError("Chaque join.key doit avoir 'source_field' et 'target_field'.")


def _validate_rules(config: dict):
    for rule in config.get("rules", []):
        if not rule.get("name"):
            raise ConfigError("Chaque rule doit avoir un 'name'.")
        for f in rule.get("fields", []):
            if "source_field" not in f and "source_data" not in f:
                raise ConfigError(f"Rule '{rule['name']}' : chaque field doit avoir 'source_field' ou 'source_data'.")


def get_field_map(src_cfg: dict) -> dict:
    fields = src_cfg.get("fields") or src_cfg.get("column_positions") or []
    return {f["name"]: f for f in fields}
