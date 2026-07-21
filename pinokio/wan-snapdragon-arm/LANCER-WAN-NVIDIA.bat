@echo off
REM Wan 2.1 on NVIDIA GPU (CUDA) - do NOT force Snapdragon/CPU mode
cd /d "%~dp0app"
if exist "env\Scripts\activate.bat" (
  call env\Scripts\activate.bat
) else (
  echo Missing env. Run INSTALL-NVIDIA.ps1 first.
  pause
  exit /b 1
)
set SULPHUR_SNAPDRAGON=
set SULPHUR_ALLOW_CPU=0
set WAN_MODEL_CACHE=%~dp0models
set GRADIO_SERVER_PORT=7860
echo.
echo Wan NVIDIA - http://127.0.0.1:7860
echo Keep this window open.
echo.
python -c "import torch; print('cuda', torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU only')"
python gradio_server.py
pause
