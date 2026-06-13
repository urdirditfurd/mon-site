#!/usr/bin/env bash
set -euo pipefail

# Installation ClipForge sur VPS (Ubuntu/Debian) — à lancer en root
# Usage: curl -fsSL https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/fix-clipforge-deployment-cb8f/scripts/vps-install.sh | bash

APP_DIR="${APP_DIR:-/opt/clipforge}"
APP_PORT="${APP_PORT:-3000}"
REPO_URL="${REPO_URL:-https://github.com/urdirditfurd/mon-site.git}"
GIT_BRANCH="${GIT_BRANCH:-main}"

echo "==> ClipForge — installation sur VPS"
echo "    Dossier: $APP_DIR"
echo "    Port:    $APP_PORT"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Lance ce script en root (sudo -i)."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y git curl ca-certificates nginx ffmpeg python3 python3-pip

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

pip3 install -U yt-dlp --break-system-packages 2>/dev/null || pip3 install -U yt-dlp

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

pm2 delete clipforge >/dev/null 2>&1 || true
cd /root

systemctl stop caddy >/dev/null 2>&1 || true
systemctl disable caddy >/dev/null 2>&1 || true

if [[ -d "$APP_DIR/.git" ]]; then
  cd "$APP_DIR"
  git fetch origin
  git reset --hard "origin/$GIT_BRANCH" 2>/dev/null || {
    echo "==> Repo corrompu, re-clone propre"
    cd /
    rm -rf "$APP_DIR"
    git clone --branch "$GIT_BRANCH" "$REPO_URL" "$APP_DIR"
  }
  git checkout "$GIT_BRANCH" 2>/dev/null || git checkout -B "$GIT_BRANCH" "origin/$GIT_BRANCH"
  git pull origin "$GIT_BRANCH" || true
else
  rm -rf "$APP_DIR"
  git clone --branch "$GIT_BRANCH" "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
npm install
npm run check
mkdir -p storage/uploads storage/jobs storage/secrets

export PORT="$APP_PORT"
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${APP_PORT}/tcp" >/dev/null 2>&1 || true
  sleep 1
fi
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
echo " ClipForge installé."
echo ""
echo " Ouvre en HTTP (pas HTTPS):"
echo "   http://${PUBLIC_IP}"
echo ""
echo " Health: $HEALTH"
echo " Logs: pm2 logs clipforge"
echo " Maj:  cd $APP_DIR && bash scripts/vps-update.sh"
echo "=========================================="
