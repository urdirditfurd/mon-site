#!/usr/bin/env sh
set -eu

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

if [ ! -f .env.docker ]; then
  cp .env.docker.example .env.docker
  echo "[run-docker] created .env.docker from template"
fi

if [ "${1:-}" = "--build" ]; then
  docker compose --env-file .env.docker up -d --build
else
  docker compose --env-file .env.docker up -d
fi

echo "[run-docker] services started"
docker compose ps
