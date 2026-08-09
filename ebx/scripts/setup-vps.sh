#!/usr/bin/env bash
# Déploie EBX sur un VPS Ubuntu/Debian (Nginx + PM2 + HTTPS optionnel).
# Usage (en root sur le VPS) :
#   curl -fsSL … | bash   OU   bash setup-vps.sh
# Variables optionnelles :
#   REPO_URL=https://github.com/urdirditfurd/mon-site.git
#   BRANCH=cursor/ebx-dashboard-0eb5
#   APP_DIR=/var/www/ebx
#   DOMAIN=ebx.mondomaine.com   # laisse vide = HTTP IP seulement
#   AUTH_USER=admin
#   AUTH_PASS=change-moi

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/urdirditfurd/mon-site.git}"
BRANCH="${BRANCH:-cursor/ebx-dashboard-0eb5}"
APP_DIR="${APP_DIR:-/var/www/ebx}"
DOMAIN="${DOMAIN:-}"
AUTH_USER="${AUTH_USER:-admin}"
AUTH_PASS="${AUTH_PASS:-}"
PORT="${PORT:-3000}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Lance ce script en root (sudo -i)."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git nginx ufw ca-certificates gnupg

# Node 22 (requis par ebx/package.json)
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
  rm -rf "$APP_DIR"
  git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR/ebx"
npm install --omit=dev

if [[ ! -f .env ]]; then
  cp .env.example .env
  if [[ -z "$AUTH_PASS" ]]; then
    AUTH_PASS="$(openssl rand -base64 18 | tr -d '=+/' | cut -c1-16)"
  fi
  sed -i "s/^EBX_BASIC_AUTH_USER=.*/EBX_BASIC_AUTH_USER=${AUTH_USER}/" .env
  sed -i "s/^EBX_BASIC_AUTH_PASS=.*/EBX_BASIC_AUTH_PASS=${AUTH_PASS}/" .env
  echo ""
  echo ">>> Mot de passe généré (note-le) : ${AUTH_USER} / ${AUTH_PASS}"
  echo ">>> Complète ensuite les clés eBay dans ${APP_DIR}/ebx/.env"
fi

pm2 delete ebx >/dev/null 2>&1 || true
pm2 start server.js --name ebx --cwd "$APP_DIR/ebx"
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

# Nginx reverse proxy
if [[ -n "$DOMAIN" ]]; then
  SERVER_NAME="$DOMAIN"
else
  SERVER_NAME="_"
fi

cat >/etc/nginx/sites-available/ebx <<NGINX
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

ln -sfn /etc/nginx/sites-available/ebx /etc/nginx/sites-enabled/ebx
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable || true

if [[ -n "$DOMAIN" ]]; then
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@${DOMAIN}" --redirect || {
    echo "Certbot a échoué — vérifie que le DNS ${DOMAIN} pointe vers ce VPS, puis relance :"
    echo "  certbot --nginx -d ${DOMAIN}"
  }
fi

IP="$(curl -4 -s ifconfig.me || hostname -I | awk '{print $1}')"
echo ""
echo "============================================"
echo " EBX est en ligne"
if [[ -n "$DOMAIN" ]]; then
  echo " URL : https://${DOMAIN}"
else
  echo " URL : http://${IP}"
fi
echo " App  : ${APP_DIR}/ebx"
echo " Logs : pm2 logs ebx"
echo " .env : nano ${APP_DIR}/ebx/.env && pm2 restart ebx"
echo "============================================"
