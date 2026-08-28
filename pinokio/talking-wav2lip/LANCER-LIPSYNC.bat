@echo off
setlocal
cd /d "%~dp0app"

set "PORT=7870"
set "URL=http://127.0.0.1:%PORT%"

REM Deja en cours ? (lancement via video ia ou instance precedente)
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri '%URL%/' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -ge 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
  echo.
  echo ========================================
  echo   Lip-sync DEJA pret sur %URL%
  echo ========================================
  echo.
  echo Rien a faire — laisse cette fenetre OU ferme-la.
  echo Tu peux generer ta video dans video ia.
  echo.
  pause
  exit /b 0
)

REM Port occupe mais pas de reponse HTTP → liberer
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1 }" >nul 2>&1

if exist "env\Scripts\python.exe" (
  set "PYTHON=env\Scripts\python.exe"
) else if exist "C:\ConteFactory\conte-factory\.venv\Scripts\python.exe" (
  set "PYTHON=C:\ConteFactory\conte-factory\.venv\Scripts\python.exe"
) else (
  set "PYTHON=python"
)

"%PYTHON%" -c "import gradio" 1>nul 2>nul
if errorlevel 1 (
  echo [ERREUR] gradio manquant dans ce Python.
  echo Relance: powershell -ExecutionPolicy Bypass -File "%~dp0INSTALL-LIPSYNC.ps1"
  pause
  exit /b 1
)

set GRADIO_SERVER_PORT=%PORT%
echo.
echo Demarrage lip-sync sur %URL%
echo Python: %PYTHON%
echo Laisse cette fenetre ouverte pendant la generation.
echo.
"%PYTHON%" gradio_server.py
if errorlevel 1 (
  echo.
  echo Echec demarrage. Si le port est encore pris:
  echo   netstat -ano ^| findstr :%PORT%
  echo puis: taskkill /PID ^<pid^> /F
  echo.
  pause
)
