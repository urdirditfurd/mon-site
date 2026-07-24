# Installe le moteur lip-sync gratuit (Wav2Lip) pour video ia
# Usage:
#   powershell -ExecutionPolicy Bypass -File C:\ConteFactory\pinokio\talking-wav2lip\INSTALL-LIPSYNC.ps1

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$App = Join-Path $Root "app"
$EnvDir = Join-Path $App "env"
$Wav2Lip = Join-Path $App "Wav2Lip"
$Py = Join-Path $EnvDir "Scripts\python.exe"
$Pip = Join-Path $EnvDir "Scripts\pip.exe"

Write-Host "Install lip-sync Wav2Lip (gratuit, RTX 3080 OK)" -ForegroundColor Cyan

function Find-Python {
  $candidates = @(
    "C:\ConteFactory\conte-factory\.venv\Scripts\python.exe",
    "C:\ConteFactory\pinokio\wan-snapdragon-arm\app\env\Scripts\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python310\python.exe"
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { return $c }
  }
  $cmd = Get-Command python -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $cmd = Get-Command py -ErrorAction SilentlyContinue
  if ($cmd) {
    try {
      $out = & py -3 -c "import sys; print(sys.executable)" 2>$null
      if ($out -and (Test-Path $out.Trim())) { return $out.Trim() }
    } catch {}
  }
  return $null
}

$BasePy = Find-Python
if (-not $BasePy) {
  Write-Host "Python introuvable. Installe Python 3.10+ depuis python.org (coche Add to PATH)." -ForegroundColor Red
  exit 1
}
Write-Host "Python de base: $BasePy"

if (-not (Test-Path $Py)) {
  Write-Host "Creation venv..."
  & $BasePy -m venv $EnvDir
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $Py)) {
    Write-Host "Echec creation venv" -ForegroundColor Red
    exit 1
  }
}

Write-Host "Mise a jour pip..."
& $Py -m pip install --upgrade pip setuptools wheel

# 1) Torch CUDA depuis index NVIDIA (separe)
Write-Host "Install PyTorch CUDA (peut prendre plusieurs minutes)..."
& $Py -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
if ($LASTEXITCODE -ne 0) {
  Write-Host "cu121 echoue, essai cu118..." -ForegroundColor Yellow
  & $Py -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
}
if ($LASTEXITCODE -ne 0) {
  Write-Host "CUDA torch echoue, install CPU torch..." -ForegroundColor Yellow
  & $Py -m pip install torch torchvision torchaudio
}

# 2) Le reste depuis PyPI normal (PAS l'index torch)
Write-Host "Install gradio + deps PyPI..."
$Req = Join-Path $env:TEMP "lipsync-install-req.txt"
@"
gradio>=4.0,!=6.*
gradio_client
opencv-python
numpy>=1.23,<2.3
librosa
soundfile
huggingface_hub
requests
pillow
"@ | Set-Content -Path $Req -Encoding ASCII
& $Py -m pip install -r $Req

if ($LASTEXITCODE -ne 0) {
  Write-Host "Echec pip deps" -ForegroundColor Red
  exit 1
}

# Verifie gradio
& $Py -c "import gradio as g; print('gradio', g.__version__)"
if ($LASTEXITCODE -ne 0) {
  Write-Host "gradio toujours manquant" -ForegroundColor Red
  exit 1
}

if (-not (Test-Path (Join-Path $Wav2Lip "inference.py"))) {
  Write-Host "Clone Wav2Lip..."
  if (Test-Path $Wav2Lip) { Remove-Item -Recurse -Force $Wav2Lip }
  git clone --depth 1 https://github.com/Rudrabha/Wav2Lip.git $Wav2Lip
}

$CkptDir = Join-Path $Wav2Lip "checkpoints"
New-Item -ItemType Directory -Force -Path $CkptDir | Out-Null
$Ckpt = Join-Path $CkptDir "wav2lip_gan.pth"

if (-not (Test-Path $Ckpt) -or ((Get-Item $Ckpt).Length -lt 1000000)) {
  Write-Host "Telechargement checkpoint wav2lip_gan.pth ..."
  $downloaded = $false
  $urls = @(
    "https://huggingface.co/Nekochu/Wav2Lip/resolve/main/wav2lip_gan.pth",
    "https://huggingface.co/camenduru/Wav2Lip/resolve/main/checkpoints/wav2lip_gan.pth",
    "https://github.com/Rudrabha/Wav2Lip/releases/download/v1.0/wav2lip_gan.pth"
  )
  foreach ($url in $urls) {
    try {
      Write-Host "  essai: $url"
      Invoke-WebRequest -Uri $url -OutFile $Ckpt -UseBasicParsing
      if ((Test-Path $Ckpt) -and ((Get-Item $Ckpt).Length -gt 1000000)) {
        $downloaded = $true
        Write-Host "Checkpoint OK: $Ckpt" -ForegroundColor Green
        break
      }
    } catch {
      Write-Host "  echec download" -ForegroundColor Yellow
    }
  }
  if (-not $downloaded) {
    try {
      & $Py -c "from huggingface_hub import hf_hub_download; import shutil; p=hf_hub_download(repo_id='Nekochu/Wav2Lip', filename='wav2lip_gan.pth'); shutil.copy(p, r'$Ckpt'); print('OK')"
      if ((Test-Path $Ckpt) -and ((Get-Item $Ckpt).Length -gt 1000000)) { $downloaded = $true }
    } catch {}
  }
  if (-not $downloaded) {
    Write-Host "Checkpoint auto echoue. Place manuellement wav2lip_gan.pth dans:" -ForegroundColor Yellow
    Write-Host $CkptDir
    Write-Host "Sans checkpoint: fallback portrait+audio (video OK, lip-sync faible)."
  }
} else {
  Write-Host "Checkpoint deja present." -ForegroundColor Green
}

Write-Host ""
Write-Host "OK install. Prochaine etape:" -ForegroundColor Green
Write-Host "  1) .\pinokio\talking-wav2lip\LANCER-LIPSYNC.bat"
Write-Host "  2) Relancer video ia"
Write-Host "  3) Creer une NOUVELLE video"
