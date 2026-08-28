#!/bin/sh
set -e
mkdir -p /app/data
exec python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8100
