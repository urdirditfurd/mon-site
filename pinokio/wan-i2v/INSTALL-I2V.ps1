# Installe/repare torch + deps I2V (RTX 3080 / CUDA 12.1)
# Usage:
#   powershell -ExecutionPolicy Bypass -File C:\ConteFactory\pinokio\wan-i2v\INSTALL-I2V.ps1

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$app = Join-Path $root "app"
$wanT2vEnv = Join-Path $root "..\wan-snapdragon-arm\app\env"
$localEnv = Join-Path $app "env"

Write-Host "=== Install / repair Wan I2V (torch) ===" -ForegroundColor Cyan

New-Item -ItemType Directory -Force -Path $app | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $root "outputs") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $root "models") | Out-Null

function Ensure-Venv([string]$EnvPath) {
    $py = Join-Path $EnvPath "Scripts\python.exe"
    if (-not (Test-Path $py)) {
        Write-Host "Creation venv: $EnvPath" -ForegroundColor Yellow
        New-Item -ItemType Directory -Force -Path $EnvPath | Out-Null
        if (Get-Command py -ErrorAction SilentlyContinue) {
            py -3.11 -m venv $EnvPath
            if (-not (Test-Path $py)) { py -3 -m venv $EnvPath }
        } else {
            python -m venv $EnvPath
        }
    }
    if (-not (Test-Path $py)) {
        throw "Impossible de creer le venv: $EnvPath"
    }
    return $py
}

$py = $null
if (Test-Path (Join-Path $wanT2vEnv "Scripts\python.exe")) {
    $py = Join-Path $wanT2vEnv "Scripts\python.exe"
    Write-Host "Venv Wan T2V: $py" -ForegroundColor Green
} else {
    $py = Ensure-Venv $localEnv
    Write-Host "Venv I2V local: $py" -ForegroundColor Green
}

Write-Host "=== Installation torch CUDA 12.1 (peut prendre 10-20 min) ===" -ForegroundColor Yellow
& $py -m pip install -U pip wheel
& $py -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
& $py -m pip install "diffusers>=0.33.0" transformers accelerate sentencepiece protobuf pillow imageio imageio-ffmpeg opencv-python-headless gradio

Write-Host "=== Verification torch ===" -ForegroundColor Cyan
& $py -c "import torch; print('torch', torch.__version__); print('cuda', torch.cuda.is_available())"
if ($LASTEXITCODE -ne 0) {
    throw "torch toujours indisponible apres install"
}

Write-Host "=== Verification pipelines I2V ===" -ForegroundColor Cyan
& $py -c "from diffusers import LTXImageToVideoPipeline; print('LTX OK')"

Write-Host ""
Write-Host "OK. Relance ensuite le pipeline ConteFactory:" -ForegroundColor Green
Write-Host '  cd C:\ConteFactory\conte-factory' -ForegroundColor White
Write-Host '  .\.venv\Scripts\python.exe main.py --resume 1 --only video_ai --no-publish' -ForegroundColor White
