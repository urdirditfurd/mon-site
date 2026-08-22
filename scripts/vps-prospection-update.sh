#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

GIT_BRANCH="${GIT_BRANCH:-cursor/prospection-contacts-stream-0325}"
PUBLIC_PORT="${PUBLIC_PORT:-3010}"
INTERNAL_PORT="${INTERNAL_PORT:-3011}"

echo "==> Mise à jour agent de prospection"
git fetch origin
git checkout "$GIT_BRANCH" 2>/dev/null || git checkout -B "$GIT_BRANCH" "origin/$GIT_BRANCH"
git pull origin "$GIT_BRANCH"

npm install
npm run check
node --test agent-prospection/server/prospection-agent.test.js

if command -v pm2 >/dev/null 2>&1; then
  echo "==> Redémarrage PM2 (prospection)"
  pm2 restart prospection || pm2 start ecosystem.prospection.config.cjs
  pm2 save
else
  echo "==> PM2 absent — installez avec: npm install -g pm2"
  exit 1
fi

sleep 1
echo "==> Health interne: $(curl -sS "http://127.0.0.1:${INTERNAL_PORT}/api/health" || echo ERREUR)"
echo "==> Health public: $(curl -sS "http://127.0.0.1:${PUBLIC_PORT}/api/health" || echo ERREUR)"
echo "==> Terminé."
