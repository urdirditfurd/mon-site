# Passe video ia en mode RAPIDE (images + zoom doux), sans Wan.
# Usage:
#   powershell -ExecutionPolicy Bypass -File C:\ConteFactory\conte-factory\scripts\SWITCH-TO-IMAGES.ps1

$Root = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $Root ".env"

Write-Host "Mode rapide: images IA + montage FFmpeg" -ForegroundColor Cyan

if (-not (Test-Path $EnvFile)) {
  Copy-Item (Join-Path $Root ".env.example") $EnvFile
  Write-Host "Cree .env depuis .env.example"
}

$content = Get-Content $EnvFile -Raw
if ($content -match "(?m)^CONTE_VIDEO_PROVIDER=") {
  $content = $content -replace "(?m)^CONTE_VIDEO_PROVIDER=.*$", "CONTE_VIDEO_PROVIDER=images"
} else {
  $content += "`r`nCONTE_VIDEO_PROVIDER=images`r`n"
}
if ($content -match "(?m)^CONTE_AUTO_START_WAN=") {
  $content = $content -replace "(?m)^CONTE_AUTO_START_WAN=.*$", "CONTE_AUTO_START_WAN=0"
} else {
  $content += "CONTE_AUTO_START_WAN=0`r`n"
}
if ($content -notmatch "(?m)^CONTE_IMAGE_BACKEND=") {
  $content += "CONTE_IMAGE_BACKEND=auto`r`n"
}

Set-Content -Path $EnvFile -Value $content -Encoding UTF8
Write-Host "OK -> $EnvFile" -ForegroundColor Green
Write-Host "Relance video ia, puis cree une video test 2-5 min." -ForegroundColor Yellow
