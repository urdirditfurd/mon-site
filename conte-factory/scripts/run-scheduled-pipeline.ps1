# Pipeline planifie — demarre Wan si besoin puis lance main.py
# Appele par le Planificateur de taches Windows (02:00)

$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
$VenvPy = Join-Path $Root ".venv\Scripts\python.exe"
$LogFile = Join-Path $Root "data\scheduled.log"

if (-not (Test-Path $VenvPy)) {
  Add-Content $LogFile "$(Get-Date -Format o) ERREUR: venv introuvable"
  exit 1
}

function Log([string]$Msg) {
  $line = "$(Get-Date -Format o) $Msg"
  Add-Content $LogFile $line
  Write-Host $line
}

Log "=== Debut pipeline planifie ==="
Set-Location $Root

# Demarrer Wan
$wanScript = @"
import json, sys
sys.path.insert(0, r'$Root')
from modules.wan_service import ensure_wan_running
from config import WAN_START_TIMEOUT_SEC
r = ensure_wan_running(wait_seconds=WAN_START_TIMEOUT_SEC)
print(json.dumps(r, ensure_ascii=False))
sys.exit(0 if r.get('ok') else 1)
"@
Log "Demarrage Wan..."
$wanOut = & $VenvPy -c $wanScript 2>&1
Log "Wan: $wanOut"
if ($LASTEXITCODE -ne 0) {
  Log "ERREUR: Wan indisponible, pipeline annule"
  exit 1
}

# Pipeline complet avec publication auto (CONTE_AUTO_PUBLISH dans .env)
Log "Lancement main.py..."
& $VenvPy main.py 2>&1 | ForEach-Object { Log $_ }
$code = $LASTEXITCODE
Log "=== Fin pipeline (code $code) ==="
exit $code
