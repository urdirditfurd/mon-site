@echo off
REM Lanceur « video ia » — suivi du pipeline Conte Factory + Pinokio Wan
cd /d "%~dp0.."

if not exist ".venv\Scripts\activate.bat" (
  echo Environnement manquant. Lancez d'abord scripts\install.sh ou :
  echo   python -m venv .venv ^&^& .venv\Scripts\activate ^&^& pip install -r requirements.txt
  pause
  exit /b 1
)

call .venv\Scripts\activate.bat
set STREAMLIT_BROWSER_GATHER_USAGE_STATS=false
echo.
echo  === video ia — tableau de suivi ===
echo  Dashboard : http://127.0.0.1:8501
echo  Wan Pinokio : verifier que Pinokio ^> Wan Snapdragon ARM ^> Run est allume
echo.
streamlit run dashboard.py --server.address 127.0.0.1 --server.port 8501
pause
