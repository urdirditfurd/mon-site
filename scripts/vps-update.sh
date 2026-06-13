#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Mise à jour ClipForge depuis Git"
git fetch origin
git checkout main
git pull origin main

echo "==> Dépendances Node"
npm install

echo "==> Vérification syntaxe"
npm run check

if command -v yt-dlp >/dev/null 2>&1; then
  echo "==> yt-dlp: $(yt-dlp --version)"
else
  echo "==> ATTENTION: yt-dlp absent. Installe-le avec: pip3 install -U yt-dlp"
fi

if command -v ffmpeg >/dev/null 2>&1; then
  echo "==> ffmpeg: $(ffmpeg -version | head -n 1)"
else
  echo "==> ATTENTION: ffmpeg absent. Installe-le avec: sudo apt install -y ffmpeg"
fi

if command -v pm2 >/dev/null 2>&1; then
  echo "==> Redémarrage PM2 (clipforge)"
  export PORT="${PORT:-3000}"
  pm2 restart clipforge || pm2 start server/index.js --name clipforge
  pm2 save
elif systemctl is-active --quiet clipforge 2>/dev/null; then
  echo "==> Redémarrage systemd (clipforge)"
  sudo systemctl restart clipforge
else
  echo "==> Aucun service détecté. Lance manuellement: npm start"
fi

echo "==> Terminé. Teste: curl -s http://127.0.0.1:3000/api/health"
