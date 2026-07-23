@echo off
REM Wan 2.1 on NVIDIA GPU (CUDA)
cd /d "%~dp0app"
set "PY=%~dp0app\env\Scripts\python.exe"
if not exist "%PY%" (
  echo Missing env. Run INSTALL-NVIDIA.ps1 first.
  pause
  exit /b 1
)
set SULPHUR_SNAPDRAGON=
set SULPHUR_ALLOW_CPU=0
set SULPHUR_CPU_OFFLOAD=1
set WAN_DTYPE=float16
set WAN_MODEL_CACHE=%~dp0models
set GRADIO_SERVER_PORT=7860
set HF_HUB_DISABLE_SYMLINKS_WARNING=1
echo.
echo Wan NVIDIA - http://127.0.0.1:7860
echo Keep this window open.
echo.
"%PY%" -c "import torch; print('cuda', torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU only')"
"%PY%" gradio_server.py
pause
