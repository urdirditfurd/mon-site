@echo off
REM Reparation Git + config I2V + relance projet 36
REM Double-clic ou:
REM   C:\ConteFactory\conte-factory\scripts\REPARER-ET-RELANCE-36.bat
setlocal EnableExtensions
cd /d C:\ConteFactory
if not exist "C:\ConteFactory" (
  echo ERREUR: C:\ConteFactory introuvable
  pause
  exit /b 1
)

echo === Reparation complete (PowerShell) ===
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0REPARER-ET-RELANCE-36.ps1"
set ERR=%ERRORLEVEL%
echo.
echo Termine. Code=%ERR%
pause
endlocal
exit /b %ERR%
