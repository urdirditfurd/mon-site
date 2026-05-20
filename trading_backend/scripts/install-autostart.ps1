param(
    [string]$TaskName = "TradingBackendAutoStart",
    [string]$DatabaseUrl = "postgresql+asyncpg://postgres:postgres@localhost:5432/trading_ai",
    [string]$AuthSecretKey = "change-me-in-production",
    [int]$Port = 8000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$supervisorScript = Join-Path $projectRoot "scripts\run-supervised.ps1"

if (-not (Test-Path $supervisorScript)) {
    throw "Supervisor script not found: $supervisorScript"
}

$pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $pwsh) {
    throw "pwsh.exe not found in PATH."
}

$args = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-WindowStyle", "Hidden",
    "-File", "`"$supervisorScript`"",
    "-DatabaseUrl", "`"$DatabaseUrl`"",
    "-AuthSecretKey", "`"$AuthSecretKey`"",
    "-Port", $Port
) -join " "

$action = New-ScheduledTaskAction -Execute $pwsh -Argument $args
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Auto-start Trading Backend supervisor at system boot" `
    -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Write-Host "[autostart] Task '$TaskName' installed and started."
