# Force I2V FACE-SAFE + duree cible stricte
# Usage:
#   powershell -ExecutionPolicy Bypass -File C:\ConteFactory\conte-factory\scripts\SWITCH-TO-I2V.ps1
# ASCII only (PowerShell 5.1).

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"

Write-Host "Mode I2V FACE-SAFE: CFG 3.5 | motion 0.3 | 848x480 | 22 steps | BATCH" -ForegroundColor Cyan

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
$content = Set-EnvKey $content "PINOKIO_I2V_STEPS" "22"
$content = Set-EnvKey $content "PINOKIO_I2V_WIDTH" "848"
$content = Set-EnvKey $content "PINOKIO_I2V_HEIGHT" "480"
$content = Set-EnvKey $content "PINOKIO_I2V_GUIDANCE" "3.5"
$content = Set-EnvKey $content "PINOKIO_I2V_MOTION_SCALE" "0.3"
$content = Set-EnvKey $content "PINOKIO_I2V_SCHEDULER" "dpmpp_2m"
$content = Set-EnvKey $content "PINOKIO_I2V_RESOLUTION" "848p 16:9"
$content = Set-EnvKey $content "CONTE_I2V_LOWVRAM" "1"
$content = Set-EnvKey $content "CONTE_I2V_PREFER_CLI" "1"
$content = Set-EnvKey $content "CONTE_I2V_USE_BATCH" "1"
$content = Set-EnvKey $content "WAN_DTYPE" "float16"
$content = Set-EnvKey $content "SULPHUR_CPU_OFFLOAD" "1"
$content = Set-EnvKey $content "CONTE_TTS_VOICE" "fr-FR-VivienneMultilingualNeural"
$content = Set-EnvKey $content "CONTE_TTS_SAMPLE_RATE" "44100"
$content = Set-EnvKey $content "CONTE_TTS_MP3_BITRATE" "192k"
$content = Set-EnvKey $content "CONTE_DURATION_TOLERANCE_SEC" "5"
$content = Set-EnvKey $content "CONTE_WORDS_PER_MIN" "155"

Set-Content -Path $envFile -Value $content -Encoding UTF8
Write-Host "OK: face-safe CFG=3.5 motion=0.3 848x480 + coupe duree cible" -ForegroundColor Green
Write-Host ""
Write-Host "Test (supprime ai_clips pour re-animer les visages):" -ForegroundColor Yellow
Write-Host "  cd C:\ConteFactory\conte-factory"
Write-Host "  .\.venv\Scripts\python.exe main.py --resume 36 --only storyboard --no-publish"
Write-Host "Ou nouveau conte 5 min depuis Creation."
