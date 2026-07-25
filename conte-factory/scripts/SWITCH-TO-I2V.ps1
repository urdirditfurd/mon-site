# Force le mode I2V ULTRA-RAPIDE (cible <90 s / scène apres warm, RTX 3080 10 Go)
# Usage:
#   powershell -ExecutionPolicy Bypass -File C:\ConteFactory\conte-factory\scripts\SWITCH-TO-I2V.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"

Write-Host "Mode I2V ULTRA: LTX/Wan 1.3B · 8 steps · 704x384 · 33 frames · BATCH" -ForegroundColor Cyan

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
$content = Set-EnvKey $content "PINOKIO_I2V_FRAMES" "33"
$content = Set-EnvKey $content "PINOKIO_I2V_STEPS" "8"
$content = Set-EnvKey $content "PINOKIO_I2V_WIDTH" "704"
$content = Set-EnvKey $content "PINOKIO_I2V_HEIGHT" "384"
$content = Set-EnvKey $content "PINOKIO_I2V_GUIDANCE" "5.0"
$content = Set-EnvKey $content "PINOKIO_I2V_RESOLUTION" "480p 16:9"
$content = Set-EnvKey $content "CONTE_I2V_LOWVRAM" "1"
$content = Set-EnvKey $content "CONTE_I2V_PREFER_CLI" "1"
$content = Set-EnvKey $content "CONTE_I2V_USE_BATCH" "1"
$content = Set-EnvKey $content "WAN_DTYPE" "float16"
$content = Set-EnvKey $content "SULPHUR_CPU_OFFLOAD" "1"

Set-Content -Path $envFile -Value $content -Encoding UTF8
Write-Host "OK: I2V ultra (ltx, 8 steps, 704x384, 33f, batch 1-load)" -ForegroundColor Green
Write-Host "Si LTX trop lent/lourd: WAN_I2V_BACKEND=wan (Fun 1.3B)" -ForegroundColor DarkYellow
Write-Host ""
Write-Host "IMPORTANT — si un job I2V tourne encore (lent, ancien params) :" -ForegroundColor Yellow
Write-Host "  1) Arrete-le (Ctrl+C / tuer python I2V dans le Gestionnaire des taches)"
Write-Host "  2) git pull + ce script SWITCH-TO-I2V"
Write-Host "  3) Suivi → Continuer I2V (#36) — scenes deja OK sont sautees"
Write-Host ""
Write-Host "Cible: ~45-90 s / scene apres 1er chargement (batch)" -ForegroundColor DarkYellow
