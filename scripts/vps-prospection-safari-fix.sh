#!/usr/bin/env bash
set -euo pipefail

# Corrige Safari / iPhone : HTTPS sur le port 443 (standard).
# Usage (root) :
#   curl -fsSL "https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/prospection-contacts-stream-0325/scripts/vps-prospection-safari-fix.sh" | bash

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
  echo "Certificat Let's Encrypt introuvable. Relance d'abord vps-prospection-https.sh"
  exit 1
fi

mkdir -p "$ACME_ROOT"

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
fi

echo "==> Ports avant :"
ss -tlnp | grep -E ':80|:443|:3010|:3011' || true

# Libère 443 si un ancien Caddy / process mort l'occupe (pas Nginx).
if command -v fuser >/dev/null 2>&1; then
  holders="$(ss -tlnp | grep ':443 ' || true)"
  if echo "$holders" | grep -Eqi 'caddy|docker-proxy' && ! echo "$holders" | grep -qi nginx; then
    echo "==> Port 443 occupé hors Nginx — tentative de libération"
    fuser -k 443/tcp >/dev/null 2>&1 || true
    sleep 1
  fi
fi

SSL_INCLUDE=""
if [[ -f /etc/letsencrypt/options-ssl-nginx.conf ]]; then
  SSL_INCLUDE="    include /etc/letsencrypt/options-ssl-nginx.conf;"
fi
if [[ -f /etc/letsencrypt/ssl-dhparams.pem ]]; then
  SSL_INCLUDE="${SSL_INCLUDE}
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;"
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
    listen 0.0.0.0:443 ssl;
    listen [::]:443 ssl;
    server_name ${DOMAIN};

    ssl_certificate     ${CERT};
    ssl_certificate_key ${KEY};
${SSL_INCLUDE}

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
    listen 0.0.0.0:${OLD_PORT} ssl;
    listen [::]:${OLD_PORT} ssl;
    server_name ${DOMAIN};

    ssl_certificate     ${CERT};
    ssl_certificate_key ${KEY};
${SSL_INCLUDE}

    return 301 https://\$host\$request_uri;
}
EOF

ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/prospection

echo "==> nginx -t"
nginx -t

# reload ne rebind pas toujours un nouveau port : restart
systemctl restart nginx
sleep 1

echo "==> Ports après :"
ss -tlnp | grep -E ':80|:443|:3010|:3011' || true

if ! ss -tlnp | grep -q ':443 '; then
  echo ""
  echo "ERREUR: Nginx n'écoute toujours pas sur 443."
  echo "Dernières lignes error.log :"
  tail -n 40 /var/log/nginx/error.log 2>/dev/null || true
  journalctl -u nginx -n 30 --no-pager 2>/dev/null || true
  exit 1
fi

echo ""
echo "==> Tests locaux"
echo -n "health 3011: "
curl -sS --max-time 5 "http://127.0.0.1:${INTERNAL_PORT}/api/health" || echo ECHEC
echo
echo -n "health 443 : "
curl -skS --max-time 8 --resolve "${DOMAIN}:443:127.0.0.1" "https://${DOMAIN}/api/health" || echo ECHEC
echo

echo "=========================================="
echo " Lien à envoyer au client (Safari / iPhone) :"
echo "   https://${DOMAIN}/prospection"
echo " (SANS :3010)"
echo "=========================================="
echo "Si Safari échoue encore : dans le pare-feu OVH, ouvrir TCP 443."
echo ""
