@echo off
title LTX Studio Debug
cd /d "%~dp0"
set "PYTHON=C:\ComfyUI-ARM\ComfyUI-ARM-Windows\venv\Scripts\python.exe"

if not exist "%PYTHON%" (
    echo Python introuvable: %PYTHON%
    pause
    exit /b 1
)

echo.
echo LTX Studio - mode diagnostic
echo ComfyUI s'ouvrira dans une fenetre separee.
echo Patientez 5-10 minutes au premier lancement.
echo.

"%PYTHON%" launcher.py --debug
pause
