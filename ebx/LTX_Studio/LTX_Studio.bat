@echo off
if not "%1"=="hidden" (
    start /min "" cmd /c "%~f0" hidden
    exit /b
)

set "STUDIO_DIR=%~dp0"
set "STUDIO_DIR=%STUDIO_DIR:~0,-1%"
set "COMFY_DIR=C:\ComfyUI-ARM\ComfyUI-ARM-Windows"
set "PYTHON=%COMFY_DIR%\venv\Scripts\python.exe"
set "PYTHONW=%COMFY_DIR%\venv\Scripts\pythonw.exe"
set "LOG_DIR=%STUDIO_DIR%\logs"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

if not exist "%PYTHON%" (
    echo Python ComfyUI introuvable: %PYTHON% > "%LOG_DIR%\setup.log"
    exit /b 1
)

"%PYTHON%" -m pip install -r "%STUDIO_DIR%\requirements.txt" --quiet >> "%LOG_DIR%\setup.log" 2>&1

powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri 'http://127.0.0.1:8190/system_stats' -UseBasicParsing -TimeoutSec 2).StatusCode; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto start_server

start /b cmd /c "cd /d %COMFY_DIR% && %PYTHON% main.py --cpu --force-fp16 --port 8190 --database-url sqlite:///C:/ComfyUI-ARM/comfyui_ltx.db >> %LOG_DIR%\comfyui.log 2>&1"

:start_server
start /b cmd /c "cd /d %STUDIO_DIR% && %PYTHONW% server.py >> %LOG_DIR%\server.log 2>&1"
timeout /t 4 /nobreak >nul
start http://127.0.0.1:8191
exit /b
