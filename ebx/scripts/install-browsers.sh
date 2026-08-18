#!/usr/bin/env bash
# Installe Google Chrome + Chromium Playwright pour les scrapers Amazon (VPS Ubuntu).
# Usage (root) : bash /var/www/ebx/ebx/scripts/install-browsers.sh
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Lance ce script en root."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -n "${EBX_DIR:-}" && -f "${EBX_DIR}/package.json" ]]; then
  :
elif [[ -f "${SCRIPT_DIR}/../package.json" ]]; then
  EBX_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
elif [[ -f /var/www/ebx/ebx/package.json ]]; then
  EBX_DIR=/var/www/ebx/ebx
elif [[ -f /var/www/ebx/package.json ]]; then
  EBX_DIR=/var/www/ebx
else
  EBX_DIR=""
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg wget fonts-liberation libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1

if ! command -v google-chrome >/dev/null 2>&1 && ! command -v google-chrome-stable >/dev/null 2>&1; then
  echo ">>> Installation Google Chrome stable"
  curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/google-chrome.deb
  apt-get install -y /tmp/google-chrome.deb || apt-get -f install -y
  rm -f /tmp/google-chrome.deb
fi

if [[ -n "$EBX_DIR" ]]; then
  echo ">>> Playwright Chromium (${EBX_DIR})"
  cd "$EBX_DIR"
  npx --yes playwright-core install chromium || npx --yes playwright install --with-deps chromium || true
fi

echo ">>> Navigateurs :"
command -v google-chrome-stable || command -v google-chrome || echo "(chrome système absent)"
ls -d /root/.cache/ms-playwright/chromium-* 2>/dev/null || echo "(playwright chromium pas encore téléchargé)"
echo "OK. Relance : pm2 restart ebx --update-env"
