@echo off
REM Restore pipeline Cursor + fix Wan /generate
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0RESTORE-CONTEFACTORY.ps1"
pause
