@echo off
REM Double-click this file after the repo is on disk.
REM Or run the one-liner from GUIDE.md if the project is not downloaded yet.

cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-windows-video-ia.ps1"
pause
