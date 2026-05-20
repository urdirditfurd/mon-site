param(
    [string]$DatabaseUrl = "postgresql+asyncpg://postgres:postgres@localhost:5432/trading_ai",
    [string]$AuthSecretKey = "change-me-in-production",
    [int]$Port = 8000,
    [int]$RestartDelaySeconds = 5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $projectRoot "storage\logs"
$logFile = Join-Path $logDir "supervisor.log"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Write-SupervisorLog {
    param([string]$Message)
    $line = "{0} | {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Write-Host $line
    Add-Content -Path $logFile -Value $line
}

Set-Location $projectRoot
$env:DATABASE_URL = $DatabaseUrl
$env:AUTH_SECRET_KEY = $AuthSecretKey
$env:AUTO_CREATE_TABLES = "false"

Write-SupervisorLog "Supervisor started in $projectRoot"
Write-SupervisorLog "Database URL configured"

while ($true) {
    try {
        Write-SupervisorLog "Applying migrations..."
        alembic -c .\alembic.ini upgrade head

        Write-SupervisorLog "Starting API on port $Port"
        uvicorn app.main:app --host 0.0.0.0 --port $Port
        $exitCode = $LASTEXITCODE
        Write-SupervisorLog "API exited with code $exitCode"
    }
    catch {
        Write-SupervisorLog ("API crashed: " + $_.Exception.Message)
    }

    Write-SupervisorLog "Restart in $RestartDelaySeconds second(s)"
    Start-Sleep -Seconds $RestartDelaySeconds
}
