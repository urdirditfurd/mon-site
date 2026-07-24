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

REM Reutilise le venv Wan T2V s'il existe, sinon env local
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
echo.
echo Demarrage Wan I2V sur %URL%
echo Python: %PYTHON%
echo Laisse cette fenetre ouverte pendant la generation.
echo.
"%PYTHON%" gradio_server.py
if errorlevel 1 pause
