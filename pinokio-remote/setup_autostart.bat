@echo off
chcp 65001 >nul 2>&1
title Pinokio Remote — Configuration démarrage automatique

echo.
echo ╔══════════════════════════════════════════════════════════╗
echo ║   Pinokio Remote — Démarrage automatique au boot        ║
echo ║   Ce script configure la tour pour tout démarrer        ║
echo ║   automatiquement sans aucune manipulation.             ║
echo ╚══════════════════════════════════════════════════════════╝
echo.

:: ── Vérifications ──────────────────────────────────────────────────
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERREUR] Lancez d'abord install.bat
    pause & exit /b 1
)

set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "SERVER_PY=%SCRIPT_DIR%\server.py"
set "TASK_NAME=PinokioRemote"
set "PINOKIO_TASK=PinokioApp"

echo  Dossier détecté : %SCRIPT_DIR%
echo.

:: ── 1. Désactiver la mise en veille ────────────────────────────────
echo [1/4] Désactivation de la mise en veille et hibernation...
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 0
powercfg /hibernate off
echo [OK] La tour ne se mettra plus jamais en veille.
echo.

:: ── 2. Créer la tâche planifiée Pinokio Remote ─────────────────────
echo [2/4] Création de la tâche planifiée "PinokioRemote"...

:: Supprimer l'ancienne tâche si elle existe
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1

:: Créer un script VBScript pour lancer sans fenêtre console
set "LAUNCHER=%SCRIPT_DIR%\launcher_hidden.vbs"
(
echo Set WshShell = CreateObject^("WScript.Shell"^)
echo WshShell.Run "cmd /c python """ ^& "%SERVER_PY%" ^& """ ^> """ ^& "%SCRIPT_DIR%\pinokio_remote.log" ^& """ 2^>^&1", 0, False
) > "%LAUNCHER%"

schtasks /create ^
    /tn "%TASK_NAME%" ^
    /tr "wscript.exe \"%LAUNCHER%\"" ^
    /sc ONLOGON ^
    /rl HIGHEST ^
    /f >nul

if %errorlevel% equ 0 (
    echo [OK] Tâche "%TASK_NAME%" créée — démarrera automatiquement à chaque connexion Windows.
) else (
    echo [AVERT] Création de la tâche échouée. Essayez en mode Administrateur.
)
echo.

:: ── 3. Pinokio au démarrage ─────────────────────────────────────────
echo [3/4] Configuration de Pinokio au démarrage automatique...

:: Chercher Pinokio.exe dans les emplacements courants
set "PINOKIO_EXE="
if exist "%LOCALAPPDATA%\Pinokio\Pinokio.exe" (
    set "PINOKIO_EXE=%LOCALAPPDATA%\Pinokio\Pinokio.exe"
)
if exist "%APPDATA%\Pinokio\Pinokio.exe" (
    set "PINOKIO_EXE=%APPDATA%\Pinokio\Pinokio.exe"
)
if exist "C:\Program Files\Pinokio\Pinokio.exe" (
    set "PINOKIO_EXE=C:\Program Files\Pinokio\Pinokio.exe"
)

if defined PINOKIO_EXE (
    schtasks /delete /tn "%PINOKIO_TASK%" /f >nul 2>&1
    schtasks /create ^
        /tn "%PINOKIO_TASK%" ^
        /tr "\"%PINOKIO_EXE%\"" ^
        /sc ONLOGON ^
        /delay 0001:00 ^
        /rl HIGHEST ^
        /f >nul
    echo [OK] Pinokio démarrera automatiquement 1 minute après le boot.
    echo      Chemin détecté : %PINOKIO_EXE%
) else (
    echo [AVERT] Pinokio.exe non trouvé automatiquement.
    echo         Ajoutez Pinokio manuellement au démarrage :
    echo         Win+R → shell:startup → glissez le raccourci Pinokio
)
echo.

:: ── 4. Connexion Windows automatique (optionnel) ────────────────────
echo [4/4] Connexion automatique Windows (optionnel)...
echo.
echo  Pour que la tour redémarre SANS avoir besoin de saisir
echo  un mot de passe (nécessaire après une coupure de courant),
echo  configurez la connexion automatique :
echo.
echo  → Appuyez sur Win+R et tapez :  netplwiz
echo  → Décochez "Les utilisateurs doivent entrer un mot de passe"
echo  → Entrez votre mot de passe Windows quand demandé
echo  → Cliquez OK
echo.

:: ── Résumé ─────────────────────────────────────────────────────────
echo ╔══════════════════════════════════════════════════════════╗
echo ║           ✅  Configuration terminée !                   ║
echo ╚══════════════════════════════════════════════════════════╝
echo.
echo  Ce qui démarrera automatiquement à chaque boot :
echo.
echo  1. Windows se connecte automatiquement (si netplwiz configuré)
echo  2. Pinokio s'ouvre (après 1 minute)
echo  3. Pinokio Remote démarre en arrière-plan
echo  4. Le tunnel ngrok s'établit → URL fixe disponible
echo.
echo  Vous pouvez maintenant utiliser la tour depuis votre
echo  Surface Laptop SANS JAMAIS toucher à la tour.
echo.
echo  Logs du serveur : %SCRIPT_DIR%\pinokio_remote.log
echo.
pause
