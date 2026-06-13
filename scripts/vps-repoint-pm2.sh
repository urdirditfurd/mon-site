#!/usr/bin/env bash
set -euo pipefail
# Force PM2 à servir /opt/clipforge (corrige UI qui ne change pas)
cd /root

APP_DIR="/opt/clipforge"
export PORT="${PORT:-3000}"

echo "==> Fichier local (doit contenir downloadAllBtn)"
grep -q 'downloadAllBtn' "$APP_DIR/index.html" && echo "OK: index.html à jour dans $APP_DIR" || {
  echo "ERREUR: $APP_DIR/index.html pas à jour"
  exit 1
}

echo "==> Processus actuel sur le port ${PORT}"
ss -tlnp 2>/dev/null | grep ":${PORT} " || echo "(aucun listener)"

echo "==> Libération du port ${PORT} (tue les Node zombies hors PM2)"
pm2 delete clipforge >/dev/null 2>&1 || true
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" >/dev/null 2>&1 || true
fi
sleep 1

echo "==> Redémarrage depuis $APP_DIR"
cd "$APP_DIR"
pm2 start server/index.js --name clipforge
pm2 save

sleep 2
echo "==> Test local (doit afficher downloadAllBtn)"
curl -s "http://127.0.0.1:${PORT}/api/health" | grep -o '"uiSimplified":[^,}]*' || true
curl -s "http://127.0.0.1:${PORT}/" | grep -o 'downloadAllBtn\|exportClipBtn' | head -3 || true

echo "==> Terminé. Rafraîchis le navigateur avec Ctrl+F5 sur http://TON_IP"
