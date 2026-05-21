#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/urdirditfurd/mon-site.git}"
if [ -n "${BRANCH:-}" ]; then
  TARGET_BRANCH="${BRANCH}"
elif git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  TARGET_BRANCH="$(git branch --show-current)"
else
  TARGET_BRANCH="main"
fi
BRANCH="${TARGET_BRANCH}"
APP_DIR="${APP_DIR:-$HOME/mon-site}"
BACKEND_DIR="${APP_DIR}/trading_backend"
ENV_FILE="${BACKEND_DIR}/.env.production"

echo "[deploy] Repo: ${REPO_URL}"
echo "[deploy] Branche: ${BRANCH}"
echo "[deploy] Dossier: ${APP_DIR}"

if ! command -v docker >/dev/null 2>&1; then
  echo "[deploy] Docker est introuvable. Lance d'abord: sudo bash deploy/ovh/bootstrap-server.sh"
  exit 1
fi

if [ ! -d "${APP_DIR}/.git" ]; then
  echo "[deploy] Clonage du dépôt"
  git clone --branch "${BRANCH}" "${REPO_URL}" "${APP_DIR}"
else
  echo "[deploy] Mise à jour du dépôt"
  git -C "${APP_DIR}" fetch origin "${BRANCH}"
  git -C "${APP_DIR}" checkout "${BRANCH}"
  git -C "${APP_DIR}" pull origin "${BRANCH}"
fi

if [ ! -f "${ENV_FILE}" ]; then
  echo "[deploy] Création du fichier ${ENV_FILE}"
  cp "${BACKEND_DIR}/.env.production.example" "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"
  cat <<'MSG'

IMPORTANT:
  Édite maintenant trading_backend/.env.production et remplace:
  - POSTGRES_PASSWORD
  - AUTH_SECRET_KEY
  - DOMAIN
  - ACME_EMAIL

Exemples:
  openssl rand -hex 32
  nano trading_backend/.env.production

Relance ensuite ce script.
MSG
  exit 1
fi

if grep -q "replace-with-" "${ENV_FILE}"; then
  echo "[deploy] Le fichier .env.production contient encore des valeurs placeholder."
  echo "[deploy] Édite ${ENV_FILE}, puis relance ce script."
  exit 1
fi

echo "[deploy] Build et démarrage Docker Compose"
docker compose --env-file "${ENV_FILE}" -f "${BACKEND_DIR}/docker-compose.prod.yml" up -d --build

echo "[deploy] État des services"
docker compose --env-file "${ENV_FILE}" -f "${BACKEND_DIR}/docker-compose.prod.yml" ps

DOMAIN="$(grep '^DOMAIN=' "${ENV_FILE}" | cut -d= -f2-)"
echo "[deploy] Déploiement terminé."
echo "[deploy] Healthcheck: https://${DOMAIN}/api/health"
echo "[deploy] UI: https://${DOMAIN}/ui"
