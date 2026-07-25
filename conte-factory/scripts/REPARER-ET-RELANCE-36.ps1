# Reparation Git + relance projet 36 (PowerShell natif)
# Usage:
#   powershell -ExecutionPolicy Bypass -File C:\ConteFactory\conte-factory\scripts\REPARER-ET-RELANCE-36.ps1
# Ou si le fichier n'existe pas encore, copie-colle le bloc ci-dessous dans PowerShell.

$ErrorActionPreference = "Stop"
$Root = "C:\ConteFactory"
$Repo = "https://github.com/urdirditfurd/mon-site.git"
$Branch = "cursor/conte-factory-pipeline-0391"

Write-Host "=== 1) Aller dans C:\ConteFactory ===" -ForegroundColor Cyan
if (-not (Test-Path $Root)) {
  Write-Host "Dossier absent - clone complet..." -ForegroundColor Yellow
  New-Item -ItemType Directory -Path (Split-Path $Root) -Force | Out-Null
  git clone --branch $Branch --single-branch $Repo $Root
}
Set-Location $Root

Write-Host "=== 2) Recuperer la branche ===" -ForegroundColor Cyan
if (-not (Test-Path (Join-Path $Root ".git"))) {
  Write-Host "Pas de .git - re-clone dans un dossier temp puis copie..." -ForegroundColor Yellow
  $tmp = Join-Path $env:TEMP "contefactory-repair"
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  git clone --branch $Branch --single-branch $Repo $tmp
  # Garde data/venv locaux si presents
  $keep = @("conte-factory\data", "conte-factory\.venv", "conte-factory\.env", "pinokio")
  foreach ($rel in $keep) {
    $src = Join-Path $Root $rel
    $dst = Join-Path $tmp $rel
    if (Test-Path $src) {
      $parent = Split-Path $dst
      if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
      Copy-Item -Recurse -Force $src $dst
    }
  }
  Get-ChildItem $Root -Force | ForEach-Object {
    if ($_.Name -notin @("conte-factory", "pinokio")) {
      Remove-Item -Recurse -Force $_.FullName -ErrorAction SilentlyContinue
    }
  }
  # Remplace le code source depuis le clone
  Copy-Item -Force (Join-Path $tmp ".git") (Join-Path $Root ".git") -Recurse -ErrorAction SilentlyContinue
  robocopy (Join-Path $tmp "conte-factory") (Join-Path $Root "conte-factory") /E /XD data .venv /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  if (Test-Path (Join-Path $tmp "pinokio\wan-i2v")) {
    robocopy (Join-Path $tmp "pinokio\wan-i2v") (Join-Path $Root "pinokio\wan-i2v") /E /XD env /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  }
} else {
  try {
    git remote remove origin 2>$null
  } catch {}
  git remote add origin $Repo 2>$null
  git fetch origin $Branch --depth 50
  git checkout -B $Branch FETCH_HEAD
  git reset --hard FETCH_HEAD
  git clean -fd
}

Write-Host "Git OK." -ForegroundColor Green

Write-Host "=== 3) Config .env face-safe ===" -ForegroundColor Cyan
$envFile = Join-Path $Root "conte-factory\.env"
$example = Join-Path $Root "conte-factory\.env.example"
if (-not (Test-Path $envFile)) { Copy-Item $example $envFile }
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
  "PINOKIO_I2V_SCHEDULER" = "default"
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
Write-Host ".env OK" -ForegroundColor Green

Write-Host "=== 4) Supprimer ai_clips #36 ===" -ForegroundColor Cyan
Set-Location (Join-Path $Root "conte-factory")
$py = Join-Path (Get-Location) ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { throw ".venv manquant: $py" }
$clear = Join-Path (Get-Location) "scripts\clear_ai_clips.py"
if (Test-Path $clear) {
  & $py $clear 36
} else {
  $fallback = Join-Path (Get-Location) "data\videos\video_0036\ai_clips"
  if (Test-Path $fallback) {
    Remove-Item -Recurse -Force $fallback
    Write-Host "SUPPRIME $fallback"
  }
}

Write-Host "=== 5) Relance pipeline #36 ===" -ForegroundColor Cyan
& $py main.py --resume 36 --only storyboard --no-publish
Write-Host "Termine." -ForegroundColor Green
