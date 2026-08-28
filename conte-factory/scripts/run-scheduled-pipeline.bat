@echo off
REM Pipeline planifie - Wan + main.py (sans PowerShell)
cd /d "%~dp0.."

set LOG=data\scheduled.log
set VENV=.venv\Scripts\python.exe

if not exist "%VENV%" (
  echo %date% %time% ERREUR venv introuvable>>"%LOG%"
  exit /b 1
)

echo %date% %time% === Debut pipeline planifie ===>>"%LOG%"
"%VENV%" scripts\start_wan.py>>"%LOG%" 2>&1
if errorlevel 1 (
  echo %date% %time% ERREUR Wan indisponible>>"%LOG%"
  exit /b 1
)

echo %date% %time% Lancement main.py>>"%LOG%"
"%VENV%" main.py>>"%LOG%" 2>&1
echo %date% %time% === Fin pipeline code %ERRORLEVEL% ===>>"%LOG%"
exit /b %ERRORLEVEL%
