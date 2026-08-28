#!/usr/bin/env bash
# Installation rapide Conte Factory (Ubuntu / Debian / VPS OVH)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Outils système"
if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y python3 python3-venv python3-pip ffmpeg fonts-dejavu-core
fi

echo "==> Environnement Python"
python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -U pip
pip install -r requirements.txt

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Fichier .env créé."
fi

mkdir -p data/videos data/exports data/cache assets/music secrets
python - <<'PY'
from db.database import init_db
from config import ensure_dirs
ensure_dirs()
init_db()
print("Base SQLite prête.")
PY

echo ""
echo "OK. Prochaines commandes :"
echo "  source .venv/bin/activate"
echo "  python main.py --short          # test ~3 min"
echo "  streamlit run dashboard.py      # tableau de bord"
echo ""
echo "Optionnel : place une musique douce libre de droits dans assets/music/"
