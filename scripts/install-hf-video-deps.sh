#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[HF-VIDEO] Installation des dépendances Python text-to-video..."
python3 -m pip install --upgrade --break-system-packages pip
python3 -m pip install --break-system-packages -r "${ROOT_DIR}/requirements-hf-video.txt"
echo "[HF-VIDEO] OK"
