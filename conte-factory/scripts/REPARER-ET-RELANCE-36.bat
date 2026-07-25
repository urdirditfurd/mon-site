@echo off
REM Reparation Git + config I2V face-safe + relance projet 36
REM Double-clic ou: C:\ConteFactory\conte-factory\scripts\REPARER-ET-RELANCE-36.bat
setlocal EnableExtensions
cd /d C:\ConteFactory
if not exist "C:\ConteFactory" (
  echo ERREUR: C:\ConteFactory introuvable
  exit /b 1
)

echo === 1) Reparer Git ===
git fetch origin cursor/conte-factory-pipeline-0391
if errorlevel 1 goto CLEAN_FETCH
goto AFTER_FETCH

:CLEAN_FETCH
echo Fetch echoue - reset remote...
git remote remove origin 2>nul
git remote add origin https://github.com/urdirditfurd/mon-site.git
git fetch origin cursor/conte-factory-pipeline-0391 --depth=50
if errorlevel 1 (
  echo ERREUR fetch. Verifie internet / GitHub.
  pause
  exit /b 1
)

:AFTER_FETCH
git checkout -B cursor/conte-factory-pipeline-0391 FETCH_HEAD
if errorlevel 1 git reset --hard FETCH_HEAD
git clean -fd
echo Git OK.
echo.

echo === 2) Config I2V face-safe ===
call conte-factory\scripts\SWITCH-TO-I2V.bat
echo.

echo === 3) Supprimer ai_clips projet 36 ===
cd /d C:\ConteFactory\conte-factory
if not exist .venv\Scripts\python.exe (
  echo ERREUR: .venv manquant
  pause
  exit /b 1
)
.\.venv\Scripts\python.exe scripts\clear_ai_clips.py 36
if errorlevel 1 (
  if exist data\videos\video_0036\ai_clips rmdir /s /q data\videos\video_0036\ai_clips
)

echo.
echo === 4) Relance #36 ===
.\.venv\Scripts\python.exe main.py --resume 36 --only storyboard --no-publish
echo.
echo Termine. Code=%ERRORLEVEL%
pause
endlocal
