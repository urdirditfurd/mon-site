param(
    [string]$DatabaseUrl = "",
    [string]$AuthSecretKey = "change-me-in-production",
    [int]$Port = 8000,
    [switch]$NoStartApi
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

if (-not $DatabaseUrl) {
    $DatabaseUrl = "postgresql+asyncpg://postgres:postgres@localhost:5432/trading_ai"
}

Write-Host "[bootstrap] project root: $projectRoot"
Write-Host "[bootstrap] installing/updating dependencies..."
python -m pip install --upgrade pip
python -m pip install -r .\requirements.txt

Write-Host "[bootstrap] configuring environment..."
$env:DATABASE_URL = $DatabaseUrl
$env:AUTH_SECRET_KEY = $AuthSecretKey
$env:AUTO_CREATE_TABLES = "false"

Write-Host "[bootstrap] running migration checks..."
python .\scripts\migration_workflow.py check --strict

Write-Host "[bootstrap] applying database migrations..."
alembic -c .\alembic.ini upgrade head

Write-Host "[bootstrap] installing pre-commit hooks..."
pre-commit install --config .pre-commit-config.yaml

if ($NoStartApi) {
    Write-Host "[bootstrap] completed (API not started: -NoStartApi)"
    exit 0
}

Write-Host "[bootstrap] starting API on port $Port"
uvicorn app.main:app --reload --port $Port
