@echo off
setlocal
cd /d "%~dp0app"

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

set GRADIO_SERVER_PORT=7870
echo Demarrage lip-sync sur http://127.0.0.1:7870
echo Python: %PYTHON%
"%PYTHON%" gradio_server.py
if errorlevel 1 (
  echo Echec demarrage. Voir erreurs ci-dessus.
  pause
)
