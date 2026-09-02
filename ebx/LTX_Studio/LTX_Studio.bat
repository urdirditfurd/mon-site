@echo off
if not "%1"=="hidden" (
    start /min "" cmd /c "%~f0" hidden
    exit /b
)

set "STUDIO_DIR=%~dp0"
set "STUDIO_DIR=%STUDIO_DIR:~0,-1%"
set "PYTHON=C:\ComfyUI-ARM\ComfyUI-ARM-Windows\venv\Scripts\pythonw.exe"

if not exist "%PYTHON%" (
    mkdir "%STUDIO_DIR%\logs" 2>nul
    echo Python introuvable: %PYTHON% > "%STUDIO_DIR%\logs\setup.log"
    exit /b 1
)

cd /d "%STUDIO_DIR%"
start /b "" "%PYTHON%" "%STUDIO_DIR%\launcher.py"
exit /b
