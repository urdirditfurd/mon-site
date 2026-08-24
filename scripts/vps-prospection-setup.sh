#!/usr/bin/env bash
set -euo pipefail

# Installation / réparation de l'agent de prospection sur VPS OVH.
# Lance le serveur léger (sans ClipForge), PM2 + redémarrage auto, Nginx sur le port public.
#
# Usage (root sur le VPS) :
#   curl -fsSL "https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/prospection-contacts-stream-0325/scripts/vps-prospection-setup.sh" | bash
#
# HTTPS (cadenas) :
#   curl -fsSL ".../scripts/vps-prospection-https.sh" | bash
#
# Variables optionnelles :
#   APP_DIR=/root/mon-site
#   GIT_BRANCH=cursor/prospection-contacts-stream-0325
#   PUBLIC_PORT=3010
#   INTERNAL_PORT=3011
#   PUBLIC_IP=51.254.135.158
#   PROSPECTION_DOMAIN=51-254-135-158.sslip.io
#   ENABLE_HTTPS=1

APP_DIR="${APP_DIR:-/root/mon-site}"
REPO_URL="${REPO_URL:-https://github.com/urdirditfurd/mon-site.git}"
GIT_BRANCH="${GIT_BRANCH:-cursor/prospection-contacts-stream-0325}"
PUBLIC_PORT="${PUBLIC_PORT:-3010}"
INTERNAL_PORT="${INTERNAL_PORT:-3011}"
PROSPECTION_DOMAIN="${PROSPECTION_DOMAIN:-}"
ENABLE_HTTPS="${ENABLE_HTTPS:-0}"
PUBLIC_IP="${PUBLIC_IP:-}"
ACME_ROOT="/var/www/acme-prospection"

detect_public_ipv4() {
  local ip=""
  ip="$(curl -4 -s ifconfig.me 2>/dev/null || true)"
  if [[ -z "$ip" ]]; then
    ip="$(curl -4 -s icanhazip.com 2>/dev/null || true)"
  fi
  if [[ -z "$ip" ]]; then
    ip="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1 || true)"
  fi
  echo "$ip"
}

ipv4_to_sslip() {
  echo "${1//./-}.sslip.io"
}

echo "==> Agent de prospection — installation VPS"
echo "    Dossier:       $APP_DIR"
echo "    Port public:   $PUBLIC_PORT"
echo "    Port Node:     $INTERNAL_PORT (127.0.0.1)"
echo "    Branche Git:   $GIT_BRANCH"
echo "    HTTPS:         $ENABLE_HTTPS"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Lance ce script en root : sudo -i puis bash scripts/vps-prospection-setup.sh"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y git curl ca-certificates nginx

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

if [[ -z "$PUBLIC_IP" ]]; then
  PUBLIC_IP="$(detect_public_ipv4)"
fi
if [[ -z "$PROSPECTION_DOMAIN" && -n "$PUBLIC_IP" ]]; then
  PROSPECTION_DOMAIN="$(ipv4_to_sslip "$PUBLIC_IP")"
fi
echo "    IP publique:   ${PUBLIC_IP:-inconnue}"
echo "    Domaine SSL:   ${PROSPECTION_DOMAIN:-aucun}"

if [[ -d "$APP_DIR/.git" ]]; then
  cd "$APP_DIR"
  git fetch origin
  git checkout "$GIT_BRANCH" 2>/dev/null || git checkout -B "$GIT_BRANCH" "origin/$GIT_BRANCH"
  git pull origin "$GIT_BRANCH" || true
else
  git clone --branch "$GIT_BRANCH" "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

npm install
npm run check
node --test agent-prospection/server/prospection-agent.test.js

pm2 delete prospection >/dev/null 2>&1 || true
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${INTERNAL_PORT}/tcp" >/dev/null 2>&1 || true
  sleep 1
fi

export HOST="127.0.0.1"
export PORT="$INTERNAL_PORT"
export TRUST_PROXY="1"
pm2 start ecosystem.prospection.config.cjs
pm2 save

STARTUP_LINE="$(pm2 startup systemd -u root --hp /root 2>/dev/null | grep -E '^sudo env' | tail -n 1 || true)"
if [[ -n "$STARTUP_LINE" ]]; then
  eval "$STARTUP_LINE" || true
fi

mkdir -p "$ACME_ROOT"
NGINX_SITE="/etc/nginx/sites-available/prospection"

write_http_proxy_config() {
  cat > "$NGINX_SITE" <<EOF
server {
    listen ${PUBLIC_PORT};
    listen [::]:${PUBLIC_PORT};
    server_name _;

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:${INTERNAL_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 600s;
        proxy_buffering off;
    }
}
EOF
}

