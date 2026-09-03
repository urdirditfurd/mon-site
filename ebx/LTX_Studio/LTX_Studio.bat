@echo off
title LTX Studio
cd /d "%~dp0"

REM Si lance depuis un ZIP / dossier temporaire Windows → message clair
echo %~dp0 | findstr /I "\\Temp\\ AppData\\Local\\Temp" >nul
if not errorlevel 1 (
    echo.
    echo ========================================================
    echo  ERREUR : vous lancez LTX_Studio depuis le ZIP.
    echo.
    echo  1. Fermez cette fenetre
    echo  2. Clic droit sur LTX_Studio.zip → Extraire tout
    echo  3. Extraire vers : C:\ComfyUI-ARM\LTX_Studio\
    echo  4. Ouvrez CE dossier, puis double-cliquez LTX_Studio.bat
    echo ========================================================
    echo.
    pause
    exit /b 1
)

set "STUDIO_DIR=%~dp0"
set "STUDIO_DIR=%STUDIO_DIR:~0,-1%"
set "PYTHON=C:\ComfyUI-ARM\ComfyUI-ARM-Windows\venv\Scripts\python.exe"
set "LOG_DIR=%STUDIO_DIR%\logs"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

if not exist "%PYTHON%" (
    echo.
    echo Python ComfyUI introuvable :
    echo   %PYTHON%
    echo.
    echo Verifiez que ComfyUI est installe dans :
    echo   C:\ComfyUI-ARM\ComfyUI-ARM-Windows\
    echo.
    pause
    exit /b 1
)

if not exist "%STUDIO_DIR%\launcher.py" (
    echo.
    echo Fichier launcher.py manquant dans :
    echo   %STUDIO_DIR%
    echo.
    echo Extraire TOUT le zip dans C:\ComfyUI-ARM\LTX_Studio\
    echo.
    pause
    exit /b 1
)

echo.
echo ========================================================
echo  LTX Studio demarre...
echo  Installation des composants si besoin...
echo  Le navigateur va s'ouvrir sur http://127.0.0.1:8191
echo  Premier lancement : 5 a 10 minutes possibles.
echo  Vous pouvez minimiser cette fenetre (ne pas la fermer).
echo ========================================================
echo.

cd /d "%STUDIO_DIR%"
"%PYTHON%" -m pip install -r "%STUDIO_DIR%\requirements.txt"
if errorlevel 1 (
    echo.
    echo Echec pip. Consultez logs\setup.log
    pause
    exit /b 1
)

"%PYTHON%" "%STUDIO_DIR%\launcher.py"
echo.
echo LTX Studio s'est arrete. Consultez logs\boot.log
pause
