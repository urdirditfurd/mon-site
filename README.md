# ClipForge Studio (V2)

Application web inspirée d'un workflow de génération de clips courts:

- upload vidéo
- génération automatique de moments forts
- création de clips format social
- sous-titres auto à partir d'un transcript
- export MP4 avec audio conservé
- jobs asynchrones côté backend

## Démarrage

```bash
npm install
npm start
```

Puis ouvrir: `http://localhost:3000`

## API principale

- `GET /api/health` : santé backend
- `POST /api/jobs` : créer un job (multipart form-data, champ `video`)
- `GET /api/jobs/:jobId` : statut job + clips générés
- `GET /api/jobs/:jobId/clips/:clipId/stream` : lecture clip
- `GET /api/jobs/:jobId/clips/:clipId/download` : téléchargement clip
- `GET /api/jobs/:jobId/plan` : plan JSON

## Stack

- Frontend: HTML/CSS/JS
- Backend: Node.js + Express + Multer
- Traitement vidéo: FFmpeg/FFprobe

## Notes

- Le scoring des moments forts est heuristique (MVP technique).
- Les clips sont stockés localement dans `storage/jobs/`.
- Ce projet reproduit des fonctionnalités génériques d'outils de clipping, sans copie de code propriétaire.
