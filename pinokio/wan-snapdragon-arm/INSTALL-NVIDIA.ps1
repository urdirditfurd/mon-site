# Install Wan 2.1 for NVIDIA GPU tower (CUDA) - no Pinokio required
# Run:
#   irm https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/conte-factory-pipeline-0391/pinokio/wan-snapdragon-arm/INSTALL-NVIDIA.ps1 | iex

$ErrorActionPreference = "Continue"
$Root = Join-Path $env:USERPROFILE "mon-site\pinokio\wan-snapdragon-arm"
$App  = Join-Path $Root "app"
$Venv = Join-Path $App "env"

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Wan 2.1 - INSTALL NVIDIA (CUDA)" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

if (-not (Test-Path (Join-Path $App "wan_engine.py"))) {
  Write-Host "Cloning mon-site if needed..." -ForegroundColor Cyan
  $repo = Join-Path $env:USERPROFILE "mon-site"
  if (-not (Test-Path $repo)) {
    git clone --branch cursor/conte-factory-pipeline-0391 --single-branch https://github.com/urdirditfurd/mon-site.git $repo
  } else {
    Push-Location $repo
    git pull origin cursor/conte-factory-pipeline-0391
    Pop-Location
  }
}
if (-not (Test-Path (Join-Path $App "wan_engine.py"))) {
  throw "wan_engine.py missing at $App"
}

# Check nvidia-smi
Write-Host "==> Checking NVIDIA..." -ForegroundColor Cyan
$smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
if ($smi) {
  & nvidia-smi
} else {
  Write-Host "WARNING: nvidia-smi not found. Install NVIDIA drivers first." -ForegroundColor Yellow
  Write-Host "https://www.nvidia.com/Download/index.aspx"
}

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
  winget install --id Python.Python.3.12 -e --accept-package-agreements --accept-source-agreements
  $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
  $Py = (py -3 -c "import sys; print(sys.executable)").Trim()
}
Write-Host "Python: $Py"

# Fresh GPU venv recommended if CPU torch was installed before
if (Test-Path $Venv) {
  Write-Host "Removing old venv (CPU/old) to install CUDA cleanly..." -ForegroundColor Yellow
  Remove-Item -Recurse -Force $Venv
}
Write-Host "==> Creating venv..." -ForegroundColor Cyan
& $Py -m venv $Venv
$Vpy = Join-Path $Venv "Scripts\python.exe"

function Run-Pip([string]$ArgLine) {
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

[void](Run-Pip "install -U pip setuptools wheel")

Write-Host "==> Installing torch CUDA..." -ForegroundColor Cyan
# Try cu124 then cu121 then default
$cudaIndexes = @(
  "https://download.pytorch.org/whl/cu124",
  "https://download.pytorch.org/whl/cu121",
  "https://download.pytorch.org/whl/cu118"
)
$ok = $false
foreach ($idx in $cudaIndexes) {
  Write-Host "Trying $idx" -ForegroundColor Cyan
  $code = Run-Pip "install --timeout 180 --retries 5 torch torchvision torchaudio --index-url $idx"
  if ($code -eq 0) {
    & $Vpy -c "import torch; print('torch', torch.__version__); print('cuda', torch.cuda.is_available()); print('gpu', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'none')"
    if ($LASTEXITCODE -eq 0) {
      $probe = & $Vpy -c "import torch; print(torch.cuda.is_available())"
      if ($probe -match "True") { $ok = $true; break }
    }
  }
}
if (-not $ok) {
  Write-Host "CUDA torch not confirmed. Falling back to CPU torch (slower)." -ForegroundColor Yellow
  [void](Run-Pip "install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu")
}

$req = Join-Path $App "requirements.txt"
Write-Host "==> requirements..." -ForegroundColor Cyan
$code = Run-Pip "install --timeout 180 --retries 5 -r `"$req`""
if ($code -ne 0) { throw "requirements failed" }

# ffmpeg for Conte Factory
$ff = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ff) {
  Write-Host "==> Installing ffmpeg (winget)..." -ForegroundColor Cyan
  winget install --id Gyan.FFmpeg -e --accept-package-agreements --accept-source-agreements
}

Write-Host "==> wan_engine check..." -ForegroundColor Cyan
Remove-Item Env:SULPHUR_SNAPDRAGON -ErrorAction SilentlyContinue
$env:SULPHUR_ALLOW_CPU = "0"
Push-Location $App
& $Vpy wan_engine.py check
Pop-Location

# Conte Factory venv
$Cf = Join-Path $env:USERPROFILE "mon-site\conte-factory"
if (Test-Path $Cf) {
  Write-Host "==> Conte Factory deps..." -ForegroundColor Cyan
  Push-Location $Cf
  if (-not (Test-Path ".venv\Scripts\python.exe")) {
    & $Py -m venv .venv
  }
  & ".\.venv\Scripts\python.exe" -m pip install -U pip
  & ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt
  if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
  }
  # Force NVIDIA-friendly defaults in .env
  $envText = Get-Content ".env" -Raw
  if ($envText -notmatch "CONTE_VIDEO_PROVIDER") { Add-Content ".env" "CONTE_VIDEO_PROVIDER=pinokio" }
  (Get-Content ".env") -replace "PINOKIO_WAN_FRAMES=.*", "PINOKIO_WAN_FRAMES=49" | Set-Content ".env"
  (Get-Content ".env") -replace "CONTE_AI_CLIP_SEC=.*", "CONTE_AI_CLIP_SEC=15" | Set-Content ".env"
  Pop-Location
}

Write-Host ""
Write-Host "OK - NVIDIA Wan ready." -ForegroundColor Green
Write-Host "1) Start Wan:  $Root\LANCER-WAN-NVIDIA.bat"
Write-Host "2) Open http://127.0.0.1:7860"
Write-Host "3) Desktop icon: conte-factory\scripts\install-desktop-shortcut.ps1"
Write-Host "4) Guide: mon-site\conte-factory\GUIDE-1-JOUR-NVIDIA.md"
Write-Host ""
