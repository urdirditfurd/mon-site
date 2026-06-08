#!/usr/bin/env bash
# Met à jour uniquement sentiq.html dans le conteneur (sans recreate).
set -euo pipefail

BACKEND="${BACKEND:-/root/mon-site/trading_backend}"
API="${API_CONTAINER:-trading-api}"

cd "$BACKEND"
docker cp app/web/sentiq.html "$API:/app/app/web/sentiq.html"
docker cp app/web/sentiq.html "$API:/app/app/web/dashboard.html"
docker cp app/web/sentiq.html "$API:/app/app/static/index.html"
docker restart "$API"
sleep 12
curl -s http://127.0.0.1:8000/ui | grep -o 'sentiq-version" content="[^"]*"' | head -1
echo ""
echo "UI déployée — Ctrl+Shift+R sur https://trading.agent-leads.fr/ui"
