@echo off
title LTX Studio - NE PAS FERMER
cd /d "%~dp0"

REM Relance dans une fenetre qui ne peut PAS se fermer toute seule (cmd /k)
if /I not "%~1"=="KEEPOPEN" (
    start "LTX Studio - NE PAS FERMER" cmd /k "%~f0" KEEPOPEN
    exit /b 0
)

set "STUDIO_DIR=%~dp0"
set "STUDIO_DIR=%STUDIO_DIR:~0,-1%"
set "PYTHON=C:\ComfyUI-ARM\ComfyUI-ARM-Windows\venv\Scripts\python.exe"

echo.
echo ========================================================
echo  LTX Studio
echo  CETTE FENETRE DOIT RESTER OUVERTE
echo  Interface : http://127.0.0.1:8191
echo ========================================================
echo.

if not exist "%PYTHON%" (
    echo ERREUR : Python introuvable
    echo %PYTHON%
    goto :keep
)

if not exist "%STUDIO_DIR%\launcher.py" (
    echo ERREUR : launcher.py manquant
    echo Dossier : %STUDIO_DIR%
    goto :keep
)

cd /d "%STUDIO_DIR%"
"%PYTHON%" -c "import uvicorn,fastapi,websockets" 1>nul 2>nul
if errorlevel 1 (
    echo Installation des composants...
    "%PYTHON%" -m pip install -r "%STUDIO_DIR%\requirements.txt"
)

echo Lancement...
echo Correction huggingface-hub (conflit transformers)...
"%PYTHON%" -m pip install -q "huggingface-hub>=0.23.2,<1.0" "transformers>=4.45.0"
echo Liberation des ports 8191 et 8190...
powershell -NoProfile -Command "foreach($p in 8191,8190){$c=Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue; if($c){$c.OwningProcess|Sort-Object -Unique|ForEach-Object{Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue}}}"
timeout /t 2 /nobreak >nul
"%PYTHON%" "%STUDIO_DIR%\launcher.py"
echo.
echo LTX Studio s'est arrete. Laissez cette fenetre ouverte pour lire l'erreur.

:keep
echo.
echo Tapez exit pour fermer.
echo.
