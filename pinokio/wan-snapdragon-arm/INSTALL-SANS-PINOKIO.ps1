# Wan WITHOUT Pinokio - robust torch install (Snapdragon / x64)
$ErrorActionPreference = "Continue"
$Root = Join-Path $env:USERPROFILE "mon-site\pinokio\wan-snapdragon-arm"
$App  = Join-Path $Root "app"
$Venv = Join-Path $App "env"

if (-not (Test-Path (Join-Path $App "wan_engine.py"))) {
  throw "wan_engine.py not found. Run: cd `$env:USERPROFILE\mon-site; git pull"
}

Write-Host "Using: $Root" -ForegroundColor Cyan

# Detect ARM64 (Snapdragon)
$isArm = $false
try {
  $arch = (Get-CimInstance Win32_Processor).Architecture
  # 12 = ARM64
  if ($arch -eq 12) { $isArm = $true }
} catch {}
if ($env:PROCESSOR_ARCHITECTURE -match "ARM") { $isArm = $true }
Write-Host ("CPU arch: " + $(if ($isArm) { "ARM64 / Snapdragon" } else { "x64 / other" }))

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
if (-not $Py) { throw "Python not found" }
Write-Host "Python: $Py"

if (-not (Test-Path (Join-Path $Venv "Scripts\python.exe"))) {
  Write-Host "==> Creating venv..." -ForegroundColor Cyan
  & $Py -m venv $Venv
}
$Vpy = Join-Path $Venv "Scripts\python.exe"

function Run-Pip {
  param([string]$ArgLine)
  Write-Host "pip $ArgLine" -ForegroundColor DarkGray
  $pinfo = New-Object System.Diagnostics.ProcessStartInfo
  $pinfo.FileName = $Vpy
  $pinfo.Arguments = "-m pip $ArgLine"
  $pinfo.RedirectStandardOutput = $true
  $pinfo.RedirectStandardError = $true
  $pinfo.UseShellExecute = $false
  $pinfo.CreateNoWindow = $true
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $pinfo
  [void]$p.Start()
  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  if ($stdout) { Write-Host $stdout }
  if ($stderr) { Write-Host $stderr -ForegroundColor Yellow }
  return $p.ExitCode
}

Write-Host "==> pip upgrade..." -ForegroundColor Cyan
[void](Run-Pip "install -U pip setuptools wheel")

Write-Host "==> Installing torch..." -ForegroundColor Cyan
$attempts = @()
if ($isArm) {
  $attempts += "--pre torch torchvision torchaudio --index-url https://download.pytorch.org/whl/nightly/cpu"
  $attempts += "torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu"
} else {
  $attempts += "torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu"
  $attempts += "torch torchvision torchaudio"
}

$ok = $false
$n = 0
foreach ($a in $attempts) {
  $n++
  Write-Host "Attempt $n : $a" -ForegroundColor Cyan
  $code = Run-Pip "install --timeout 120 --retries 5 $a"
  if ($code -eq 0) {
    # verify import
    & $Vpy -c "import torch; print('torch', torch.__version__, 'cuda', torch.cuda.is_available())"
    if ($LASTEXITCODE -eq 0) { $ok = $true; break }
  }
  Write-Host "Attempt $n failed (exit $code)" -ForegroundColor Yellow
}

if (-not $ok) {
  Write-Host ""
  Write-Host "Torch install FAILED on this PC." -ForegroundColor Red
  Write-Host "Use Colab instead (no local torch needed):" -ForegroundColor Yellow
  Write-Host '  irm https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/conte-factory-pipeline-0391/pinokio/wan-snapdragon-arm/OUVRIR-COLAB.ps1 | iex'
  throw "torch failed"
}

Write-Host "==> requirements..." -ForegroundColor Cyan
$req = Join-Path $App "requirements.txt"
$code = Run-Pip "install --timeout 120 --retries 5 -r `"$req`""
if ($code -ne 0) { throw "requirements failed" }

Write-Host "==> check..." -ForegroundColor Cyan
$env:SULPHUR_SNAPDRAGON = "1"
$env:SULPHUR_ALLOW_CPU = "1"
Push-Location $App
& $Vpy wan_engine.py check
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { throw "wan_engine check failed" }

Write-Host ""
Write-Host "OK - local Wan ready WITHOUT Pinokio." -ForegroundColor Green
Write-Host "Start: $Root\LANCER-WAN.bat"
Write-Host "Open http://127.0.0.1:7860"
