#!/usr/bin/env bash
set -euo pipefail
# Corrige le cas où un ancien Node occupe le port 3000 et sert une UI obsolète.
# Usage (root sur le VPS): cd /opt/clipforge && bash scripts/vps-fix-all.sh

APP_DIR="${APP_DIR:-/opt/clipforge}"
PORT="${PORT:-3000}"
REPO_URL="${REPO_URL:-https://github.com/urdirditfurd/mon-site.git}"
GIT_BRANCH="${GIT_BRANCH:-main}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Lance ce script en root (sudo -i)."
  exit 1
fi

kill_port() {
  local port="$1"
  echo "==> Libération du port ${port}"
  if command -v ss >/dev/null 2>&1; then
    ss -tlnp | grep ":${port} " || echo "    (aucun listener sur ${port})"
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" >/dev/null 2>&1 || true
  fi
  sleep 1
}

echo "==> ClipForge — correction processus / UI obsolète"
echo "    Dossier: $APP_DIR"
echo "    Port:    $PORT"

echo "==> Arrêt des services connus"
pm2 delete clipforge >/dev/null 2>&1 || true
systemctl stop clipforge >/dev/null 2>&1 || true

if command -v docker >/dev/null 2>&1; then
  mapfile -t docker_ids < <(docker ps -q --filter "publish=${PORT}" 2>/dev/null || true)
  if ((${#docker_ids[@]} > 0)); then
    echo "==> Arrêt conteneurs Docker sur le port ${PORT}"
    docker stop "${docker_ids[@]}" >/dev/null 2>&1 || true
  fi
fi

kill_port "$PORT"

echo "==> Synchronisation Git (${GIT_BRANCH})"
if [[ ! -d "$APP_DIR/.git" ]]; then
  rm -rf "$APP_DIR"
  git clone --branch "$GIT_BRANCH" "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
git fetch origin
git checkout "$GIT_BRANCH"
git reset --hard "origin/$GIT_BRANCH"

echo "==> Vérification fichiers locaux"
grep -q 'downloadAllBtn' "$APP_DIR/index.html" || {
  echo "ERREUR: index.html sans downloadAllBtn après git reset"
  exit 1
}
INDEX_BYTES=$(wc -c < "$APP_DIR/index.html" | tr -d ' ')
echo "    index.html: ${INDEX_BYTES} octets (attendu ~4800)"

npm install --omit=dev >/dev/null 2>&1 || npm install

echo "==> Démarrage PM2 depuis $APP_DIR"
cd "$APP_DIR"
export PORT="$PORT"
pm2 start server/index.js --name clipforge
pm2 save

sleep 2

echo "==> Diagnostic API"
HEALTH=$(curl -sS "http://127.0.0.1:${PORT}/api/health" || echo '{"ok":false}')
echo "$HEALTH" | head -c 400
echo ""

UI_OK=$(echo "$HEALTH" | grep -o '"uiSimplified":true' || true)
ROOT_DIR=$(echo "$HEALTH" | grep -o '"rootDir":"[^"]*"' || true)
echo "    ${ROOT_DIR:-rootDir inconnu}"
echo "    uiSimplified: ${UI_OK:-MANQUANT ou false}"

echo "==> Test HTML local"
HTML_MARK=$(curl -sS "http://127.0.0.1:${PORT}/" | grep -o 'downloadAllBtn\|exportClipBtn' | head -3 || true)
echo "    boutons servis: ${HTML_MARK:-AUCUN}"

if [[ -z "$UI_OK" ]] || ! echo "$HTML_MARK" | grep -q 'downloadAllBtn'; then
  echo ""
  echo "ERREUR: l'UI servie est encore obsolète."
  echo "Processus sur ${PORT}:"
  ss -tlnp | grep ":${PORT} " || true
  pm2 describe clipforge 2>/dev/null | grep -E 'script path|exec cwd|status|restarts' || true
  exit 1
fi

PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo ""
echo "=========================================="
echo " OK — UI simplifiée active."
echo " Ouvre: http://${PUBLIC_IP}/  (Ctrl+F5)"
echo " Santé: curl -s http://127.0.0.1:${PORT}/api/health"
echo "=========================================="
