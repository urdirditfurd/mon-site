@echo off
REM Automatisation complete : demarre Wan automatiquement puis pipeline
cd /d "%~dp0.."

if not exist ".venv\Scripts\python.exe" (
  echo Installez d'abord INSTALL-NVIDIA.ps1
  pause
  exit /b 1
)

echo.
echo === Automatisation Conte Factory ===
echo Wan se lance tout seul (plus besoin de LANCER-WAN-NVIDIA.bat)
echo.
".venv\Scripts\python.exe" scripts\start_wan.py
if errorlevel 1 (
  echo Wan indisponible - voir data\wan_server.log
  pause
  exit /b 1
)
".venv\Scripts\python.exe" main.py %*
echo.
echo Termine. Exports: data\exports
pause
