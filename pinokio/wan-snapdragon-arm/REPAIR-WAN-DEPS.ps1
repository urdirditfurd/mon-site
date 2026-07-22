# Repare le venv Wan (gradio + deps) sans tout reinstaller
# Usage:
#   powershell -ExecutionPolicy Bypass -File REPAIR-WAN-DEPS.ps1

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$App  = Join-Path $Root "app"
$Vpy  = Join-Path $App "env\Scripts\python.exe"
$Req  = Join-Path $App "requirements.txt"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Reparation dependances Wan" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $Vpy)) {
  Write-Host "venv introuvable. Lance INSTALL-NVIDIA.ps1 d abord." -ForegroundColor Red
  exit 1
}

function Run-Pip {
  param([string[]]$PipArgs)
  Write-Host ("pip " + ($PipArgs -join " ")) -ForegroundColor DarkGray
  & $Vpy -m pip @PipArgs
  if ($LASTEXITCODE -ne 0) { throw ("pip failed: " + ($PipArgs -join " ")) }
}

Run-Pip @("install", "-U", "pip", "setuptools", "wheel")
Run-Pip @("install", "--timeout", "300", "--retries", "5", "gradio>=5.0.0")
if (Test-Path $Req) {
  Run-Pip @("install", "--timeout", "300", "--retries", "5", "-r", $Req)
}

Write-Host ""
Write-Host "Verification..." -ForegroundColor Yellow
& $Vpy -c "import gradio; import torch; print('gradio', gradio.__version__); print('cuda', torch.cuda.is_available())"
if ($LASTEXITCODE -ne 0) {
  Write-Host "Verification echouee." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "OK - Wan venv repare. Relance l icone video ia." -ForegroundColor Green
Write-Host ""
