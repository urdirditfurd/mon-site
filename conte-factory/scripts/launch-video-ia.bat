@echo off
REM Launcher "video ia" - Conte Factory tracker
cd /d "%~dp0.."

if not exist ".venv\Scripts\activate.bat" (
  echo Environment missing. Run:
  echo   powershell -ExecutionPolicy Bypass -File scripts\setup-windows-video-ia.ps1
  pause
  exit /b 1
)

call .venv\Scripts\activate.bat
set STREAMLIT_BROWSER_GATHER_USAGE_STATS=false
echo.
echo  === video ia - tracker ===
echo  Dashboard : http://127.0.0.1:8501
echo  Pinokio   : Wan Snapdragon ARM -^> Run must be ON
echo.
streamlit run dashboard.py --server.address 127.0.0.1 --server.port 8501
pause
