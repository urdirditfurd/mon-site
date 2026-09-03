@echo off
title LTX Studio - NE PAS FERMER
cd /d "%~dp0"

if /I not "%~1"=="KEEPOPEN" (
    start "LTX Studio - NE PAS FERMER" cmd /k "%~f0" KEEPOPEN
    exit /b 0
)

set "STUDIO_DIR=%~dp0"
set "STUDIO_DIR=%STUDIO_DIR:~0,-1%"
set "PYTHON=C:\ComfyUI-ARM\ComfyUI-ARM-Windows\venv\Scripts\python.exe"

echo.
echo ========================================================
echo  LTX Studio v7
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
    goto :keep
)

cd /d "%STUDIO_DIR%"

echo Liberation ports 8191 / 8190...
powershell -NoProfile -Command "foreach($p in 8191,8190){$c=Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue; if($c){$c.OwningProcess|Sort-Object -Unique|ForEach-Object{Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue}}}"
timeout /t 2 /nobreak >nul

"%PYTHON%" -c "import uvicorn,fastapi,websockets" 1>nul 2>nul
if errorlevel 1 (
    echo Installation composants UI...
    "%PYTHON%" -m pip install -q -r "%STUDIO_DIR%\requirements.txt"
)

echo Lancement launcher.py ...
"%PYTHON%" "%STUDIO_DIR%\launcher.py"
echo.
echo LTX Studio s'est arrete.

:keep
echo.
echo Tapez exit pour fermer.
echo.
