#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
#  DataAuditor — script d'installation (Linux / macOS)
#  Usage : bash install.sh
# ──────────────────────────────────────────────────────────────
set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$APP_DIR/.venv"
PYTHON_MIN="3.10"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

info()    { printf "${GREEN}[✓]${NC} %s\n" "$1"; }
warn()    { printf "${YELLOW}[!]${NC} %s\n" "$1"; }
error()   { printf "${RED}[✗]${NC} %s\n" "$1"; exit 1; }
section() { printf "\n${YELLOW}━━ %s ━━${NC}\n" "$1"; }

echo ""
echo "  DataAuditor — Installation"
echo "  $(date '+%d/%m/%Y %H:%M')"
echo ""

# ── 1. Vérification Python ────────────────────────────────────
section "Vérification Python"

PYTHON=""
for cmd in python3 python; do
    if command -v "$cmd" &>/dev/null; then
        ver=$("$cmd" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
        major=${ver%%.*}; minor=${ver##*.}
        min_major=${PYTHON_MIN%%.*}; min_minor=${PYTHON_MIN##*.}
        if [ "$major" -gt "$min_major" ] || { [ "$major" -eq "$min_major" ] && [ "$minor" -ge "$min_minor" ]; }; then
            PYTHON="$cmd"
            info "Python $ver détecté ($cmd)"
            break
        else
            warn "Python $ver trop ancien ($cmd), minimum requis : $PYTHON_MIN"
        fi
    fi
done

[ -z "$PYTHON" ] && error "Python $PYTHON_MIN+ introuvable. Installez-le depuis https://python.org"

# ── 2. Environnement virtuel ──────────────────────────────────
section "Environnement virtuel"

if [ -d "$VENV_DIR" ]; then
    warn "Environnement existant détecté — mise à jour"
else
    "$PYTHON" -m venv "$VENV_DIR"
    info "Environnement créé dans .venv/"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

# ── 3. Dépendances ────────────────────────────────────────────
section "Installation des dépendances"

pip install --upgrade pip --quiet
pip install -r "$APP_DIR/requirements.txt" --quiet
info "Dépendances installées"

# ── 4. Script de lancement ────────────────────────────────────
section "Script de lancement"

LAUNCH="$APP_DIR/dataAuditor.sh"
cat > "$LAUNCH" << 'EOF'
#!/usr/bin/env bash
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$APP_DIR/.venv/bin/activate"

PORT="${PORT:-5000}"
echo ""
echo "  DataAuditor"
echo "  → http://localhost:$PORT"
echo "  Ctrl+C pour arrêter"
echo ""
cd "$APP_DIR"
python src/server.py
EOF
chmod +x "$LAUNCH"
info "Script dataAuditor.sh créé"

# ── 5. Résumé ─────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Installation terminée."
echo ""
echo "  Lancer l'application :"
echo "    bash dataAuditor.sh"
echo ""
echo "  Ou manuellement :"
echo "    source .venv/bin/activate"
echo "    python src/server.py"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
