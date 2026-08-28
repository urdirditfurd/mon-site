# Pipeline planifie — demarre Wan si besoin puis lance main.py
# Appele par le Planificateur de taches Windows (02:00)

$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
$VenvPy = Join-Path $Root ".venv\Scripts\python.exe"
$StartWanPy = Join-Path $PSScriptRoot "start_wan.py"
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

Log "Demarrage Wan..."
$wanOut = & $VenvPy $StartWanPy 2>&1
Log "Wan: $wanOut"
if ($LASTEXITCODE -ne 0) {
  Log "ERREUR: Wan indisponible, pipeline annule"
  exit 1
}

Log "Lancement main.py..."
& $VenvPy main.py 2>&1 | ForEach-Object { Log $_ }
$code = $LASTEXITCODE
Log "=== Fin pipeline (code $code) ==="
exit $code
