# video ia — lance Wan (GPU) + dashboard Streamlit en un seul clic
# Usage: powershell -ExecutionPolicy Bypass -File scripts\DEMARRER-VIDEO-IA.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$VenvPy = Join-Path $Root ".venv\Scripts\python.exe"

if (-not (Test-Path $VenvPy)) {
  Write-Host "Environnement manquant. Lance d'abord INSTALL-NVIDIA.ps1" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  video ia — demarrage tout-en-un" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1) Demarrer Wan en arriere-plan via le module Python
Write-Host "==> Demarrage Wan (GPU NVIDIA)..." -ForegroundColor Yellow
$wanScript = @"
import json, sys
sys.path.insert(0, r'$Root')
from modules.wan_service import start_wan
from config import WAN_START_TIMEOUT_SEC
r = start_wan(wait_seconds=WAN_START_TIMEOUT_SEC)
print(json.dumps(r, ensure_ascii=False))
sys.exit(0 if r.get('ok') else 1)
"@
$wanResult = & $VenvPy -c $wanScript 2>&1
Write-Host $wanResult
if ($LASTEXITCODE -ne 0) {
  Write-Host "Wan n'a pas demarre. Voir data\wan_server.log" -ForegroundColor Red
  Write-Host "Tu peux quand meme ouvrir le dashboard pour reessayer." -ForegroundColor Yellow
}

# 2) Lancer le dashboard
Write-Host ""
Write-Host "==> Dashboard video ia : http://127.0.0.1:8501" -ForegroundColor Green
Write-Host "    Wan integre     : http://127.0.0.1:7860" -ForegroundColor Green
Write-Host ""
$env:STREAMLIT_BROWSER_GATHER_USAGE_STATS = "false"
Set-Location $Root
& $VenvPy -m streamlit run dashboard.py --server.address 127.0.0.1 --server.port 8501
