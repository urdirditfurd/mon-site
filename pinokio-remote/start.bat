@echo off
chcp 65001 >nul 2>&1
title Pinokio Remote — Serveur actif

echo.
echo ╔══════════════════════════════════════════════════╗
echo ║         Pinokio Remote — Démarrage               ║
echo ╚══════════════════════════════════════════════════╝
echo.
echo  Accès local  : http://localhost:8000
echo  Accès distant: URL Cloudflare ci-dessous (30s)
echo.
echo  ⚠  Ne fermez PAS cette fenêtre tant que vous voulez
echo     accéder à Pinokio depuis votre Surface Laptop.
echo.
echo  Appuyez sur Ctrl+C pour arrêter le serveur.
echo ──────────────────────────────────────────────────
echo.

:: Vérifier que Python est dispo
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERREUR] Python introuvable. Lancez d'abord install.bat.
    pause
    exit /b 1
)

:: Vérifier que les dépendances sont installées
python -c "import fastapi, uvicorn, httpx, websockets, jwt" >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERREUR] Dépendances manquantes. Lancez install.bat d'abord.
    pause
    exit /b 1
)

python server.py
echo.
echo  [Serveur arrêté]
pause
