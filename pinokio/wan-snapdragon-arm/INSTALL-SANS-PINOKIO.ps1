# Wan WITHOUT Pinokio downloads (0/11 fix)
# Paste ALL of this into PowerShell, then press Enter.

$ErrorActionPreference = "Continue"
$Root = Join-Path $env:USERPROFILE "mon-site\pinokio\wan-snapdragon-arm"
$App  = Join-Path $Root "app"
$Venv = Join-Path $App "env"

if (-not (Test-Path (Join-Path $App "wan_engine.py"))) {
  Write-Host "Project missing. Run first:" -ForegroundColor Yellow
  Write-Host '  cd $env:USERPROFILE\mon-site; git pull'
  throw "wan_engine.py not found in $App"
}

Write-Host "Using: $Root" -ForegroundColor Cyan

# Find real Python (not Windows Store stub)
$Py = $null
foreach ($name in @("py", "python")) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if (-not $cmd) { continue }
  try {
    if ($name -eq "py") { $out = & py -3 -c "import sys; print(sys.executable)" 2>$null }
    else { $out = & $cmd.Source -c "import sys; print(sys.executable)" 2>$null }
    if ($LASTEXITCODE -eq 0 -and $out -and ($out -notmatch "WindowsApps")) { $Py = $out.Trim(); break }
  } catch {}
}
if (-not $Py) {
  Write-Host "Installing Python 3.12 via winget..." -ForegroundColor Cyan
  winget install --id Python.Python.3.12 -e --accept-package-agreements --accept-source-agreements
  $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
  $Py = (py -3 -c "import sys; print(sys.executable)").Trim()
}
Write-Host "Python: $Py"

if (-not (Test-Path (Join-Path $Venv "Scripts\python.exe"))) {
  Write-Host "==> Creating venv..." -ForegroundColor Cyan
  & $Py -m venv $Venv
} else {
  Write-Host "venv already exists - reusing it." -ForegroundColor Cyan
}

$Pip = Join-Path $Venv "Scripts\pip.exe"
$Vpy = Join-Path $Venv "Scripts\python.exe"
if (-not (Test-Path $Vpy)) { throw "venv python missing: $Vpy" }

function Invoke-Pip {
  param([Parameter(ValueFromRemainingArguments=$true)]$Args)
  # Avoid PowerShell treating pip stderr WARNINGS as fatal errors
  cmd /c "`"$Vpy`" -m pip $Args"
  return $LASTEXITCODE
}

Write-Host "==> pip upgrade..." -ForegroundColor Cyan
Invoke-Pip install -U pip setuptools wheel | Out-Null

Write-Host "==> torch CPU (retry x3)..." -ForegroundColor Cyan
$ok = $false
for ($i=1; $i -le 3; $i++) {
  Write-Host "Attempt $i/3"
  Invoke-Pip uninstall -y torch torchvision torchaudio | Out-Null
  $code = Invoke-Pip install --timeout 100 --retries 5 torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
  if ($code -eq 0) { $ok = $true; break }
  Start-Sleep -Seconds 5
}
if (-not $ok) { throw "torch download failed. Check internet / antivirus / VPN." }

Write-Host "==> requirements..." -ForegroundColor Cyan
$code = Invoke-Pip install --timeout 100 --retries 5 -r "`"$(Join-Path $App 'requirements.txt')`""
if ($code -ne 0) {
  # fallback without nested quotes issues
  Push-Location $App
  $code = cmd /c "`"$Vpy`" -m pip install --timeout 100 --retries 5 -r requirements.txt"
  Pop-Location
}
if ($code -ne 0) { throw "requirements failed" }

Write-Host "==> check..." -ForegroundColor Cyan
$env:SULPHUR_SNAPDRAGON = "1"
$env:SULPHUR_ALLOW_CPU = "1"
Push-Location $App
& $Vpy wan_engine.py check
$checkCode = $LASTEXITCODE
Pop-Location
if ($checkCode -ne 0) { throw "wan_engine check failed" }

Write-Host ""
Write-Host "OK - local Wan ready WITHOUT Pinokio." -ForegroundColor Green
Write-Host "Start with:"
Write-Host "  $Root\LANCER-WAN.bat"
Write-Host "Open http://127.0.0.1:7860"
