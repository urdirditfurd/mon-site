@echo off
REM Repare gradio et deps Wan en 2 minutes
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0REPAIR-WAN-DEPS.ps1"
pause
