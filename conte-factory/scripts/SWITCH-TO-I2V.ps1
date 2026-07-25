# Force le mode I2V RAPIDE (cible 1–2 min / scène sur RTX 3080 10 Go)
# Usage:
#   powershell -ExecutionPolicy Bypass -File C:\ConteFactory\conte-factory\scripts\SWITCH-TO-I2V.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"

Write-Host "Mode I2V RAPIDE: LTX/Wan 1.3B · 16 steps · 848x480 · 81 frames" -ForegroundColor Cyan

if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $root ".env.example") $envFile
  Write-Host "Cree .env depuis .env.example"
}

function Set-EnvKey([string]$content, [string]$key, [string]$value) {
  if ($content -match "(?m)^$key=") {
    return [regex]::Replace($content, "(?m)^$key=.*$", "$key=$value")
  }
  return $content + "`r`n$key=$value`r`n"
}

$content = Get-Content $envFile -Raw -Encoding UTF8
if ($null -eq $content) { $content = "" }

$content = Set-EnvKey $content "CONTE_VIDEO_PROVIDER" "i2v"
$content = Set-EnvKey $content "CONTE_AUTO_START_I2V" "1"
$content = Set-EnvKey $content "CONTE_AUTO_START_LIPSYNC" "0"
$content = Set-EnvKey $content "CONTE_AUTO_START_WAN" "0"
$content = Set-EnvKey $content "PINOKIO_I2V_URL" "http://127.0.0.1:7861"
$content = Set-EnvKey $content "WAN_I2V_BACKEND" "ltx"
$content = Set-EnvKey $content "PINOKIO_I2V_FRAMES" "81"
$content = Set-EnvKey $content "PINOKIO_I2V_STEPS" "16"
$content = Set-EnvKey $content "PINOKIO_I2V_WIDTH" "848"
$content = Set-EnvKey $content "PINOKIO_I2V_HEIGHT" "480"
$content = Set-EnvKey $content "PINOKIO_I2V_GUIDANCE" "5.5"
$content = Set-EnvKey $content "CONTE_I2V_LOWVRAM" "1"
$content = Set-EnvKey $content "CONTE_I2V_PREFER_CLI" "1"
$content = Set-EnvKey $content "WAN_DTYPE" "float16"
$content = Set-EnvKey $content "SULPHUR_CPU_OFFLOAD" "1"

Set-Content -Path $envFile -Value $content -Encoding UTF8
Write-Host "OK: I2V rapide (ltx, 16 steps, 848x480, 81f)" -ForegroundColor Green
Write-Host "Si LTX trop lent/lourd: WAN_I2V_BACKEND=wan (Fun 1.3B)" -ForegroundColor DarkYellow
Write-Host ""
Write-Host "1) Install:" -ForegroundColor Yellow
Write-Host "   powershell -ExecutionPolicy Bypass -File ..\pinokio\wan-i2v\INSTALL-I2V.ps1"
Write-Host "2) Lancer (laisser ouvert):" -ForegroundColor Yellow
Write-Host "   ..\pinokio\wan-i2v\LANCER-I2V.bat"
Write-Host "3) Relancer video ia → Generer" -ForegroundColor Yellow
Write-Host "   Cible: ~1-2 min / scene (total 5 min video ~ 15-30 min)" -ForegroundColor DarkYellow
