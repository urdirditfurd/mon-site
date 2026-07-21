# YouTube — où est le script et comment brancher l’upload

## Fichier d’upload YouTube

```
C:\Users\I&B\mon-site\conte-factory\modules\publish.py
```

Fonctions utiles :
- `prepare_publish_package(id)` — prépare titre / description / tags
- `publish_youtube(id, force=True)` — envoie la vidéo sur YouTube

Le script principal qui enchaîne tout (y compris YouTube à la fin) :

```
C:\Users\I&B\mon-site\conte-factory\main.py
```

---

## 1) Préparer YouTube (une seule fois)

1. Va sur [Google Cloud Console](https://console.cloud.google.com/)
2. Crée un projet → active **YouTube Data API v3**
3. Identifiants → **Application de bureau** OAuth → télécharge le JSON
4. Renomme-le en `client_secrets.json`
5. Place-le ici :
   ```
   C:\Users\I&B\mon-site\conte-factory\secrets\client_secrets.json
   ```
6. Installe les libs :

```powershell
cd $env:USERPROFILE\mon-site\conte-factory
.\.venv\Scripts\pip.exe install google-api-python-client google-auth-oauthlib google-auth-httplib2
```

7. Dans `.env` :

```env
CONTE_AUTO_PUBLISH=1
CONTE_YOUTUBE_PRIVACY=private
```

(`private` d’abord, puis `public` quand tu es à l’aise)

---

## 2) Lancer l’automatisation (manuel)

### Fenêtre 1 — Wan (obligatoire)
```powershell
& "$env:USERPROFILE\mon-site\pinokio\wan-snapdragon-arm\LANCER-WAN-NVIDIA.bat"
```

### Fenêtre 2 — Pipeline
```powershell
cd $env:USERPROFILE\mon-site\conte-factory
.\.venv\Scripts\activate

# Test court SANS YouTube
python main.py --short --theme "un lapin" --no-publish

# Automatisation complète AVEC YouTube à la fin
python main.py --theme "conte du soir"
```

Ou double-clic :
`conte-factory\scripts\LANCER-AUTOMATISATION.bat`

---

## 3) Publier seulement une vidéo déjà prête

```powershell
cd $env:USERPROFILE\mon-site\conte-factory
.\.venv\Scripts\activate
python main.py --resume 1 --only publish --publish
```

(remplace `1` par l’id vu dans le dashboard)

Ou dans **http://127.0.0.1:8501** → historique → **Uploader YouTube**

---

## 4) Automatisation chaque nuit (Windows)

1. Ouvre **Planificateur de tâches**
2. Créer une tâche de base → tous les jours **02:00**
3. Action :
   - Programme :  
     `C:\Users\I&B\mon-site\conte-factory\.venv\Scripts\python.exe`
   - Arguments : `main.py`
   - Démarrer dans :  
     `C:\Users\I&B\mon-site\conte-factory`
4. Crée une 2ᵉ tâche à **01:50** pour Wan :
   - Programme :  
     `C:\Users\I&B\mon-site\pinokio\wan-snapdragon-arm\LANCER-WAN-NVIDIA.bat`

---

## Ordre mental

```
Wan allumé (7860)
   → main.py (histoire + audio + clips Wan + montage)
      → modules/publish.py (upload YouTube)
         → dashboard 8501 (suivi)
```
