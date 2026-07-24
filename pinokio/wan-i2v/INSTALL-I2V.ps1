# Install Wan I2V 1.3B (Image-to-Video) — RTX 3080 10 Go
# Reutilise le venv de wan-snapdragon-arm si present.
# Usage:
#   powershell -ExecutionPolicy Bypass -File C:\ConteFactory\pinokio\wan-i2v\INSTALL-I2V.ps1

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$app = Join-Path $root "app"
$wanT2vEnv = Join-Path $root "..\wan-snapdragon-arm\app\env"
$localEnv = Join-Path $app "env"

Write-Host "=== Install Wan I2V (vraie animation) ===" -ForegroundColor Cyan

New-Item -ItemType Directory -Force -Path $app | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $root "outputs") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $root "models") | Out-Null

$py = $null
if (Test-Path (Join-Path $wanT2vEnv "Scripts\python.exe")) {
  $py = Join-Path $wanT2vEnv "Scripts\python.exe"
  Write-Host "Reutilise venv Wan T2V: $py" -ForegroundColor Green
} elseif (Test-Path (Join-Path $localEnv "Scripts\python.exe")) {
  $py = Join-Path $localEnv "Scripts\python.exe"
} else {
  Write-Host "Creation venv local..." -ForegroundColor Yellow
  py -3.11 -m venv $localEnv
  if (-not (Test-Path (Join-Path $localEnv "Scripts\python.exe"))) {
    python -m venv $localEnv
  }
  $py = Join-Path $localEnv "Scripts\python.exe"
  & $py -m pip install -U pip wheel
  & $py -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
  & $py -m pip install "diffusers>=0.33.0" transformers accelerate sentencepiece protobuf pillow imageio imageio-ffmpeg opencv-python-headless gradio
}

Write-Host "Verifie WanImageToVideoPipeline..." -ForegroundColor Cyan
& $py -c "from diffusers import WanImageToVideoPipeline; print('OK', WanImageToVideoPipeline)"

Write-Host ""
Write-Host "Premier run telecharge le modele (~5-8 Go) depuis Hugging Face." -ForegroundColor Yellow
Write-Host "Lance ensuite: .\LANCER-I2V.bat  (http://127.0.0.1:7861)" -ForegroundColor Green
Write-Host "Puis dans conte-factory: .\scripts\SWITCH-TO-I2V.ps1" -ForegroundColor Green
