#!/usr/bin/env sh
set -eu

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

DATABASE_URL="${DATABASE_URL:-postgresql+asyncpg://postgres:postgres@localhost:5432/trading_ai}"
AUTH_SECRET_KEY="${AUTH_SECRET_KEY:-change-me-in-production}"
PORT="${PORT:-8000}"
SKIP_MIGRATIONS="${SKIP_MIGRATIONS:-false}"

export DATABASE_URL
export AUTH_SECRET_KEY
export AUTO_CREATE_TABLES=false

echo "[run-local] project root: $PROJECT_ROOT"
echo "[run-local] database: $DATABASE_URL"

if [ "$SKIP_MIGRATIONS" != "true" ]; then
  echo "[run-local] applying migrations..."
  alembic -c ./alembic.ini upgrade head
fi

echo "[run-local] starting API on port $PORT"
exec uvicorn app.main:app --reload --port "$PORT"