write_https_config() {
  local ssl_extra=""
  if [[ -f /etc/letsencrypt/options-ssl-nginx.conf ]]; then
    ssl_extra="    include /etc/letsencrypt/options-ssl-nginx.conf;"
  fi
  if [[ -f /etc/letsencrypt/ssl-dhparams.pem ]]; then
    ssl_extra="${ssl_extra}
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;"
  fi
  cat > "$NGINX_SITE" <<EOF
# HTTP → HTTPS 443 (Safari / iPhone : pas de port exotique)
server {
    listen 80;
    listen [::]:80;
    server_name ${PROSPECTION_DOMAIN};

    location /.well-known/acme-challenge/ {
        root ${ACME_ROOT};
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

# HTTPS standard — lien client : https://${PROSPECTION_DOMAIN}/prospection
server {
    listen 0.0.0.0:443 ssl;
    listen [::]:443 ssl;
    server_name ${PROSPECTION_DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${PROSPECTION_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${PROSPECTION_DOMAIN}/privkey.pem;
${ssl_extra}

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:${INTERNAL_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 600s;
        proxy_buffering off;
    }
}

# Ancien lien :3010 → 443 (évite l’erreur Safari « connexion interrompue »)
server {
    listen 0.0.0.0:${PUBLIC_PORT} ssl;
    listen [::]:${PUBLIC_PORT} ssl;
    server_name ${PROSPECTION_DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${PROSPECTION_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${PROSPECTION_DOMAIN}/privkey.pem;
${ssl_extra}

    return 301 https://\$host\$request_uri;
}
EOF
}

if [[ "$ENABLE_HTTPS" == "1" && -n "$PROSPECTION_DOMAIN" ]]; then
  apt-get install -y certbot python3-certbot-nginx

  CERT_PATH="/etc/letsencrypt/live/${PROSPECTION_DOMAIN}/fullchain.pem"
  if [[ ! -f "$CERT_PATH" ]]; then
    echo "==> Obtention certificat Let's Encrypt pour ${PROSPECTION_DOMAIN}"
    cat > /etc/nginx/sites-available/prospection-acme <<EOF
server {
    listen 80;
    server_name ${PROSPECTION_DOMAIN};

    location /.well-known/acme-challenge/ {
        root ${ACME_ROOT};
    }

    location / {
        return 200 'ok';
        add_header Content-Type text/plain;
    }
}
EOF
    ln -sf /etc/nginx/sites-available/prospection-acme /etc/nginx/sites-enabled/prospection-acme
    nginx -t
    systemctl reload nginx

    certbot certonly --webroot -w "$ACME_ROOT" -d "$PROSPECTION_DOMAIN" \
      --non-interactive --agree-tos --register-unsafely-without-email \
      || certbot certonly --webroot -w "$ACME_ROOT" -d "$PROSPECTION_DOMAIN" \
      --non-interactive --agree-tos -m "admin@${PROSPECTION_DOMAIN}"

    rm -f /etc/nginx/sites-enabled/prospection-acme
  fi

  if [[ ! -f "$CERT_PATH" ]]; then
    echo "ERREUR: certificat introuvable pour ${PROSPECTION_DOMAIN}"
    echo "       Vérifiez que le port 80 est ouvert et que le DNS pointe vers ${PUBLIC_IP}"
    write_http_proxy_config
  else
    write_https_config
  fi
else
  write_http_proxy_config
fi

ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/prospection
nginx -t
systemctl enable nginx >/dev/null 2>&1 || true
systemctl reload nginx

sleep 2
HEALTH_INTERNAL="$(curl -sS "http://127.0.0.1:${INTERNAL_PORT}/api/health" 2>/dev/null || echo ERREUR)"
HEALTH_PUBLIC="$(curl -sS -k "https://127.0.0.1:${PUBLIC_PORT}/api/health" 2>/dev/null || curl -sS "http://127.0.0.1:${PUBLIC_PORT}/api/health" 2>/dev/null || echo ERREUR)"

WATCHDOG="$APP_DIR/scripts/vps-prospection-watchdog.sh"
if [[ -x "$WATCHDOG" ]]; then
  CRON_LINE="*/5 * * * * $WATCHDOG >> /var/log/prospection-watchdog.log 2>&1"
  if ! crontab -l 2>/dev/null | grep -Fq "vps-prospection-watchdog.sh"; then
    (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
    echo "==> Watchdog cron installé (toutes les 5 min)"
  fi
fi

echo ""
echo "=========================================="
echo " Prospection installée."
echo ""
echo " PM2:      pm2 status prospection"
echo " Logs:     pm2 logs prospection --lines 50"
echo " Health:   $HEALTH_PUBLIC"
echo ""
if [[ "$ENABLE_HTTPS" == "1" && -f "/etc/letsencrypt/live/${PROSPECTION_DOMAIN}/fullchain.pem" ]]; then
  echo " URL Safari / iPhone (à envoyer au client) :"
  echo "   https://${PROSPECTION_DOMAIN}/prospection"
  echo ""
  echo " Ancien lien :3010 redirige vers 443."
  echo ""
fi
echo " URL HTTP (IP directe) :"
echo "   http://${PUBLIC_IP}:${PUBLIC_PORT}/prospection"
echo ""
echo " Mise à jour : cd $APP_DIR && bash scripts/vps-prospection-update.sh"
echo "=========================================="
echo "Node interne: $HEALTH_INTERNAL"
