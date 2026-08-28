# Active le pipeline talking 4 etapes (TTS -> portrait -> lip-sync -> FFmpeg)
# Usage:
#   powershell -ExecutionPolicy Bypass -File C:\ConteFactory\conte-factory\scripts\SWITCH-TO-TALKING.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"

Write-Host "Mode talking: personnages qui parlent (portrait + lip-sync)" -ForegroundColor Cyan

if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $root ".env.example") $envFile
}

$content = Get-Content $envFile -Raw -Encoding UTF8
if ($null -eq $content) { $content = "" }

function Set-EnvKey([string]$text, [string]$key, [string]$value) {
  if ($text -match "(?m)^$key=") {
    return ($text -replace "(?m)^$key=.*$", "$key=$value")
  }
  return $text + "`r`n$key=$value`r`n"
}

$content = Set-EnvKey $content "CONTE_VIDEO_PROVIDER" "talking"
$content = Set-EnvKey $content "CONTE_AUTO_START_LIPSYNC" "1"
$content = Set-EnvKey $content "PINOKIO_LIPSYNC_URL" "http://127.0.0.1:7870"
$content = Set-EnvKey $content "CONTE_VIDEO_FPS" "24"
$content = Set-EnvKey $content "CONTE_MUSIC_VOLUME" "0.20"
$content = Set-EnvKey $content "CONTE_AUTO_START_WAN" "0"

Set-Content -Path $envFile -Value $content -Encoding UTF8
Write-Host "OK: CONTE_VIDEO_PROVIDER=talking" -ForegroundColor Green
Write-Host "Optionnel: install lip-sync Wav2Lip puis LANCER-LIPSYNC.bat" -ForegroundColor Yellow
Write-Host "  powershell -ExecutionPolicy Bypass -File ..\pinokio\talking-wav2lip\INSTALL-LIPSYNC.ps1"
Write-Host "Relance video ia."
