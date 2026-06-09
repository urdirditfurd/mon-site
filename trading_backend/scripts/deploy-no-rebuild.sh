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
docker exec "$API" mkdir -p /app/app/web /app/app/static /app/app/services /app/app/schemas

FILES=(
  app/main.py
  app/api/auth_routes.py
  app/api/ui_routes.py
  app/api/news_routes.py
  app/core/config.py
  app/schemas/auth.py
  app/schemas/news.py
  app/services/google_oauth.py
  app/services/telegram_news.py
  app/services/rss_news.py
  app/services/rss_feed_catalog.py
  app/services/news_feed_hub.py
  app/web/sentiq.html
)

for f in "${FILES[@]}"; do
  docker cp "$f" "$API:/app/$f"
done

docker cp app/web/sentiq.html "$API:/app/app/web/dashboard.html"
docker cp app/web/sentiq.html "$API:/app/app/static/index.html"

echo "--- Purge __pycache__ ---"
docker exec "$API" sh -c 'find /app/app -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null; find /app/app -name "*.pyc" -delete 2>/dev/null; true'

echo "--- Restart (PAS recreate — garde les fichiers copiés) ---"
docker restart "$API"
sleep 20

echo "--- Tests ---"
curl -sf http://127.0.0.1:8000/api/auth/public-config
echo ""
curl -s http://127.0.0.1:8000/api/news/rss/status || true
echo ""
curl -s http://127.0.0.1:8000/api/news/telegram/status || true
echo ""
curl -s http://127.0.0.1:8000/ui | grep -o "btnAuthSecondary\|Créer un compte\|googleBtnContainer" | head -5
echo ""
docker inspect "$API" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep GOOGLE || echo "GOOGLE_CLIENT_ID absent du conteneur!"

echo ""
echo "=== Ctrl+Shift+R sur https://trading.agent-leads.fr/ui ==="
