@echo off
REM Verification avant pipeline — doit afficher VERIFICATION OK
cd /d "%~dp0\.."
.\.venv\Scripts\python.exe scripts\verify_pipeline.py
if errorlevel 1 exit /b 1
echo.
echo Lancez: .\.venv\Scripts\python.exe main.py --resume 1 --no-publish
exit /b 0
