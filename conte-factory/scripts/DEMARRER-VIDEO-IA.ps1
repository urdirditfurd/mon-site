# video ia — lance Wan (GPU) + dashboard Streamlit en un seul clic
# Usage: powershell -ExecutionPolicy Bypass -File scripts\DEMARRER-VIDEO-IA.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$VenvPy = Join-Path $Root ".venv\Scripts\python.exe"
$StartWanPy = Join-Path $PSScriptRoot "start_wan.py"

if (-not (Test-Path $VenvPy)) {
  Write-Host "Environnement manquant. Lance d'abord INSTALL-NVIDIA.ps1" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  video ia — demarrage tout-en-un" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "==> Demarrage Wan (GPU NVIDIA)..." -ForegroundColor Yellow
& $VenvPy $StartWanPy
if ($LASTEXITCODE -ne 0) {
  Write-Host "Wan n'a pas demarre. Voir data\wan_server.log" -ForegroundColor Red
  Write-Host "Tu peux quand meme ouvrir le dashboard pour reessayer." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "==> Dashboard video ia : http://127.0.0.1:8501" -ForegroundColor Green
Write-Host "    Wan integre     : http://127.0.0.1:7860" -ForegroundColor Green
Write-Host ""
$env:STREAMLIT_BROWSER_GATHER_USAGE_STATS = "false"
Set-Location $Root
& $VenvPy -m streamlit run dashboard.py --server.address 127.0.0.1 --server.port 8501
