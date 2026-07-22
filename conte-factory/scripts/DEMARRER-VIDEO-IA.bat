@echo off
REM video ia — demarre Wan + dashboard en un seul clic (plus de LANCER-WAN-NVIDIA.bat manuel)
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0DEMARRER-VIDEO-IA.ps1"
pause
