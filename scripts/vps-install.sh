#!/usr/bin/env bash
set -euo pipefail

# Installation ClipForge sur VPS (Ubuntu/Debian) — à lancer en root ou sudo
# Usage: curl -fsSL https://raw.githubusercontent.com/urdirditfurd/mon-site/main/scripts/vps-install.sh | bash

APP_DIR="${APP_DIR:-/opt/clipforge}"
APP_USER="${APP_USER:-clipforge}"
APP_PORT="${APP_PORT:-3000}"
REPO_URL="${REPO_URL:-https://github.com/urdirditfurd/mon-site.git}"
GIT_BRANCH="${GIT_BRANCH:-cursor/fix-clipforge-deployment-cb8f}"

echo "==> ClipForge — installation sur VPS"
echo "    Dossier: $APP_DIR"
echo "    Port:    $APP_PORT"

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

if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER" || true
fi

mkdir -p "$APP_DIR"
if [[ ! -d "$APP_DIR/.git" ]]; then
  git clone --branch "$GIT_BRANCH" "$REPO_URL" "$APP_DIR"
else
  cd "$APP_DIR"
  git fetch origin
  git checkout "$GIT_BRANCH"
  git pull origin "$GIT_BRANCH"
fi

cd "$APP_DIR"
npm install
npm run check

chown -R "$APP_USER:$APP_USER" "$APP_DIR"
mkdir -p "$APP_DIR/storage/uploads" "$APP_DIR/storage/jobs" "$APP_DIR/storage/secrets"
chown -R "$APP_USER:$APP_USER" "$APP_DIR/storage"

PM2_HOME="/home/$APP_USER/.pm2"
mkdir -p "/home/$APP_USER"
chown -R "$APP_USER:$APP_USER" "/home/$APP_USER"

sudo -u "$APP_USER" env PORT="$APP_PORT" pm2 delete clipforge >/dev/null 2>&1 || true
sudo -u "$APP_USER" env PORT="$APP_PORT" pm2 start "$APP_DIR/server/index.js" --name clipforge
sudo -u "$APP_USER" pm2 save

PM2_STARTUP=$(sudo -u "$APP_USER" pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" | tail -n 1)
eval "$PM2_STARTUP" || true

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
systemctl reload nginx

sleep 2
HEALTH=$(curl -sS "http://127.0.0.1:${APP_PORT}/api/health" || true)

echo ""
echo "=========================================="
echo " ClipForge installé."
echo " URL: http://$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
echo " Health: $HEALTH"
echo " Logs: sudo -u $APP_USER pm2 logs clipforge"
echo " Maj:  cd $APP_DIR && ./scripts/vps-update.sh"
echo "=========================================="
