# YouTube — où est le script et comment brancher l'upload

## Fichier d'upload YouTube

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

(`private` d'abord, puis `public` quand tu es à l'aise)

---

## 2) Lancer l'automatisation (manuel)

### Tout-en-un (recommandé)
Double-clic sur l'icône Bureau **video ia** — Wan + dashboard démarrent automatiquement.

Ou :
```powershell
& "$env:USERPROFILE\mon-site\conte-factory\scripts\DEMARRER-VIDEO-IA.bat"
```

### Pipeline seul (Wan démarre tout seul)
```powershell
cd $env:USERPROFILE\mon-site\conte-factory
.\.venv\Scripts\activate

# Test court SANS YouTube
python main.py --short --theme "un lapin" --no-publish

# Automatisation complète AVEC YouTube à la fin
python main.py --theme "conte du soir"
```

Ou double-clic : `conte-factory\scripts\LANCER-AUTOMATISATION.bat`

---

## 3) Publier seulement une vidéo déjà prête

```powershell
cd $env:USERPROFILE\mon-site\conte-factory
.\.venv\Scripts\activate
python main.py --resume 1 --only publish --publish
```

(remplace `1` par l'id vu dans le dashboard)

Ou dans **http://127.0.0.1:8501** → historique → **Uploader YouTube**

---

## 4) Automatisation chaque nuit (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\mon-site\conte-factory\scripts\install-windows-autostart.ps1"
```

- **Au login** : Wan GPU + dashboard http://127.0.0.1:8501
- **Chaque nuit 02:00** : pipeline complet jusqu'à YouTube
- Logs : `data\scheduled.log` et `data\wan_server.log`

---

## Ordre mental

```
Wan auto (7860) via video ia ou planificateur
   → main.py (histoire + audio + clips Wan + montage)
      → modules/publish.py (upload YouTube)
         → dashboard 8501 (suivi)
```
