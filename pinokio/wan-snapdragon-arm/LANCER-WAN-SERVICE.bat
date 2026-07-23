@echo off
REM Wan 2.1 service - lance par video ia (logs dans WAN_SERVICE_LOG)
cd /d "%~dp0app"
set "PY=%~dp0app\env\Scripts\python.exe"
if not exist "%PY%" (
  if defined WAN_SERVICE_LOG (
    echo [%date% %time%] ERREUR: venv Wan manquant. Lance INSTALL-NVIDIA.ps1>>"%WAN_SERVICE_LOG%"
  )
  exit /b 1
)
set SULPHUR_SNAPDRAGON=
set SULPHUR_ALLOW_CPU=0
set WAN_DTYPE=float16
set WAN_MODEL_CACHE=%~dp0models
set GRADIO_SERVER_PORT=7860
if defined WAN_SERVICE_LOG (
  echo [%date% %time%] Demarrage gradio_server.py avec %PY%>>"%WAN_SERVICE_LOG%"
  "%PY%" gradio_server.py 1>>"%WAN_SERVICE_LOG%" 2>&1
) else (
  "%PY%" gradio_server.py
)
