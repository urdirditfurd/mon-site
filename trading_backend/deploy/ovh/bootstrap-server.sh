#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Relance ce script avec sudo: sudo bash deploy/ovh/bootstrap-server.sh"
  exit 1
fi

TARGET_USER="${SUDO_USER:-ubuntu}"

echo "[bootstrap] Mise à jour système"
apt-get update
apt-get install -y ca-certificates curl git ufw openssl

echo "[bootstrap] Installation Docker Engine"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | tee /etc/apt/keyrings/docker.asc >/dev/null
chmod a+r /etc/apt/keyrings/docker.asc

. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  | tee /etc/apt/sources.list.d/docker.list >/dev/null

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo "[bootstrap] Activation Docker"
systemctl enable --now docker
usermod -aG docker "${TARGET_USER}"

echo "[bootstrap] Pare-feu UFW"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "[bootstrap] OK"
echo "Déconnecte-toi puis reconnecte-toi en SSH pour activer le groupe docker pour ${TARGET_USER}."
