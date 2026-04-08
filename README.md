# ClipForge Studio (V3)

Application fullstack de génération de clips courts “social-ready”, inspirée d'un workflow type Klap (sans copie de code propriétaire).

## Fonctionnalités V3

- Upload vidéo (backend)
- Jobs asynchrones avec progression
- Découpage automatique des highlights (scoring enrichi)
- Transcription auto optionnelle si aucun transcript n'est fourni (fallback heuristique local)
- Génération de clips MP4 (audio conservé)
- Sous-titres segmentés:
  - overlay en preview frontend
  - export `.srt` par clip
- Exports:
  - téléchargement d'un clip
  - téléchargement du plan JSON
  - téléchargement d'un package ZIP global (clips + SRT + plan)
- Persistance de l'état jobs (`storage/jobs/jobs-db.json`) pour retrouver les jobs après redémarrage

## Démarrage

Pré-requis:
- Node.js 18+
- FFmpeg + FFprobe disponibles dans le PATH

Installation et lancement:

```bash
npm install
npm start
```

Ouvrir ensuite:
- **App**: `http://localhost:3000`

## Utilisation rapide

1. Charger une vidéo dans l'interface.
2. Choisir durée, nombre de clips, ratio, style sous-titres.
3. (Optionnel) Coller un transcript.
4. Cliquer **Analyser & générer (V3)**.
5. Une fois le job terminé:
   - sélectionner un clip et le lire
   - télécharger le clip MP4
   - télécharger le `.srt`
   - télécharger le plan JSON
   - télécharger le ZIP complet

## API principale

- `GET /api/health` : statut service
- `GET /api/config` : configuration runtime exposée
- `POST /api/jobs` : créer un job (multipart form-data, champ `video`)
- `GET /api/jobs` : lister les jobs récents
- `GET /api/jobs/:jobId` : statut job + métadonnées clips
- `GET /api/jobs/:jobId/plan` : plan JSON
- `GET /api/jobs/:jobId/download-all` : ZIP global
- `GET /api/jobs/:jobId/clips/:clipId/stream` : stream clip
- `GET /api/jobs/:jobId/clips/:clipId/download` : download clip
- `GET /api/jobs/:jobId/clips/:clipId/srt` : sous-titres SRT d'un clip

## Paramètres `POST /api/jobs`

Form-data:
- `video` (fichier, requis)
- `clipDuration` (sec)
- `clipsCount`
- `aspectRatio` (`9:16` | `1:1` | `16:9`)
- `transcript` (optionnel)
- `minGapSecBetweenClips`
- `subtitleStyle` (`classic` | `karaoke` | `minimal`)
- `highlightSensitivity` (0.5 à 1.5)
- `autoTranscript` (`true`/`false`)

## Stack

- Frontend: HTML/CSS/JS
- Backend: Node.js + Express + Multer
- Traitement vidéo: FFmpeg/FFprobe
- Packaging: Archiver (ZIP)

## Stockage local

- Uploads: `storage/uploads/`
- Jobs: `storage/jobs/<job-id>/`
- Base jobs: `storage/jobs/jobs-db.json`

## Notes

- La transcription auto intégrée est un fallback local (sans service cloud).
- Pour une qualité ASR production, brancher un moteur dédié (ex: Whisper local/server).
