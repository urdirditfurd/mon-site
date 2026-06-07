#!/usr/bin/env bash
# Déploiement SentiQ SANS rebuild Docker (quand Docker Hub est inaccessible)
set -euo pipefail

ROOT="${ROOT:-/root/mon-site}"
BACKEND="$ROOT/trading_backend"
API="${API_CONTAINER:-trading-api}"

echo "=== SentiQ deploy sans rebuild ==="
cd "$ROOT"
git fetch origin cursor/decision-engine-core-9969
git reset --hard origin/cursor/decision-engine-core-9969

cd "$BACKEND"

echo "--- Recreate API (charge GOOGLE_CLIENT_ID depuis .env.production) ---"
docker compose -p trading_backend --env-file .env.production up -d --force-recreate api
sleep 15

echo "--- Copie du code dans le conteneur (APRÈS recreate) ---"
docker exec "$API" mkdir -p /app/app/web /app/app/static
docker cp app/web/sentiq.html "$API:/app/app/web/sentiq.html"
docker cp app/web/sentiq.html "$API:/app/app/web/dashboard.html"
docker cp app/web/sentiq.html "$API:/app/app/static/index.html"
docker cp app/api/auth_routes.py "$API:/app/app/api/auth_routes.py"
docker cp app/api/ui_routes.py "$API:/app/app/api/ui_routes.py"
docker cp app/core/config.py "$API:/app/app/core/config.py"
docker cp app/schemas/auth.py "$API:/app/app/schemas/auth.py"
docker cp app/services/google_oauth.py "$API:/app/app/services/google_oauth.py"

echo "--- Restart (PAS recreate — garde les fichiers copiés) ---"
docker restart "$API"
sleep 20

echo "--- Tests ---"
curl -s http://127.0.0.1:8000/api/auth/public-config || true
echo ""
curl -s http://127.0.0.1:8000/ui | grep -o "btnAuthSecondary\|Créer un compte\|googleBtnContainer" | head -5
echo ""
docker inspect "$API" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep GOOGLE || echo "GOOGLE_CLIENT_ID absent du conteneur!"

echo ""
echo "=== Ctrl+Shift+R sur https://trading.agent-leads.fr/ui ==="
