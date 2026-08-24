#!/usr/bin/env bash
set -euo pipefail

# Corrige l'erreur Safari / iPhone :
# « Safari ne peut pas ouvrir la page car la connexion réseau a été interrompue »
#
# Cause : HTTPS sur le port 3010 (non standard). Safari et beaucoup de réseaux
# 4G/Wi‑Fi coupent ce trafic. Solution : HTTPS sur le port 443.
#
# Usage (root, n'importe quel dossier) :
#   curl -fsSL "https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/prospection-contacts-stream-0325/scripts/vps-prospection-safari-fix.sh" | bash

APP_DIR="${APP_DIR:-/root/mon-site}"
DOMAIN="${PROSPECTION_DOMAIN:-51-254-135-158.sslip.io}"
INTERNAL_PORT="${INTERNAL_PORT:-3011}"
OLD_PORT="${PUBLIC_PORT:-3010}"
CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
KEY="/etc/letsencrypt/live/${DOMAIN}/privkey.pem"
ACME_ROOT="/var/www/acme-prospection"
NGINX_SITE="/etc/nginx/sites-available/prospection"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Lance ce script en root."
  exit 1
fi

if [[ ! -f "$CERT" || ! -f "$KEY" ]]; then
  echo "Certificat Let's Encrypt introuvable. Relance d'abord :"
  echo "  curl -fsSL https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/prospection-contacts-stream-0325/scripts/vps-prospection-https.sh | bash"
  exit 1
fi

mkdir -p "$ACME_ROOT"

SSL_EXTRA=""
if [[ -f /etc/letsencrypt/options-ssl-nginx.conf ]]; then
  SSL_EXTRA="    include /etc/letsencrypt/options-ssl-nginx.conf;"
fi
if [[ -f /etc/letsencrypt/ssl-dhparams.pem ]]; then
  SSL_EXTRA="${SSL_EXTRA}
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;"
fi

# nginx 1.24 : http2 se déclare sur listen ; 1.25+ accepte « http2 on ».
HTTP2_LISTEN=" ssl http2"
if nginx -v 2>&1 | grep -Eq 'nginx/1\.(2[5-9]|[3-9])'; then
  HTTP2_LISTEN=" ssl"
  HTTP2_DIR="    http2 on;"
else
  HTTP2_DIR=""
fi

cat > "$NGINX_SITE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root ${ACME_ROOT};
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443${HTTP2_LISTEN};
    listen [::]:443${HTTP2_LISTEN};
${HTTP2_DIR}
    server_name ${DOMAIN};

    ssl_certificate     ${CERT};
    ssl_certificate_key ${KEY};
${SSL_EXTRA}
    ssl_protocols TLSv1.2 TLSv1.3;

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

server {
    listen ${OLD_PORT} ssl;
    listen [::]:${OLD_PORT} ssl;
    server_name ${DOMAIN};

    ssl_certificate     ${CERT};
    ssl_certificate_key ${KEY};
${SSL_EXTRA}
    ssl_protocols TLSv1.2 TLSv1.3;

    return 301 https://\$host\$request_uri;
}
EOF

ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/prospection
nginx -t
systemctl reload nginx

echo ""
echo "=========================================="
echo " Safari / iPhone : utilisez désormais"
echo "   https://${DOMAIN}/prospection"
echo " (sans :3010)"
echo "=========================================="
echo "Test local :"
curl -sS --max-time 8 "https://127.0.0.1/api/health" -H "Host: ${DOMAIN}" -k || true
echo ""
