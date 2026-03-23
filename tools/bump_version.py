"""
tools/bump_version.py — Synchronise la version dans tous les fichiers du projet.

Usage :
    python tools/bump_version.py 3.7.0

Fichiers mis à jour :
    server.py                 APP_VERSION = "x.y.z"
    static/js/state.js        UI_VERSION = 'x.y.z'
    static/sw.js              CACHE_VERSION = 'vx.y.z'
    index.html                <span … id="logo-ver">vx.y.z</span>
    installer.iss             #define AppVersion "x.y.z"
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent


def _replace(path: Path, pattern: str, replacement: str) -> bool:
    text = path.read_text(encoding="utf-8")
    new_text, n = re.subn(pattern, replacement, text)
    if n == 0:
        print(f"  ⚠  Aucune correspondance dans {path.relative_to(ROOT)}")
        return False
    path.write_text(new_text, encoding="utf-8")
    print(f"  ✓  {path.relative_to(ROOT)}")
    return True


def bump(version: str) -> None:
    v = version.lstrip("v")  # "3.7.0"
    vv = f"v{v}"             # "v3.7.0"

    targets = [
        (
            ROOT / "src" / "server.py",
            r'(APP_VERSION\s*=\s*")[^"]+(")',
            rf'\g<1>{v}\2',
        ),
        (
            ROOT / "static" / "js" / "state.js",
            r"(UI_VERSION\s*=\s*')[^']+(')",
            rf"\g<1>{v}\2",
        ),
        (
            ROOT / "static" / "sw.js",
            r"(CACHE_VERSION\s*=\s*')[^']+(')",
            rf"\g<1>{vv}\2",
        ),
        (
            ROOT / "index.html",
            r'(<span[^>]+id="logo-ver"[^>]*>)[^<]+(</span>)',
            rf"\g<1>{vv}\2",
        ),
        (
            ROOT / "installer.iss",
            r'(#define AppVersion\s+")[^"]+(")',
            rf"\g<1>{v}\2",
        ),
    ]

    print(f"Bump → {vv}")
    ok = all(_replace(path, pattern, repl) for path, pattern, repl in targets)
    if ok:
        print(f"\nTous les fichiers sont à jour. Pensez à committer avec :")
        print(f'  git commit -m "feat: {vv} — <description>"')


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage : python tools/bump_version.py <version>")
        print("Exemple : python tools/bump_version.py 3.7.0")
        sys.exit(1)
    bump(sys.argv[1])
