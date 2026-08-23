#!/usr/bin/env bash
set -euo pipefail

# Surveille le backend prospection et le redémarre si /api/health échoue.
# Cron recommandé (root) : */5 * * * * /root/mon-site/scripts/vps-prospection-watchdog.sh >> /var/log/prospection-watchdog.log 2>&1

INTERNAL_PORT="${INTERNAL_PORT:-3011}"
PUBLIC_PORT="${PUBLIC_PORT:-3010}"

check_url() {
  curl -sf --max-time 12 "$1" >/dev/null 2>&1
}

if check_url "http://127.0.0.1:${INTERNAL_PORT}/api/health"; then
  exit 0
fi

echo "$(date -Is) ALERTE: health interne KO — redémarrage PM2 prospection"
pm2 restart prospection || pm2 start /root/mon-site/ecosystem.prospection.config.cjs
sleep 3

if check_url "http://127.0.0.1:${INTERNAL_PORT}/api/health"; then
  echo "$(date -Is) OK: prospection rétabli après redémarrage"
  exit 0
fi

echo "$(date -Is) ERREUR: prospection toujours KO après redémarrage"
systemctl reload nginx 2>/dev/null || true
exit 1
