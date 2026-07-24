# Reparation rapide: installe gradio + checkpoint dans le venv existant
# Usage:
#   powershell -ExecutionPolicy Bypass -File C:\ConteFactory\pinokio\talking-wav2lip\FIX-LIPSYNC-DEPS.ps1

$ErrorActionPreference = "Stop"
$App = Join-Path $PSScriptRoot "app"
$Py = Join-Path $App "env\Scripts\python.exe"
$Ckpt = Join-Path $App "Wav2Lip\checkpoints\wav2lip_gan.pth"

if (-not (Test-Path $Py)) {
  Write-Host "venv absent — lance INSTALL-LIPSYNC.ps1" -ForegroundColor Red
  exit 1
}

Write-Host "Fix deps lip-sync (PyPI normal)..." -ForegroundColor Cyan
& $Py -m pip install --upgrade pip
& $Py -m pip install "gradio>=4.0,<6" gradio_client huggingface_hub pillow requests "numpy<2.3"

Write-Host "Verif gradio..."
& $Py -c "import gradio; print('OK gradio', gradio.__version__)"

New-Item -ItemType Directory -Force -Path (Split-Path $Ckpt) | Out-Null
if (-not (Test-Path $Ckpt)) {
  Write-Host "Download checkpoint..."
  try {
    & $Py -c "from huggingface_hub import hf_hub_download; import shutil; p=hf_hub_download('numz/wav2lip_studio','wav2lip_gan.pth'); shutil.copy(p, r'$Ckpt'); print('ckpt OK')"
  } catch {
    Write-Host "Checkpoint manquant — fallback portrait actif." -ForegroundColor Yellow
  }
}

Write-Host "OK. Lance LANCER-LIPSYNC.bat" -ForegroundColor Green
