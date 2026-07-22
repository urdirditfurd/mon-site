# Lance Wan + dashboard via le fichier .bat (evite les bugs PowerShell avec I&B)
$ErrorActionPreference = "Stop"
$Bat = Join-Path $PSScriptRoot "DEMARRER-VIDEO-IA.bat"
if (-not (Test-Path $Bat)) {
  Write-Host "Fichier introuvable: $Bat" -ForegroundColor Red
  exit 1
}
& cmd.exe /c "`"$Bat`""
exit $LASTEXITCODE
