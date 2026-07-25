# ASCII-only helper. Prefer SWITCH-TO-I2V.bat on Windows.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"
Write-Host "Mode I2V FACE-SAFE: CFG 3.5 | motion 0.3 | 848x480 | BATCH" -ForegroundColor Cyan
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $root ".env.example") $envFile
}
$keys = @{
  "CONTE_VIDEO_PROVIDER" = "i2v"
  "CONTE_AUTO_START_I2V" = "1"
  "CONTE_AUTO_START_LIPSYNC" = "0"
  "CONTE_AUTO_START_WAN" = "0"
  "PINOKIO_I2V_URL" = "http://127.0.0.1:7861"
  "WAN_I2V_BACKEND" = "ltx"
  "PINOKIO_I2V_FRAMES" = "33"
  "PINOKIO_I2V_STEPS" = "22"
  "PINOKIO_I2V_WIDTH" = "848"
  "PINOKIO_I2V_HEIGHT" = "480"
  "PINOKIO_I2V_GUIDANCE" = "3.5"
  "PINOKIO_I2V_MOTION_SCALE" = "0.3"
  "PINOKIO_I2V_SCHEDULER" = "dpmpp_2m"
  "PINOKIO_I2V_RESOLUTION" = "848p 16:9"
  "CONTE_I2V_LOWVRAM" = "1"
  "CONTE_I2V_PREFER_CLI" = "1"
  "CONTE_I2V_USE_BATCH" = "1"
  "WAN_DTYPE" = "float16"
  "SULPHUR_CPU_OFFLOAD" = "1"
  "CONTE_TTS_VOICE" = "fr-FR-VivienneMultilingualNeural"
  "CONTE_TTS_SAMPLE_RATE" = "44100"
  "CONTE_TTS_MP3_BITRATE" = "192k"
  "CONTE_DURATION_TOLERANCE_SEC" = "5"
}
$lines = @()
if (Test-Path $envFile) { $lines = Get-Content $envFile }
$seen = @{}
$out = @()
foreach ($line in $lines) {
  if ($line -match "^([^=]+)=(.*)$") {
    $k = $Matches[1]
    if ($keys.ContainsKey($k)) {
      $out += "$k=$($keys[$k])"
      $seen[$k] = $true
      continue
    }
  }
  $out += $line
}
foreach ($k in $keys.Keys) {
  if (-not $seen.ContainsKey($k)) { $out += "$k=$($keys[$k])" }
}
Set-Content -Path $envFile -Value $out -Encoding Ascii
Write-Host "OK: face-safe CFG=3.5 motion=0.3 848x480" -ForegroundColor Green
Write-Host "Prefer: scripts\REPARER-ET-RELANCE-36.bat"
