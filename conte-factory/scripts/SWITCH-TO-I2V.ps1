# Force le mode VRAIE animation Wan Image-to-Video (abandon Wav2Lip / diaporama)
# Usage:
#   powershell -ExecutionPolicy Bypass -File C:\ConteFactory\conte-factory\scripts\SWITCH-TO-I2V.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"

Write-Host "Mode I2V: vraie animation (personnage + camera + decor)" -ForegroundColor Cyan

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
$content = Set-EnvKey $content "PINOKIO_I2V_FRAMES" "49"
$content = Set-EnvKey $content "PINOKIO_I2V_STEPS" "20"
$content = Set-EnvKey $content "WAN_DTYPE" "float16"
$content = Set-EnvKey $content "SULPHUR_CPU_OFFLOAD" "1"

Set-Content -Path $envFile -Value $content -Encoding UTF8
Write-Host "OK: CONTE_VIDEO_PROVIDER=i2v" -ForegroundColor Green
Write-Host ""
Write-Host "1) Install (une fois):" -ForegroundColor Yellow
Write-Host "   powershell -ExecutionPolicy Bypass -File ..\pinokio\wan-i2v\INSTALL-I2V.ps1"
Write-Host "2) Lancer le moteur (laisser ouvert):" -ForegroundColor Yellow
Write-Host "   ..\pinokio\wan-i2v\LANCER-I2V.bat"
Write-Host "3) Relancer video ia puis Generer" -ForegroundColor Yellow
Write-Host "   5 min video ~ 30-70 min (1 clip I2V anime / scene)" -ForegroundColor DarkYellow
