@echo off
REM Lance l'automatisation complete (Wan doit deja tourner sur 7860)
cd /d "%~dp0.."

if not exist ".venv\Scripts\python.exe" (
  echo Installez d'abord INSTALL-NVIDIA.ps1
  pause
  exit /b 1
)

echo.
echo === Automatisation Conte Factory ===
echo Wan doit etre ouvert: LANCER-WAN-NVIDIA.bat
echo.
".venv\Scripts\python.exe" main.py %*
echo.
echo Termine. Exports: data\exports
echo YouTube script: modules\publish.py
pause
