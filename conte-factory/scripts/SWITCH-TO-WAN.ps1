# Force le mode vraie video Wan 2.1 (dialogues + clips animes)
# Usage:
#   powershell -ExecutionPolicy Bypass -File C:\ConteFactory\conte-factory\scripts\SWITCH-TO-WAN.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"

Write-Host "Mode Wan: vraie video + dialogues personnages" -ForegroundColor Cyan

if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $root ".env.example") $envFile
  Write-Host "Cree .env depuis .env.example"
}

$content = Get-Content $envFile -Raw -Encoding UTF8
if ($null -eq $content) { $content = "" }

if ($content -match "(?m)^CONTE_VIDEO_PROVIDER=") {
  $content = $content -replace "(?m)^CONTE_VIDEO_PROVIDER=.*$", "CONTE_VIDEO_PROVIDER=pinokio"
} else {
  $content += "`r`nCONTE_VIDEO_PROVIDER=pinokio`r`n"
}

if ($content -match "(?m)^CONTE_AUTO_START_WAN=") {
  $content = $content -replace "(?m)^CONTE_AUTO_START_WAN=.*$", "CONTE_AUTO_START_WAN=1"
} else {
  $content += "`r`nCONTE_AUTO_START_WAN=1`r`n"
}

if ($content -match "(?m)^WAN_DTYPE=") {
  $content = $content -replace "(?m)^WAN_DTYPE=.*$", "WAN_DTYPE=float16"
} else {
  $content += "`r`nWAN_DTYPE=float16`r`n"
}

if ($content -match "(?m)^SULPHUR_CPU_OFFLOAD=") {
  $content = $content -replace "(?m)^SULPHUR_CPU_OFFLOAD=.*$", "SULPHUR_CPU_OFFLOAD=1"
} else {
  $content += "`r`nSULPHUR_CPU_OFFLOAD=1`r`n"
}

Set-Content -Path $envFile -Value $content -Encoding UTF8
Write-Host "OK: CONTE_VIDEO_PROVIDER=pinokio + AUTO_START_WAN=1" -ForegroundColor Green
Write-Host "Relance video ia. Generation 5 min ~ 25-45 min (12 clips Wan)." -ForegroundColor Yellow
