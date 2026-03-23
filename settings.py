"""
settings.py — Paramètres généraux de l'application (persistés dans settings.json).
"""
import json
import os
import sys


def _default_settings_file() -> str:
    if getattr(sys, "frozen", False):
        return os.path.join(os.path.dirname(sys.executable), "settings.json")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "settings.json")


SETTINGS_FILE = _default_settings_file()

DEFAULTS: dict = {
    "folder_default_datasets": "./datasets",
    "folder_default_reports":  "./exports",
    "folder_default_configs":  "",
}


def load_settings() -> dict:
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, encoding="utf-8") as f:
                data = json.load(f)
            return {**DEFAULTS, **{k: v for k, v in data.items() if k in DEFAULTS}}
        except Exception:
            pass
    return dict(DEFAULTS)


def save_settings(data: dict) -> dict:
    current = load_settings()
    for k in DEFAULTS:
        if k in data:
            current[k] = str(data[k])
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(current, f, ensure_ascii=False, indent=2)
    return current


def resolve_path(folder: str, base_dir: str) -> str:
    """Résout un chemin relatif par rapport à base_dir."""
    if not folder:
        return base_dir
    if os.path.isabs(folder):
        return folder
    return os.path.normpath(os.path.join(base_dir, folder))
