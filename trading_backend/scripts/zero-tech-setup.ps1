param(
    [string]$DatabaseUrl = "",
    [string]$AuthSecretKey = "change-me-in-production",
    [string]$Email = "admin@trading-ia.com",
    [string]$Password = "Admin!ChangeMe2026",
    [string]$SeedTotal = "10000.00",
    [string]$SeedEngaged = "2500.00",
    [string]$Threshold = "75.00"
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

Write-Host "[zero-tech] project root: $projectRoot"
Write-Host "[zero-tech] applying migrations..."
alembic -c .\alembic.ini upgrade head

Write-Host "[zero-tech] creating/updating demo admin account..."
python .\scripts\seed_demo_account.py `
    --email $Email `
    --password $Password `
    --seed-total $SeedTotal `
    --seed-engaged $SeedEngaged `
    --threshold $Threshold
if ($LASTEXITCODE -ne 0) {
    throw "[zero-tech] seed script failed (exit code $LASTEXITCODE)."
}

Write-Host "[zero-tech] done"
Write-Host "[zero-tech] email: $Email"
Write-Host "[zero-tech] password: $Password"
Write-Host "[zero-tech] login URL: http://127.0.0.1:8000/docs"

try {
    $health = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:8000/api/health" -TimeoutSec 3
    if ($health.status -eq "ok") {
        Write-Host "[zero-tech] API health: OK"
    }
}
catch {
    Write-Warning "[zero-tech] API is not running yet. Start it with: .\scripts\run-local.ps1 -DatabaseUrl '$DatabaseUrl' -AuthSecretKey '$AuthSecretKey'"
}
