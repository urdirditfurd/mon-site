#!/usr/bin/env bash
set -euo pipefail

# Active HTTPS pour la prospection (une commande, depuis n'importe où en root).
# Usage :
#   curl -fsSL "https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/prospection-contacts-stream-0325/scripts/vps-prospection-https.sh" | bash

APP_DIR="${APP_DIR:-/root/mon-site}"
PUBLIC_IP="${PUBLIC_IP:-51.254.135.158}"
PROSPECTION_DOMAIN="${PROSPECTION_DOMAIN:-51-254-135-158.sslip.io}"

if [[ ! -f "$APP_DIR/scripts/vps-prospection-setup.sh" ]]; then
  echo "==> Clone / mise à jour du dépôt dans $APP_DIR"
  if [[ -d "$APP_DIR/.git" ]]; then
    cd "$APP_DIR"
    git fetch origin
    git checkout cursor/prospection-contacts-stream-0325
    git pull origin cursor/prospection-contacts-stream-0325 || true
  else
    git clone --branch cursor/prospection-contacts-stream-0325 \
      https://github.com/urdirditfurd/mon-site.git "$APP_DIR"
  fi
fi

cd "$APP_DIR"
git pull origin cursor/prospection-contacts-stream-0325 2>/dev/null || true

export ENABLE_HTTPS=1
export PUBLIC_IP
export PROSPECTION_DOMAIN
bash scripts/vps-prospection-setup.sh
