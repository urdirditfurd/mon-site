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

:: ── ngrok (URL fixe permanente — RECOMMANDÉ) ─────────────────
echo.
echo [2/4] Téléchargement de ngrok (URL fixe gratuite)...
if exist ngrok.exe (
    echo [OK] ngrok.exe déjà présent — skip.
) else (
    curl -L --progress-bar "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip" -o ngrok_tmp.zip
    if %errorlevel% neq 0 (
        echo [AVERT] Téléchargement ngrok échoué. Essai alternatif...
        powershell -Command "Invoke-WebRequest -Uri 'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip' -OutFile 'ngrok_tmp.zip'"
    )
    if exist ngrok_tmp.zip (
        powershell -Command "Expand-Archive -Path 'ngrok_tmp.zip' -DestinationPath '.' -Force"
        del ngrok_tmp.zip >nul 2>&1
        echo [OK] ngrok.exe téléchargé.
    ) else (
        echo [AVERT] Impossible de télécharger ngrok automatiquement.
        echo Téléchargez-le sur https://ngrok.com/download et placez ngrok.exe ici.
    )
)

:: ── Cloudflared (alternative si ngrok indisponible) ───────────
echo.
echo [3/4] Téléchargement de cloudflared (alternative)...
if exist cloudflared.exe (
    echo [OK] cloudflared.exe déjà présent — skip.
) else (
    curl -L --progress-bar "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -o cloudflared.exe 2>nul
    if exist cloudflared.exe (
        echo [OK] cloudflared.exe téléchargé.
    ) else (
        echo [AVERT] cloudflared non téléchargé ^(optionnel^).
    )
)

:: ── Config initiale ───────────────────────────────────────────
echo.
echo [4/4] Configuration...
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
echo ║          ✅  Installation terminée !             ║
echo ╚══════════════════════════════════════════════════╝
echo.
echo  ═══════════════════════════════════════════════════
echo  ÉTAPE SUIVANTE OBLIGATOIRE : configurer ngrok
echo  ═══════════════════════════════════════════════════
echo.
echo  1. Créez un compte GRATUIT sur https://ngrok.com
echo.
echo  2. Copiez votre authtoken ici :
echo     https://dashboard.ngrok.com/get-started/your-authtoken
echo.
echo  3. Allez dans "Domains" et créez votre domaine fixe
echo     (1 domaine gratuit par compte, ex: mon-nom.ngrok-free.app)
echo.
echo  4. Ouvrez config.json avec le Bloc-notes et remplissez :
echo       "ngrok_token":  "coller_votre_token_ici"
echo       "ngrok_domain": "votre-domaine.ngrok-free.app"
echo       "password":     "votre_mot_de_passe"
echo.
echo  5. Double-cliquez sur setup_autostart.bat
echo     → tout démarrera automatiquement au prochain boot
echo.
echo  6. Redémarrez la tour — c'est fini !
echo     Depuis ce moment, vous n'avez plus JAMAIS besoin
echo     de toucher à la tour.
echo.
pause
