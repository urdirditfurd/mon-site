#!/usr/bin/env bash
# Déploie BayPilot À CÔTÉ du clone EBX. N'arrête pas, n'efface pas, ne redémarre pas ebx.
# Usage (root) :
#   BRANCH=cursor/baypilot-dfy-a79f APP_DIR=/var/www/baypilot bash scripts/setup-baypilot-vps.sh
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/urdirditfurd/mon-site.git}"
BRANCH="${BRANCH:-cursor/baypilot-dfy-a79f}"
APP_DIR="${APP_DIR:-/var/www/baypilot}"
DOMAIN="${DOMAIN:-}"
PORT="${PORT:-3100}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Lance ce script en root (sudo -i)."
  exit 1
fi

if [[ "$APP_DIR" == "/var/www/ebx" || "$APP_DIR" == */ebx ]]; then
  echo "Refus : APP_DIR pointerait sur le clone EBX. Utilise /var/www/baypilot"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git nginx ufw ca-certificates gnupg

if ! command -v node >/dev/null 2>&1 || ! node -v | grep -qE 'v(2[2-9]|[3-9])'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

npm install -g pm2

mkdir -p "$(dirname "$APP_DIR")"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch origin
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull origin "$BRANCH"
else
  git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR/baypilot"
npm install --omit=dev

if [[ ! -f .env ]]; then
  cp .env.example .env
  SESSION_SECRET="$(openssl rand -hex 24)"
  sed -i "s/^PORT=.*/PORT=${PORT}/" .env
  sed -i "s/^EBX_SESSION_SECRET=.*/EBX_SESSION_SECRET=${SESSION_SECRET}/" .env
  if [[ -n "$DOMAIN" ]]; then
    sed -i "s|^EBX_PUBLIC_URL=.*|EBX_PUBLIC_URL=https://${DOMAIN}|" .env
  fi
fi

# N'efface JAMAIS le process ebx
pm2 delete baypilot-ops >/dev/null 2>&1 || true
pm2 start operator-server.js --name baypilot-ops --cwd "$APP_DIR/baypilot" --env PORT="${PORT}"
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

if [[ -n "$DOMAIN" ]]; then
  SERVER_NAME="$DOMAIN"
else
  SERVER_NAME="_"
fi

cat >/etc/nginx/sites-available/baypilot <<NGINX
server {
    listen 80;
    server_name ${SERVER_NAME};

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX

ln -sfn /etc/nginx/sites-available/baypilot /etc/nginx/sites-enabled/baypilot
nginx -t
systemctl reload nginx

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable || true

if [[ -n "$DOMAIN" ]]; then
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@${DOMAIN}" --redirect || true
fi

IP="$(curl -4 -s ifconfig.me || hostname -I | awk '{print $1}')"
echo ""
echo "============================================"
echo " BayPilot opérateur en ligne"
echo " URL  : http://${IP}:${PORT}  (nginx 80 si DOMAIN)"
echo " App  : ${APP_DIR}/baypilot"
echo " PM2  : baypilot-ops"
echo " ebx  : laissé intact (ne pas pm2 restart ebx)"
echo " Suite: PLAYBOOK.md — créer le 1er client dans l'UI"
echo "============================================"
pm2 list
