@echo off
REM video ia - demarre Wan + dashboard (sans PowerShell, compatible I&B)
cd /d "%~dp0.."

if /i "%~1"=="quiet" set VIDEOIA_QUIET=1

if not exist ".venv\Scripts\python.exe" (
  echo ERREUR: environnement Python manquant.
  echo Lance INSTALL-NVIDIA.ps1 avant de continuer.
  if not defined VIDEOIA_QUIET pause
  exit /b 1
)

echo.
echo ========================================
echo   video ia - demarrage tout-en-un
echo ========================================
echo.

echo ==^> Demarrage Wan GPU NVIDIA...
".venv\Scripts\python.exe" scripts\start_wan.py
if errorlevel 1 (
  echo ERREUR: Wan ne s est pas demarre. Voir data\wan_server.log
  echo Tu peux quand meme ouvrir le dashboard pour reessayer.
)

echo.
echo ==^> Dashboard video ia : http://127.0.0.1:8501
echo     Wan integre     : http://127.0.0.1:7860
echo.

set STREAMLIT_BROWSER_GATHER_USAGE_STATS=false
".venv\Scripts\python.exe" -m streamlit run dashboard.py --server.address 127.0.0.1 --server.port 8501

if not defined VIDEOIA_QUIET pause
