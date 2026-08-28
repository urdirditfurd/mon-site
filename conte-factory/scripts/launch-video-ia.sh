#!/usr/bin/env bash
# Lanceur « video ia » — suivi Conte Factory
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -d .venv ]]; then
  echo "Environnement manquant — lancez ./scripts/install.sh"
  exit 1
fi
# shellcheck disable=SC1091
source .venv/bin/activate
export STREAMLIT_BROWSER_GATHER_USAGE_STATS=false
echo "=== video ia — tableau de suivi ==="
echo "Dashboard : http://127.0.0.1:8501"
exec streamlit run dashboard.py --server.address 127.0.0.1 --server.port 8501
