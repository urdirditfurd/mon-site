@echo off
REM Installe torch dans le venv I2V (corrige ModuleNotFoundError: torch)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALL-I2V.ps1"
pause
