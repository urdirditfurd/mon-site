@echo off
chcp 65001 >nul 2>&1
title Pinokio Remote — Installation

echo.
echo ╔══════════════════════════════════════════════════╗
echo ║         Pinokio Remote — Installation            ║
echo ╚══════════════════════════════════════════════════╝
echo.

:: ── Vérification Python ───────────────────────────────────────
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERREUR] Python n'est pas installé ou absent du PATH.
    echo Téléchargez Python 3.10+ sur https://www.python.org/downloads/
    echo Cochez "Add Python to PATH" lors de l'installation.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo [OK] %%v détecté

:: ── Dépendances Python ────────────────────────────────────────
echo.
echo [1/3] Installation des dépendances Python...
pip install -r requirements.txt --quiet
if %errorlevel% neq 0 (
    echo [ERREUR] Echec de pip install. Vérifiez votre connexion internet.
    pause
    exit /b 1
)
echo [OK] Dépendances installées.

:: ── Cloudflared ───────────────────────────────────────────────
echo.
echo [2/3] Téléchargement de cloudflared (tunnel Cloudflare)...
if exist cloudflared.exe (
    echo [OK] cloudflared.exe déjà présent — skip.
) else (
    curl -L --progress-bar "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -o cloudflared.exe
    if %errorlevel% neq 0 (
        echo.
        echo [ERREUR] Echec du téléchargement automatique.
        echo Téléchargez manuellement sur :
        echo   https://github.com/cloudflare/cloudflared/releases/latest
        echo Renommez le fichier en "cloudflared.exe" et placez-le dans ce dossier.
        pause
        exit /b 1
    )
    echo [OK] cloudflared.exe téléchargé.
)

:: ── Config initiale ───────────────────────────────────────────
echo.
echo [3/3] Configuration...
if not exist config.json (
    python -c ^
        "import json,secrets; ^
         cfg={'password':'pinokio2026','secret_key':secrets.token_hex(32),'tunnel_mode':'quick','tunnel_token':'','services':[{'name':'ComfyUI','port':8188,'path':'comfyui','description':'Images et Videos (Wan2.1, AnimateDiff...)','icon':'🎨'},{'name':'Wan 2.1','port':7862,'path':'wan2','description':'Text-to-Video Wan2.1','icon':'🎬'},{'name':'Stable Diffusion','port':7860,'path':'sd','description':'Automatic1111 / Forge WebUI','icon':'🖼️'},{'name':'LLM Chat','port':7861,'path':'llm','description':'Oobabooga Text Generation WebUI','icon':'💬'},{'name':'InvokeAI','port':9090,'path':'invoke','description':'InvokeAI','icon':'✨'},{'name':'Fooocus','port':7865,'path':'fooocus','description':'Fooocus Image Generation','icon':'🌸'},{'name':'Open WebUI','port':3000,'path':'openwebui','description':'Open WebUI LLM Interface','icon':'🤖'}]}; ^
         open('config.json','w',encoding='utf-8').write(json.dumps(cfg,indent=2,ensure_ascii=False))"
    echo [OK] config.json créé avec les paramètres par défaut.
) else (
    echo [OK] config.json existe déjà — conservé tel quel.
)

:: ── Résumé ────────────────────────────────────────────────────
echo.
echo ╔══════════════════════════════════════════════════╗
echo ║            ✅  Installation terminée !           ║
echo ╚══════════════════════════════════════════════════╝
echo.
echo  Prochaines étapes :
echo.
echo  1. Ouvrez config.json et changez le mot de passe
echo     (champ "password", actuellement "pinokio2026")
echo.
echo  2. Double-cliquez sur start.bat pour démarrer le serveur
echo.
echo  3. Une URL publique Cloudflare apparaîtra dans la console.
echo     Copiez-la et ouvrez-la depuis votre Surface Laptop.
echo.
pause
