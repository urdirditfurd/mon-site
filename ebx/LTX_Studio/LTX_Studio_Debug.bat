@echo off
title LTX Studio Debug
cd /d "%~dp0"
set "PYTHON=C:\ComfyUI-ARM\ComfyUI-ARM-Windows\venv\Scripts\python.exe"

if not exist "%PYTHON%" (
    echo Python introuvable: %PYTHON%
    pause
    exit /b 1
)

echo LTX Studio - Self-Healing Debug
echo Logs: %~dp0logs\comfyui.log
echo.

"%PYTHON%" launcher.py --debug --no-browser
pause
