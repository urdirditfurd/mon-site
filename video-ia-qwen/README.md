# Vidéo IA Qwen + Wan Pinokio (gratuit illimité)

## Lien

```text
http://localhost:3000/video-ia-qwen
```

## Réparer le clone Windows (ton erreur actuelle)

Ton dépôt était **hors branche** et sans fichiers → `package.json` introuvable.

Dans PowerShell :

```powershell
cd $HOME\mon-site
git fetch origin
git checkout -f main
git pull origin main
git checkout cursor/video-ia-qwen-workflow-37c6
git pull origin cursor/video-ia-qwen-workflow-37c6
npm install
npm start
```

Ou en une commande :

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-video-ia-qwen.ps1
```

Puis ouvre : http://localhost:3000/video-ia-qwen

## Wan local (Pinokio) — déjà branché

| Élément | Détail |
|---------|--------|
| UI | Moteur **Pinokio Wan local** (défaut) |
| Gradio | `http://127.0.0.1:7860` |
| API HTTP (repo) | `http://127.0.0.1:7867/api/t2v` |
| App Pinokio du repo | `pinokio/wan-snapdragon-arm/` |

### Lancer Wan

1. Installer [Pinokio](https://pinokio.co)
2. Ajouter l’app : dossier `mon-site\pinokio\wan-snapdragon-arm` (ou Discover → Wan2GP)
3. **Install** puis **Run**
4. Vérifier que le pastille UI affiche Pinokio ON
5. Générer depuis `/video-ia-qwen`

Sans Pinokio démarré, utilise temporairement **Démo FFmpeg** pour tester le chaînage.
