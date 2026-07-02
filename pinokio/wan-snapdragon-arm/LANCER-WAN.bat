@echo off
REM Lancement manuel Wan Snapdragon (si Pinokio Run ne demarre pas Gradio)
cd /d "%~dp0app"
if exist "env\Scripts\activate.bat" (
  call env\Scripts\activate.bat
) else if exist "..\env\Scripts\activate.bat" (
  call ..\env\Scripts\activate.bat
) else (
  echo Erreur: environnement Python introuvable. Relancez Install dans Pinokio.
  pause
  exit /b 1
)
set SULPHUR_SNAPDRAGON=1
set SULPHUR_ALLOW_CPU=1
set WAN_MODEL_CACHE=%~dp0models
set GRADIO_SERVER_PORT=7860
echo.
echo Demarrage Gradio sur http://127.0.0.1:7860
echo Branchez le secteur. Premiere generation = telechargement modele ~3-5 Go.
echo.
python gradio_server.py
pause
