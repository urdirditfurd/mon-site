# Installation vidéo IA pour Snapdragon X Elite (Windows ARM64)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host "=== ClipForge Video — setup Snapdragon X Elite ===" -ForegroundColor Cyan

$arch = (Get-CimInstance Win32_Processor).Architecture
if ($arch -ne 12) {
  Write-Host "Attention: processeur non ARM detecte. Ce script cible Snapdragon X Elite." -ForegroundColor Yellow
}

python --version
if ($LASTEXITCODE -ne 0) {
  Write-Host "Installez Python 3.12 ARM64 depuis python.org" -ForegroundColor Red
  exit 1
}

Write-Host "Installation PyTorch ARM64 (CPU)..." -ForegroundColor Green
pip install --pre torch --index-url https://download.pytorch.org/whl/nightly/cpu

Write-Host "Installation diffusers et dependances..." -ForegroundColor Green
pip install -r requirements-video-arm.txt

$env:SULPHUR_SNAPDRAGON = "1"
$env:SULPHUR_ALLOW_CPU = "1"

python server/sulphur-video-engine.py check

Write-Host ""
Write-Host "OK. Lancez: npm start" -ForegroundColor Green
Write-Host "Puis ouvrez Video Factory (index-video-studio.html ou /studio)" -ForegroundColor Green
Write-Host "Recommande: cle FAL gratuite pour generation rapide." -ForegroundColor Yellow
