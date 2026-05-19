param(
    [switch]$SkipMigrations,
    [int]$Port = 8000,
    [string]$DatabaseUrl = "",
    [string]$AuthSecretKey = "change-me-in-production"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

if (-not $DatabaseUrl) {
    $DatabaseUrl = "postgresql+asyncpg://postgres:postgres@localhost:5432/trading_ai"
}

$env:DATABASE_URL = $DatabaseUrl
$env:AUTH_SECRET_KEY = $AuthSecretKey
$env:AUTO_CREATE_TABLES = "false"

Write-Host "[run-local] project root: $projectRoot"
Write-Host "[run-local] database: $DatabaseUrl"

if (-not $SkipMigrations) {
    Write-Host "[run-local] applying migrations..."
    alembic -c .\alembic.ini upgrade head
}

Write-Host "[run-local] starting API on port $Port"
uvicorn app.main:app --reload --port $Port
