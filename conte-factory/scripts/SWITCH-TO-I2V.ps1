# Force le mode I2V QUALITE jeunesse (22 steps, 1024x576, motion douce)
# Usage:
#   powershell -ExecutionPolicy Bypass -File C:\ConteFactory\conte-factory\scripts\SWITCH-TO-I2V.ps1
# ASCII only: Windows PowerShell 5.1 casse avec tirets unicode / UTF-8 sans BOM.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"

Write-Host "Mode I2V QUALITE: LTX/Wan | 22 steps | 1024x576 | 41 frames | motion 0.65 | BATCH" -ForegroundColor Cyan

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
$content = Set-EnvKey $content "PINOKIO_I2V_FRAMES" "41"
$content = Set-EnvKey $content "PINOKIO_I2V_STEPS" "22"
$content = Set-EnvKey $content "PINOKIO_I2V_WIDTH" "1024"
$content = Set-EnvKey $content "PINOKIO_I2V_HEIGHT" "576"
$content = Set-EnvKey $content "PINOKIO_I2V_GUIDANCE" "4.5"
$content = Set-EnvKey $content "PINOKIO_I2V_MOTION_SCALE" "0.65"
$content = Set-EnvKey $content "PINOKIO_I2V_SCHEDULER" "dpmpp_2m"
$content = Set-EnvKey $content "PINOKIO_I2V_RESOLUTION" "576p 16:9"
$content = Set-EnvKey $content "CONTE_I2V_LOWVRAM" "1"
$content = Set-EnvKey $content "CONTE_I2V_PREFER_CLI" "1"
$content = Set-EnvKey $content "CONTE_I2V_USE_BATCH" "1"
$content = Set-EnvKey $content "WAN_DTYPE" "float16"
$content = Set-EnvKey $content "SULPHUR_CPU_OFFLOAD" "1"
$content = Set-EnvKey $content "CONTE_TTS_VOICE" "fr-FR-VivienneMultilingualNeural"
$content = Set-EnvKey $content "CONTE_TTS_SAMPLE_RATE" "44100"
$content = Set-EnvKey $content "CONTE_TTS_MP3_BITRATE" "192k"

Set-Content -Path $envFile -Value $content -Encoding UTF8
Write-Host "OK: I2V qualite (22 steps, 1024x576, motion 0.65, batch)" -ForegroundColor Green
Write-Host "Voix: VivienneMultilingual / RemyMultilingual + audio 44.1kHz 192k" -ForegroundColor Green
Write-Host ""
Write-Host "Test qualite projet 36 (regenerer prompts + audio + I2V):" -ForegroundColor Yellow
Write-Host "  cd C:\ConteFactory\conte-factory"
Write-Host "  .\.venv\Scripts\python.exe main.py --resume 36 --only storyboard --no-publish"
Write-Host "  .\.venv\Scripts\python.exe main.py --resume 36 --only audio --no-publish"
Write-Host "  .\.venv\Scripts\python.exe main.py --resume 36 --only video_ai --no-publish"
Write-Host "Astuce: pour forcer re-animation, supprime ai_clips\i2v_raw et *_part00.mp4"
