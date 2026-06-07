#!/usr/bin/env bash
# Corrige le 404 sur /api/auth/public-config après hot-deploy (sans rebuild image).
set -euo pipefail

ROOT="${ROOT:-/root/mon-site}"
BACKEND="$ROOT/trading_backend"
API="${API_CONTAINER:-trading-api}"

echo "=== Fix auth public-config (404) ==="
cd "$ROOT"
git fetch origin cursor/decision-engine-core-9969
git reset --hard origin/cursor/decision-engine-core-9969

cd "$BACKEND"

echo "--- Recreate API (env GOOGLE_CLIENT_ID) ---"
docker compose -p trading_backend --env-file .env.production up -d --force-recreate api
sleep 15

echo "--- Copie du code auth + UI (APRÈS recreate) ---"
docker exec "$API" mkdir -p /app/app/web /app/app/static /app/app/services /app/app/schemas

FILES=(
  app/main.py
  app/api/auth_routes.py
  app/api/ui_routes.py
  app/core/config.py
  app/schemas/auth.py
  app/services/google_oauth.py
  app/web/sentiq.html
)

for f in "${FILES[@]}"; do
  echo "  cp $f"
  docker cp "$f" "$API:/app/$f"
done

docker cp app/web/sentiq.html "$API:/app/app/web/dashboard.html"
docker cp app/web/sentiq.html "$API:/app/app/static/index.html"

echo "--- Purge __pycache__ (cause fréquente du 404) ---"
docker exec "$API" sh -c 'find /app/app -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null; find /app/app -name "*.pyc" -delete 2>/dev/null; true'

echo "--- Restart (PAS recreate) ---"
docker restart "$API"
sleep 20

echo "--- Diagnostic conteneur ---"
docker exec "$API" grep -c public-config /app/app/api/auth_routes.py
docker exec "$API" grep -c public-config /app/app/main.py
docker exec "$API" python -c "
from app.main import app
paths = sorted({getattr(r, 'path', '') for r in app.routes if 'public-config' in getattr(r, 'path', '')})
print('routes public-config:', paths)
assert paths, 'route public-config absente du process Python'
"

echo "--- Test HTTP ---"
curl -sf http://127.0.0.1:8000/api/auth/public-config
echo ""
curl -s http://127.0.0.1:8000/openapi.json | grep -o '"/api/auth/public-config"' | head -1

echo ""
echo "=== OK — Ctrl+Shift+R sur https://trading.agent-leads.fr/ui ==="
