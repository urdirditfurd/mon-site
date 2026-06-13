#!/usr/bin/env bash
set -euo pipefail

# Réparation ClipForge sur VPS après une install interrompue
# Usage (root): curl -fsSL https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/fix-clipforge-deployment-cb8f/scripts/vps-repair.sh | bash

APP_DIR="${APP_DIR:-/opt/clipforge}"
APP_PORT="${APP_PORT:-3000}"
REPO_URL="${REPO_URL:-https://github.com/urdirditfurd/mon-site.git}"
GIT_BRANCH="${GIT_BRANCH:-cursor/fix-clipforge-deployment-cb8f}"

echo "==> Réparation ClipForge"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Lance ce script en root (sudo -i)."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y git curl ca-certificates nginx ffmpeg python3 python3-pip nodejs >/dev/null 2>&1 || true

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

pip3 install -U yt-dlp --break-system-packages 2>/dev/null || pip3 install -U yt-dlp
npm install -g pm2 2>/dev/null || true

echo "==> Nettoyage ancienne install"
pm2 delete clipforge >/dev/null 2>&1 || true
cd /root
rm -rf "$APP_DIR"

echo "==> Neutralisation Caddy (évite redirect HTTPS cassé sur IP)"
systemctl stop caddy >/dev/null 2>&1 || true
systemctl disable caddy >/dev/null 2>&1 || true
if command -v docker >/dev/null 2>&1; then
  docker ps --format '{{.Names}}' | grep -Eiq 'caddy' && docker stop "$(docker ps --format '{{.Names}}' | grep -Ei 'caddy' | head -n1)" >/dev/null 2>&1 || true
fi

echo "==> Clone propre du repo"
git clone --branch "$GIT_BRANCH" "$REPO_URL" "$APP_DIR"
cd "$APP_DIR"
npm install
npm run check
mkdir -p storage/uploads storage/jobs storage/secrets

echo "==> Démarrage PM2 (root)"
export PORT="$APP_PORT"
pm2 start server/index.js --name clipforge
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null | tail -n 1 | bash || true

NGINX_SITE="/etc/nginx/sites-available/clipforge"
cat > "$NGINX_SITE" <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 900M;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
EOF

ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/clipforge
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t
systemctl enable nginx >/dev/null 2>&1 || true
systemctl restart nginx

sleep 2
HEALTH=$(curl -sS "http://127.0.0.1:${APP_PORT}/api/health" || echo "ERREUR")
PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')

echo ""
echo "=========================================="
echo " ClipForge réparé."
echo ""
echo " Ouvre en HTTP (pas HTTPS):"
echo "   http://${PUBLIC_IP}"
echo ""
echo " Test santé: $HEALTH"
echo " Logs: pm2 logs clipforge"
echo " Test HTTP public:"
curl -sS -I "http://${PUBLIC_IP}/" | head -n 5 || true
echo "=========================================="
