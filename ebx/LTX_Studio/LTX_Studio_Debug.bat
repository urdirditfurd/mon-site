@echo off
title LTX Studio - Diagnostic
cd /d "%~dp0"
set "COMFY_DIR=C:\ComfyUI-ARM\ComfyUI-ARM-Windows"
set "PYTHON=%COMFY_DIR%\venv\Scripts\python.exe"

echo.
echo === LTX Studio Diagnostic ===
echo.

if not exist "%PYTHON%" (
    echo [ERREUR] Python introuvable:
    echo   %PYTHON%
    pause
    exit /b 1
)

echo [1/3] Installation dependances...
"%PYTHON%" -m pip install -r requirements.txt
echo.

echo [2/3] Demarrage ComfyUI (CPU, port 8190)...
echo       Patientez 2-5 minutes au premier lancement.
start "ComfyUI" cmd /k "cd /d %COMFY_DIR% && %PYTHON% main.py --cpu --force-fp16 --port 8190 --database-url sqlite:///C:/ComfyUI-ARM/comfyui_ltx.db"

echo [3/3] Demarrage LTX Studio (port 8191)...
"%PYTHON%" server.py

pause
