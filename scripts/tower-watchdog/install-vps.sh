#!/usr/bin/env bash
set -euo pipefail

# Installe le watchdog tour sur le VPS OVH (Ubuntu/Debian)
# Usage: sudo bash install-vps.sh

APP_DIR="${APP_DIR:-/opt/tower-watchdog}"
REPO_URL="${REPO_URL:-https://github.com/urdirditfurd/mon-site.git}"
GIT_BRANCH="${GIT_BRANCH:-main}"
SERVICE_USER="${SERVICE_USER:-root}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Lance ce script en root: sudo bash install-vps.sh"
  exit 1
fi

echo "==> Installation Tower Watchdog"
apt-get update
apt-get install -y git python3 python3-pip curl

mkdir -p "$APP_DIR"
if [[ -d "$APP_DIR/.git" ]]; then
  cd "$APP_DIR"
  git pull origin "$GIT_BRANCH" || true
else
  rm -rf "$APP_DIR"
  git clone --branch "$GIT_BRANCH" --depth 1 "$REPO_URL" /tmp/mon-site-clone
  mkdir -p "$APP_DIR"
  cp -r /tmp/mon-site-clone/scripts/tower-watchdog/* "$APP_DIR/"
  rm -rf /tmp/mon-site-clone
fi

cd "$APP_DIR"
chmod +x watchdog.py install-vps.sh

if [[ ! -f config.json ]]; then
  cp config.example.json config.json
  echo ""
  echo "IMPORTANT: éditez $APP_DIR/config.json avant de démarrer."
  echo "  - tower.tailscale_ip"
  echo "  - notifications.discord_webhook"
  echo "  - smart_plug.*"
  echo ""
fi

mkdir -p /var/lib/tower-watchdog

cat > /etc/systemd/system/tower-watchdog.service <<EOF
[Unit]
Description=Tower Pinokio Watchdog
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/python3 ${APP_DIR}/watchdog.py
Restart=always
RestartSec=15

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable tower-watchdog
systemctl restart tower-watchdog

echo ""
echo "=========================================="
echo " Tower Watchdog installé."
echo ""
echo " Éditez la config:"
echo "   nano ${APP_DIR}/config.json"
echo ""
echo " Puis redémarrez:"
echo "   systemctl restart tower-watchdog"
echo ""
echo " Logs:"
echo "   journalctl -u tower-watchdog -f"
echo "=========================================="
