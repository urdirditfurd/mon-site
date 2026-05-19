#!/usr/bin/env sh
set -eu

echo "[entrypoint] starting trading-backend container"

if [ "${RUN_MIGRATIONS_ON_STARTUP:-true}" = "true" ]; then
  echo "[entrypoint] applying alembic migrations"
  alembic -c /app/alembic.ini upgrade head
fi

echo "[entrypoint] launching api server"
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
