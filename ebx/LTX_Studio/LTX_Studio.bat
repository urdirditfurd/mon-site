@echo off
if not "%1"=="hidden" (
    start /min "" cmd /c "%~f0" hidden
    exit /b
)

set "COMFY_DIR=C:\ComfyUI-ARM\ComfyUI-ARM-Windows"
set "STUDIO_DIR=C:\ComfyUI-ARM\LTX_Studio"
set "PYTHON=%COMFY_DIR%\venv\Scripts\python.exe"
set "PYTHONW=%COMFY_DIR%\venv\Scripts\pythonw.exe"
set "LOG_DIR=%STUDIO_DIR%\logs"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

"%PYTHON%" -m pip install -r "%STUDIO_DIR%\requirements.txt" --quiet >> "%LOG_DIR%\setup.log" 2>&1

curl -s --max-time 2 http://127.0.0.1:8190/system_stats >nul 2>&1
if not errorlevel 1 goto comfy_ready

start /b cmd /c "cd /d %COMFY_DIR% && %PYTHON% main.py --cpu --force-fp16 --port 8190 --database-url sqlite:///C:/ComfyUI-ARM/comfyui_ltx.db >> %LOG_DIR%\comfyui.log 2>&1"

set /a tries=0
:wait_comfy
curl -s --max-time 3 http://127.0.0.1:8190/system_stats >nul 2>&1
if not errorlevel 1 goto comfy_ready
set /a tries+=1
if %tries% geq 180 exit /b 1
timeout /t 3 /nobreak >nul
goto wait_comfy

:comfy_ready
start /b cmd /c "cd /d %STUDIO_DIR% && %PYTHONW% server.py >> %LOG_DIR%\server.log 2>&1"
timeout /t 4 /nobreak >nul
start http://127.0.0.1:8191
exit /b
