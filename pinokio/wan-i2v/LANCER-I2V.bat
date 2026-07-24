@echo off
setlocal
cd /d "%~dp0app"

set "PORT=7861"
set "URL=http://127.0.0.1:%PORT%"

powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri '%URL%/' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -ge 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
  echo I2V deja pret sur %URL%
  pause
  exit /b 0
)

if exist "env\Scripts\python.exe" (
  set "PYTHON=env\Scripts\python.exe"
) else if exist "%~dp0..\wan-snapdragon-arm\app\env\Scripts\python.exe" (
  set "PYTHON=%~dp0..\wan-snapdragon-arm\app\env\Scripts\python.exe"
) else if exist "C:\ConteFactory\pinokio\wan-snapdragon-arm\app\env\Scripts\python.exe" (
  set "PYTHON=C:\ConteFactory\pinokio\wan-snapdragon-arm\app\env\Scripts\python.exe"
) else (
  echo [ERREUR] Python Wan introuvable. Lance INSTALL-I2V.ps1
  pause
  exit /b 1
)

set GRADIO_SERVER_PORT=%PORT%
set WAN_DTYPE=float16
set SULPHUR_CPU_OFFLOAD=1
set CONTE_I2V_LOWVRAM=1
if not defined WAN_I2V_BACKEND set WAN_I2V_BACKEND=ltx
if not defined PINOKIO_I2V_FRAMES set PINOKIO_I2V_FRAMES=81
if not defined PINOKIO_I2V_STEPS set PINOKIO_I2V_STEPS=16
if not defined PINOKIO_I2V_WIDTH set PINOKIO_I2V_WIDTH=848
if not defined PINOKIO_I2V_HEIGHT set PINOKIO_I2V_HEIGHT=480
if not defined PINOKIO_I2V_GUIDANCE set PINOKIO_I2V_GUIDANCE=5.5

echo.
echo Demarrage I2V RAPIDE sur %URL%
echo Backend=%WAN_I2V_BACKEND% steps=%PINOKIO_I2V_STEPS% frames=%PINOKIO_I2V_FRAMES% %PINOKIO_I2V_WIDTH%x%PINOKIO_I2V_HEIGHT%
echo Cible: 1-2 min / scene
echo Python: %PYTHON%
echo.
"%PYTHON%" gradio_server.py
if errorlevel 1 pause
