# Manual install for Wan Snapdragon ARM (when Pinokio Install crashes / closes)
# Run in PowerShell:
#   powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\mon-site\pinokio\wan-snapdragon-arm\INSTALL-MANUEL.ps1"

$ErrorActionPreference = "Stop"

function Find-AppRoot {
  $candidates = @(
    (Join-Path $PSScriptRoot "."),
    "C:\pinokio\api\wan-snapdragon-arm.git",
    (Join-Path $env:USERPROFILE "mon-site\pinokio\wan-snapdragon-arm"),
    (Join-Path $env:USERPROFILE "pinokio\api\wan-snapdragon-arm.git")
  )
  foreach ($c in $candidates) {
    $app = Join-Path $c "app\wan_engine.py"
    $app2 = Join-Path $c "wan_engine.py"
    if (Test-Path $app) { return (Resolve-Path $c).Path }
    if (Test-Path $app2) { return (Resolve-Path (Split-Path $c -Parent)).Path }
  }
  throw "wan-snapdragon-arm folder not found. Copy it first to C:\pinokio\api\wan-snapdragon-arm.git"
}

function Get-Python {
  foreach ($name in @("py", "python", "python3")) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if (-not $cmd) { continue }
    try {
      if ($name -eq "py") {
        $exe = & py -3 -c "import sys; print(sys.executable)" 2>$null
      } else {
        $exe = & $cmd.Source -c "import sys; print(sys.executable)" 2>$null
      }
      if ($LASTEXITCODE -eq 0 -and $exe -and ($exe -notmatch "WindowsApps")) {
        return $exe.Trim()
      }
    } catch {}
  }
  throw "Python not found. Install Python 3.12 and check Add to PATH."
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Wan Snapdragon - INSTALL MANUEL" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

$Root = Find-AppRoot
$App = Join-Path $Root "app"
$Venv = Join-Path $App "env"
$Py = Get-Python

Write-Host "Root : $Root"
Write-Host "Python : $Py"

if (-not (Test-Path (Join-Path $Venv "Scripts\python.exe"))) {
  Write-Host ""
  Write-Host "==> Creating venv app\env ..." -ForegroundColor Cyan
  if (Test-Path $Venv) { Remove-Item -Recurse -Force $Venv }
  & $Py -m venv $Venv
}

$VenvPy = Join-Path $Venv "Scripts\python.exe"
$VenvPip = Join-Path $Venv "Scripts\pip.exe"
if (-not (Test-Path $VenvPy)) { throw "venv python missing: $VenvPy" }

Write-Host ""
Write-Host "==> Installing torch CPU (can take several minutes) ..." -ForegroundColor Cyan
& $VenvPip uninstall torch torchvision torchaudio -y 2>$null
& $VenvPip install --upgrade pip
& $VenvPip install torch==2.8.0 torchvision==0.23.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cpu
if ($LASTEXITCODE -ne 0) {
  Write-Host "torch 2.8 CPU wheel failed - trying latest CPU torch ..." -ForegroundColor Yellow
  & $VenvPip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
}

Write-Host ""
Write-Host "==> Installing requirements.txt ..." -ForegroundColor Cyan
& $VenvPip install -r (Join-Path $App "requirements.txt")

Write-Host ""
Write-Host "==> Check wan_engine ..." -ForegroundColor Cyan
Push-Location $App
$env:SULPHUR_SNAPDRAGON = "1"
$env:SULPHUR_ALLOW_CPU = "1"
& $VenvPy wan_engine.py check
$checkCode = $LASTEXITCODE
Pop-Location

if ($checkCode -ne 0) {
  Write-Host "Check failed - see errors above." -ForegroundColor Red
  throw "wan_engine check failed"
}

Write-Host ""
Write-Host "INSTALL OK." -ForegroundColor Green
Write-Host "Next: start Gradio with:"
Write-Host "  $Root\LANCER-WAN.bat"
Write-Host "Then open http://127.0.0.1:7860"
Write-Host "Then double-click Desktop shortcut 'video ia'"
Write-Host ""
