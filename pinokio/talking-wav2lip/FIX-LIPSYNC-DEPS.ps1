# Reparation rapide: deps dans le venv existant (ASCII-safe PowerShell)
# Usage:
#   powershell -ExecutionPolicy Bypass -File C:\ConteFactory\pinokio\talking-wav2lip\FIX-LIPSYNC-DEPS.ps1

$ErrorActionPreference = "Stop"
$App = Join-Path $PSScriptRoot "app"
$Py = Join-Path $App "env\Scripts\python.exe"
$CkptDir = Join-Path $App "Wav2Lip\checkpoints"
$Ckpt = Join-Path $CkptDir "wav2lip_gan.pth"

if (-not (Test-Path $Py)) {
  Write-Host "venv absent - lance INSTALL-LIPSYNC.ps1" -ForegroundColor Red
  exit 1
}

Write-Host "Fix deps lip-sync (PyPI)..." -ForegroundColor Cyan
& $Py -m pip install --upgrade pip
# Eviter < dans les args PowerShell: passer via fichier requirements
$Req = Join-Path $env:TEMP "lipsync-fix-req.txt"
@"
gradio>=4.0,!=6.*
gradio_client
huggingface_hub
pillow
requests
numpy>=1.23,<2.3
"@ | Set-Content -Path $Req -Encoding ASCII
& $Py -m pip install -r $Req

Write-Host "Verif gradio..."
& $Py -c "import gradio as g; print('OK gradio', g.__version__)"

New-Item -ItemType Directory -Force -Path $CkptDir | Out-Null
if (-not (Test-Path $Ckpt)) {
  Write-Host "Download checkpoint..."
  $urls = @(
    "https://huggingface.co/Nekochu/Wav2Lip/resolve/main/wav2lip_gan.pth",
    "https://github.com/Rudrabha/Wav2Lip/releases/download/v1.0/wav2lip_gan.pth"
  )
  $ok = $false
  foreach ($url in $urls) {
    try {
      Write-Host "  essai $url"
      Invoke-WebRequest -Uri $url -OutFile $Ckpt -UseBasicParsing
      if ((Test-Path $Ckpt) -and ((Get-Item $Ckpt).Length -gt 1000000)) {
        $ok = $true
        break
      }
    } catch {
      Write-Host "  echec" -ForegroundColor Yellow
    }
  }
  if ($ok) {
    Write-Host "Checkpoint OK" -ForegroundColor Green
  } else {
    Write-Host "Checkpoint manquant - fallback portrait actif." -ForegroundColor Yellow
  }
} else {
  Write-Host "Checkpoint deja present." -ForegroundColor Green
}

Write-Host "OK. Lance LANCER-LIPSYNC.bat" -ForegroundColor Green
