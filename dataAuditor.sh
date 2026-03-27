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
