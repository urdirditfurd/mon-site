@echo off
if not "%1"=="hidden" (
    start /min "" cmd /c "%~f0" hidden
    exit /b
)

cd /d C:\ComfyUI-ARM\ComfyUI-ARM-Windows
start /b C:\ComfyUI-ARM\ComfyUI-ARM-Windows\venv\Scripts\pythonw.exe main.py --cpu --force-fp16 --port 8190

set /a tries=0
:wait_comfy
curl -s --max-time 2 http://127.0.0.1:8190/system_stats >nul 2>&1
if not errorlevel 1 goto comfy_ready
set /a tries+=1
if %tries% geq 60 exit /b 1
timeout /t 2 /nobreak >nul
goto wait_comfy

:comfy_ready
cd /d C:\ComfyUI-ARM\LTX_Studio
start /b C:\ComfyUI-ARM\ComfyUI-ARM-Windows\venv\Scripts\pythonw.exe C:\ComfyUI-ARM\LTX_Studio\server.py
timeout /t 3 /nobreak >nul
start http://127.0.0.1:8191
exit /b
