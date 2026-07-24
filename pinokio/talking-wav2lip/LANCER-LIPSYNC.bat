@echo off
cd /d "%~dp0app"
if exist "env\Scripts\python.exe" (
  set PYTHON=env\Scripts\python.exe
) else (
  set PYTHON=python
)
set GRADIO_SERVER_PORT=7870
echo Demarrage lip-sync sur http://127.0.0.1:7870
"%PYTHON%" gradio_server.py
pause
