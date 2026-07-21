@echo off
REM Double-clique ce fichier OU copie les commandes ci-dessous dans PowerShell.
REM Ce script telecharge le projet et cree l'icone « video ia » sur le Bureau.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Invoke-RestMethod -Uri 'https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/conte-factory-pipeline-0391/conte-factory/scripts/setup-windows-video-ia.ps1' | Invoke-Expression"

if errorlevel 1 (
  echo.
  echo Si ca echoue : installe Git depuis https://git-scm.com/download/win
  echo puis FERME et rouvre PowerShell, et relance.
  pause
)
pause
