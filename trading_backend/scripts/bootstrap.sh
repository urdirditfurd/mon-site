#!/usr/bin/env sh
set -eu

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

DATABASE_URL="${DATABASE_URL:-postgresql+asyncpg://postgres:postgres@localhost:5432/trading_ai}"
AUTH_SECRET_KEY="${AUTH_SECRET_KEY:-change-me-in-production}"
PORT="${PORT:-8000}"
NO_START_API="${NO_START_API:-false}"

echo "[bootstrap] project root: $PROJECT_ROOT"
echo "[bootstrap] installing/updating dependencies..."
python3 -m pip install --upgrade pip
python3 -m pip install -r ./requirements.txt

echo "[bootstrap] configuring environment..."
export DATABASE_URL
export AUTH_SECRET_KEY
export AUTO_CREATE_TABLES=false

echo "[bootstrap] running migration checks..."
python3 ./scripts/migration_workflow.py check --strict

echo "[bootstrap] applying database migrations..."
alembic -c ./alembic.ini upgrade head

echo "[bootstrap] installing pre-commit hooks..."
pre-commit install --config .pre-commit-config.yaml

if [ "$NO_START_API" = "true" ]; then
  echo "[bootstrap] completed (API not started: NO_START_API=true)"
  exit 0
fi

echo "[bootstrap] starting API on port $PORT"
exec uvicorn app.main:app --reload --port "$PORT"
