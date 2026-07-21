@echo off
REM video ia = dashboard 8501 branché sur Wan 7860
cd /d "%~dp0.."

if not exist ".venv\Scripts\activate.bat" (
  echo Environment missing. Run INSTALL-NVIDIA.ps1 first.
  pause
  exit /b 1
)

call .venv\Scripts\activate.bat
set STREAMLIT_BROWSER_GATHER_USAGE_STATS=false
echo.
echo  === video ia ===
echo  1) Wan NVIDIA must be running: LANCER-WAN-NVIDIA.bat
echo  2) Dashboard: http://127.0.0.1:8501
echo  3) Wan UI:    http://127.0.0.1:7860
echo.
streamlit run dashboard.py --server.address 127.0.0.1 --server.port 8501
pause
