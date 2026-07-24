# Installe le moteur lip-sync gratuit (Wav2Lip) pour video ia
# Usage:
#   powershell -ExecutionPolicy Bypass -File C:\ConteFactory\pinokio\talking-wav2lip\INSTALL-LIPSYNC.ps1

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$App = Join-Path $Root "app"
$EnvDir = Join-Path $App "env"
$Wav2Lip = Join-Path $App "Wav2Lip"

Write-Host "Install lip-sync Wav2Lip (gratuit, RTX 3080 OK)" -ForegroundColor Cyan

if (-not (Test-Path $EnvDir)) {
  Write-Host "Creation venv..."
  py -3.11 -m venv $EnvDir
  if ($LASTEXITCODE -ne 0) { python -m venv $EnvDir }
}

$Py = Join-Path $EnvDir "Scripts\python.exe"
& $Py -m pip install --upgrade pip
& $Py -m pip install gradio gradio_client torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
& $Py -m pip install opencv-python numpy librosa

if (-not (Test-Path (Join-Path $Wav2Lip "inference.py"))) {
  Write-Host "Clone Wav2Lip..."
  git clone --depth 1 https://github.com/Rudrabha/Wav2Lip.git $Wav2Lip
}

$CkptDir = Join-Path $Wav2Lip "checkpoints"
New-Item -ItemType Directory -Force -Path $CkptDir | Out-Null
$Ckpt = Join-Path $CkptDir "wav2lip_gan.pth"
if (-not (Test-Path $Ckpt)) {
  Write-Host "Telechargement checkpoint wav2lip_gan.pth ..."
  # Miroir HuggingFace / GitHub release souvent utilise
  try {
    & $Py -c "from huggingface_hub import hf_hub_download; import shutil; p=hf_hub_download('numz/wav2lip_studio','wav2lip_gan.pth'); shutil.copy(p, r'$Ckpt')"
  } catch {
    Write-Host "Checkpoint auto echoue. Place manuellement wav2lip_gan.pth dans:" -ForegroundColor Yellow
    Write-Host $CkptDir
  }
}

Write-Host "OK. Lance: LANCER-LIPSYNC.bat puis SWITCH-TO-TALKING.ps1" -ForegroundColor Green
