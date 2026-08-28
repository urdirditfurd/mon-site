# Restaure le pipeline Cursor dans C:\ConteFactory et corrige Wan (/generate)
# Usage (Admin PowerShell):
#   irm https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/conte-factory-pipeline-0391/conte-factory/scripts/RESTORE-CONTEFACTORY.ps1 | iex
# ou:
#   powershell -ExecutionPolicy Bypass -File C:\ConteFactory\conte-factory\scripts\RESTORE-CONTEFACTORY.ps1

$ErrorActionPreference = "Stop"
$Target = "C:\ConteFactory"
$Branch = "cursor/conte-factory-pipeline-0391"
$RepoUrl = "https://github.com/urdirditfurd/mon-site.git"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Restore ConteFactory (fix montage)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Stopper process qui bloquent
Get-Process -Name "python","streamlit","ollama" -ErrorAction SilentlyContinue | Where-Object {
  $_.Path -like "*ConteFactory*" -or $_.Path -like "*wan-snapdragon*"
} | Stop-Process -Force -ErrorAction SilentlyContinue

if (-not (Test-Path $Target)) {
  Write-Host "Clone vers $Target ..." -ForegroundColor Yellow
  git clone --branch $Branch --single-branch $RepoUrl $Target
} else {
  Write-Host "Mise a jour git dans $Target ..." -ForegroundColor Yellow
  Push-Location $Target
  git fetch origin $Branch
  git checkout $Branch
  git reset --hard "origin/$Branch"
  Pop-Location
}

$Cf = Join-Path $Target "conte-factory"
$Wan = Join-Path $Target "pinokio\wan-snapdragon-arm"
$VenvPy = Join-Path $Cf ".venv\Scripts\python.exe"
$WanPy = Join-Path $Wan "app\env\Scripts\python.exe"

if (-not (Test-Path $VenvPy)) {
  Write-Host "Creation venv conte-factory..." -ForegroundColor Yellow
  Push-Location $Cf
  py -3 -m venv .venv
  & .\.venv\Scripts\python.exe -m pip install -U pip
  & .\.venv\Scripts\python.exe -m pip install -r requirements.txt
  & .\.venv\Scripts\python.exe -m pip install google-api-python-client google-auth-oauthlib google-auth-httplib2
  Pop-Location
} else {
  Push-Location $Cf
  & .\.venv\Scripts\python.exe -m pip install -r requirements.txt
  Pop-Location
}

if (-not (Test-Path $WanPy)) {
  Write-Host "Wan venv manquant — lance INSTALL-NVIDIA.ps1" -ForegroundColor Red
  Write-Host "irm https://raw.githubusercontent.com/urdirditfurd/mon-site/$Branch/pinokio/wan-snapdragon-arm/INSTALL-NVIDIA.ps1 | iex"
} else {
  Write-Host "Verification gradio dans Wan..." -ForegroundColor Yellow
  & $WanPy -c "import gradio, torch; print('gradio', gradio.__version__); print('cuda', torch.cuda.is_available())"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "REPAIR deps Wan..." -ForegroundColor Yellow
    powershell -ExecutionPolicy Bypass -File (Join-Path $Wan "REPAIR-WAN-DEPS.ps1")
  }
}

# Raccourci Bureau
$Desktop = [Environment]::GetFolderPath("Desktop")
$Bat = Join-Path $Cf "scripts\DEMARRER-VIDEO-IA.bat"
$Shortcut = Join-Path $Desktop "video ia.lnk"
$Wsh = New-Object -ComObject WScript.Shell
$Sc = $Wsh.CreateShortcut($Shortcut)
$Sc.TargetPath = $Bat
$Sc.WorkingDirectory = $Cf
$Sc.Description = "video ia - Conte Factory"
$Sc.Save()

Write-Host ""
Write-Host "OK - Code restaure." -ForegroundColor Green
Write-Host "1) Double-clic Bureau: video ia  (redemarre Wan avec API /generate)" -ForegroundColor Green
Write-Host "2) Attends Wan 🟢 EN LIGNE" -ForegroundColor Green
Write-Host "3) Test montage (PowerShell):" -ForegroundColor Green
Write-Host '   cd C:\ConteFactory\conte-factory' -ForegroundColor White
Write-Host '   .\.venv\Scripts\python.exe main.py --short --theme "lapin" --no-publish' -ForegroundColor White
Write-Host ""
Write-Host "Ou test clips seuls sur storyboard existant:" -ForegroundColor Yellow
Write-Host '   .\.venv\Scripts\python.exe -c "from modules.video_generator import VideoGenerator; print(VideoGenerator().generate_all_clips(r''data/storyboards/video_19/storyboard.json'', 19, max_scenes=3))"' -ForegroundColor White
Write-Host ""
