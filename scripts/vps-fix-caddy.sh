#!/usr/bin/env bash
set -euo pipefail
# Corrige le conflit Caddy -> HTTPS sur IP (ERR_SSL_PROTOCOL_ERROR)
# Usage: curl -fsSL .../vps-fix-caddy.sh | bash

cd /root

echo "==> Stop Caddy"
systemctl stop caddy 2>/dev/null || true
systemctl disable caddy 2>/dev/null || true
pkill -x caddy 2>/dev/null || true

if command -v docker >/dev/null 2>&1; then
  for name in $(docker ps --format '{{.Names}}' 2>/dev/null | grep -i caddy || true); do
    docker stop "$name" >/dev/null 2>&1 || true
  done
fi

echo "==> Vérifier port 80"
ss -tlnp | grep ':80' || echo "(port 80 libre)"

echo "==> Démarrer ClipForge si besoin"
if ! curl -sf http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
  if [[ ! -d /opt/clipforge/server ]]; then
    rm -rf /opt/clipforge
    git clone --branch cursor/fix-clipforge-deployment-cb8f https://github.com/urdirditfurd/mon-site.git /opt/clipforge
    cd /opt/clipforge && npm install
  fi
  export PORT=3000
  pm2 delete clipforge >/dev/null 2>&1 || true
  pm2 start /opt/clipforge/server/index.js --name clipforge
  pm2 save
fi

echo "==> Config Nginx HTTP"
cat > /etc/nginx/sites-available/clipforge <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    client_max_body_size 900M;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 600s;
    }
}
EOF

ln -sf /etc/nginx/sites-available/clipforge /etc/nginx/sites-enabled/clipforge
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t
systemctl enable nginx >/dev/null 2>&1 || true
systemctl restart nginx

sleep 1
echo ""
echo "==> TEST (doit afficher HTTP/1.1 200 OK, PAS 308)"
curl -I http://127.0.0.1/ 2>/dev/null | head -n 3
curl -I http://51.254.135.158/ 2>/dev/null | head -n 3
echo ""
echo "Ouvre dans le navigateur:"
echo "  http://51.254.135.158"
echo "(avec http:// au début, PAS https://)"
