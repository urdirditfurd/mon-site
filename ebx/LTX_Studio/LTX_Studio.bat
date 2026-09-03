@echo off
REM One-click silent launcher — double-clic uniquement
if not "%1"=="hidden" (
    start /min "" cmd /c "%~f0" hidden
    exit /b
)

set "STUDIO_DIR=%~dp0"
set "STUDIO_DIR=%STUDIO_DIR:~0,-1%"
set "PYTHON=C:\ComfyUI-ARM\ComfyUI-ARM-Windows\venv\Scripts\python.exe"
set "LOG_DIR=%STUDIO_DIR%\logs"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

if not exist "%PYTHON%" (
    echo Python introuvable: %PYTHON%> "%LOG_DIR%\setup.log"
    exit /b 1
)

cd /d "%STUDIO_DIR%"
REM python.exe (pas pythonw) pour logs fiables ; CREATE_NO_WINDOW géré dans Python
start /b "" "%PYTHON%" "%STUDIO_DIR%\launcher.py"
exit /b
