#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -q -r requirements.txt

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "→ Fichier .env créé depuis .env.example"
fi

mkdir -p data
echo "→ Démarrage AutoTrading Lemon sur http://127.0.0.1:8100"
exec python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8100 --reload
