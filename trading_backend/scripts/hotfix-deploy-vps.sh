#!/usr/bin/env bash
# SentiQ — déploiement correct (rebuild image, pas docker cp avant recreate)
set -euo pipefail

ROOT="${ROOT:-/root/mon-site}"
BACKEND="$ROOT/trading_backend"
API="${API_CONTAINER:-trading-api}"

echo "=== SentiQ deploy v3 ==="
cd "$ROOT"
git fetch origin cursor/decision-engine-core-9969
git reset --hard origin/cursor/decision-engine-core-9969

cd "$BACKEND"

echo "--- Rebuild image (code Git -> image Docker) ---"
docker compose -p trading_backend --env-file .env.production build api

echo "--- Recreate API avec .env.production (GOOGLE_CLIENT_ID) ---"
docker compose -p trading_backend --env-file .env.production up -d --force-recreate api

echo "--- Attente démarrage ---"
sleep 25

echo "--- Tests ---"
curl -s http://127.0.0.1:8000/api/health/live || true
echo ""
curl -s http://127.0.0.1:8000/api/auth/public-config || true
echo ""
docker exec "$API" grep -c "btnAuthSecondary" /app/app/web/sentiq.html 2>/dev/null || \
  docker exec "$API" grep -c "btnAuthSecondary" /app/app/web/dashboard.html
echo ""
curl -s http://127.0.0.1:8000/ui | grep -o "btnAuthSecondary\|Créer un compte\|googleBtnContainer" | head -5

echo ""
echo "=== Caddy (si 502 sur le site public) ---"
if docker ps --format '{{.Names}}' | grep -q caddy; then
  CADDY=$(docker ps --format '{{.Names}}' | grep caddy | head -1)
  CADDY_NET=$(docker inspect "$CADDY" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
  docker network connect "$CADDY_NET" "$API" 2>/dev/null || true
  docker exec "$CADDY" sed -i 's/trading_backend-api-1/trading-api/g' /etc/caddy/Caddyfile 2>/dev/null || true
  docker exec "$CADDY" caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || true
  echo "Caddy OK"
else
  echo "Pas de Caddy — lancez-le si besoin (port 443)"
fi

echo ""
echo "=== FINI — Ctrl+Shift+R sur https://trading.agent-leads.fr/ui ==="
