#!/usr/bin/env bash
# Hotfix SentiQ — déploie UI + auth Google SANS docker compose down
set -euo pipefail

ROOT="${ROOT:-/root/mon-site}"
BACKEND="$ROOT/trading_backend"
API="${API_CONTAINER:-trading-api}"

echo "=== SentiQ hotfix deploy ==="
cd "$ROOT"
git fetch origin cursor/decision-engine-core-9969
git checkout cursor/decision-engine-core-9969
git pull origin cursor/decision-engine-core-9969

UI_SRC="$BACKEND/app/web/sentiq.html"
if [[ ! -f "$UI_SRC" ]]; then
  echo "ERREUR: $UI_SRC introuvable"
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$API"; then
  API=$(docker ps --format '{{.Names}}' | grep -E 'api' | grep -v caddy | head -1)
  echo "Conteneur API détecté: $API"
fi

echo "--- Copie UI dans le conteneur (3 emplacements) ---"
docker exec "$API" mkdir -p /app/app/web /app/app/static
docker cp "$UI_SRC" "$API:/app/app/web/sentiq.html"
docker cp "$UI_SRC" "$API:/app/app/web/dashboard.html"
docker cp "$UI_SRC" "$API:/app/app/static/index.html"

echo "--- Copie backend auth Google ---"
docker cp "$BACKEND/app/api/auth_routes.py" "$API:/app/app/api/auth_routes.py"
docker cp "$BACKEND/app/api/ui_routes.py" "$API:/app/app/api/ui_routes.py"
docker cp "$BACKEND/app/core/config.py" "$API:/app/app/core/config.py"
docker cp "$BACKEND/app/schemas/auth.py" "$API:/app/app/schemas/auth.py"
docker cp "$BACKEND/app/services/google_oauth.py" "$API:/app/app/services/google_oauth.py"

echo "--- Vérification fichier UI dans le conteneur ---"
docker exec "$API" grep -c "btnAuthSecondary" /app/app/web/sentiq.html
docker exec "$API" grep -c "googleBtnContainer" /app/app/web/sentiq.html
docker exec "$API" grep -c "Phase 2" /app/app/web/sentiq.html && echo "ATTENTION: ancien texte Phase 2 encore présent!" || echo "OK: pas de Phase 2"

echo "--- Recréer API avec .env.production (SANS down) ---"
cd "$BACKEND"
docker compose -p trading_backend --env-file .env.production up -d --force-recreate api
sleep 20

echo "--- Test API ---"
curl -s http://127.0.0.1:8000/api/health/live || true
echo ""
curl -s http://127.0.0.1:8000/api/auth/public-config || true
echo ""

echo "--- Test UI ---"
curl -s http://127.0.0.1:8000/ui | grep -o "btnAuthSecondary\|Créer un compte\|googleBtnContainer\|sentiq-version" | head -6

echo ""
echo "=== FINI ==="
echo "Ouvrez https://trading.agent-leads.fr/ui avec Ctrl+Shift+R"
echo "Si Google ne marche pas, vérifiez dans .env.production:"
echo "  GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com"
