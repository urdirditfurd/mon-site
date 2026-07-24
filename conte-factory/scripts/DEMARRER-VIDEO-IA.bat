@echo off
REM video ia - demarrage RAPIDE du dashboard (ne bloque plus sur Wan)
cd /d "%~dp0.."
set "ROOT=%CD%"
set "CF_ROOT=%CD%\.."

if /i "%~1"=="quiet" set VIDEOIA_QUIET=1

if not exist ".venv\Scripts\python.exe" (
  echo ERREUR: environnement Python manquant.
  echo Lance INSTALL-NVIDIA.ps1 avant de continuer.
  if not defined VIDEOIA_QUIET pause
  exit /b 1
)

set "PROVIDER=talking"
set "AUTO_WAN=0"
if exist ".env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
    if /i "%%A"=="CONTE_VIDEO_PROVIDER" set "PROVIDER=%%B"
    if /i "%%A"=="CONTE_AUTO_START_WAN" set "AUTO_WAN=%%B"
  )
)

echo.
echo ========================================
echo   video ia - demarrage rapide
echo ========================================
echo   Provider: %PROVIDER%
echo.

set "NEED_WAN=0"
if /i "%PROVIDER%"=="pinokio" set "NEED_WAN=1"
if /i "%PROVIDER%"=="wan" set "NEED_WAN=1"
if /i "%PROVIDER%"=="wan21" set "NEED_WAN=1"
if /i "%AUTO_WAN%"=="0" set "NEED_WAN=0"
if /i "%AUTO_WAN%"=="false" set "NEED_WAN=0"

if "%NEED_WAN%"=="1" (
  echo ==^> Wan en arriere-plan ^(non bloquant^)...
  start "video-ia-wan" /MIN "%ROOT%\.venv\Scripts\python.exe" "%ROOT%\scripts\start_wan.py"
) else (
  echo ==^> Wan ignore - ouverture immediate du dashboard
)

set "LIP_APP="
if exist "%CF_ROOT%\pinokio\talking-wav2lip\app\gradio_server.py" set "LIP_APP=%CF_ROOT%\pinokio\talking-wav2lip\app"
if exist "%ROOT%\..\pinokio\talking-wav2lip\app\gradio_server.py" set "LIP_APP=%ROOT%\..\pinokio\talking-wav2lip\app"

if /i "%PROVIDER%"=="talking" if defined LIP_APP (
  if exist "%LIP_APP%\env\Scripts\python.exe" (
    powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:7870/' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -ge 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
    if not errorlevel 1 (
      echo ==^> Lip-sync deja pret sur 7870
    ) else (
      echo ==^> Lip-sync en arriere-plan ^(7870^)...
      start "video-ia-lipsync" /MIN cmd /c "cd /d "%LIP_APP%" && set GRADIO_SERVER_PORT=7870 && env\Scripts\python.exe gradio_server.py"
    )
  )
)

echo.
echo ==^> Dashboard: http://127.0.0.1:8501
echo     Ouverture...
echo.

set STREAMLIT_BROWSER_GATHER_USAGE_STATS=false
".venv\Scripts\python.exe" -m streamlit run dashboard.py --server.address 127.0.0.1 --server.port 8501

if not defined VIDEOIA_QUIET pause
