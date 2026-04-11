# ClipForge Studio (V4)

Application fullstack de génération de clips courts “social-ready”, inspirée d’un workflow type Klap (sans copie de code propriétaire).

## Nouveautés V4

- Pipeline FFmpeg complet (clips MP4 avec audio conservé)
- File de jobs asynchrones avec **BullMQ + Redis** (mode pro)
- Fallback queue mémoire si Redis indisponible (mode local robuste)
- Concurrence workers configurable (`WORKER_CONCURRENCY`)
- Persistance des jobs (`storage/jobs-db.json`)
- Détection highlights multi-modes:
  - `balanced`
  - `hook-first`
  - `viral`
- Transcription auto optionnelle:
  - tente Whisper CLI réel si disponible
  - aucun faux transcript injecté si Whisper absent/erreur
- Sous-titres:
  - overlay preview frontend
  - export `.srt` par clip
  - burn-in optionnel dans MP4 (sans doublon overlay en preview)
- Doublage FR:
  - remplace l'audio original
  - voix auto homme/femme selon la voix détectée
- Sélection highlights améliorée:
  - anti-duplication des clips
  - scoring plus orienté "hook/viral" sur le contenu sous-titré
  - extraction des sous-titres YouTube (quand disponibles) pour un meilleur alignement temporel
- Doublage audio FR optionnel:
  - synthèse vocale française (edge-tts)
  - remplace l'audio original dans les exports
- Exports:
  - clip individuel MP4
  - plan JSON
  - bundle ZIP (clips + SRT + plan)

## Pré-requis

- Node.js 18+
- FFmpeg + FFprobe dans le PATH
- Redis recommandé pour le mode BullMQ (optionnel)

## Démarrage

### Mode local simple (fallback mémoire)

```bash
npm install
npm start
```

### Mode V4 pro (BullMQ + Redis)

1) Démarrer Redis (exemple Docker):

```bash
docker run --rm -p 6379:6379 redis:7
```

2) Lancer l’app en mode BullMQ:

```bash
REDIS_URL=redis://127.0.0.1:6379 QUEUE_MODE=bullmq npm start
```

3) Option workers parallèles:

```bash
REDIS_URL=redis://127.0.0.1:6379 QUEUE_MODE=bullmq WORKER_CONCURRENCY=4 npm run start:v4:workers4
```

Ouvrir ensuite:
- **App**: `http://localhost:3000`

## Utilisation

### Mode express (recommandé)

1. Coller le lien YouTube.
2. Cliquer **Générer mes shorts**.
3. Récupérer les clips générés.

Le mode express force automatiquement des réglages adaptés short-form:
- ratio **9:16** (TikTok/Reels)
- transcription auto activée
- doublage audio FR activé

### Mode avancé

1. Fournir une source vidéo:
   - soit via **URL** (YouTube ou lien direct MP4/MOV/WebM)
   - soit via **upload fichier** local
2. Régler durée, nombre de clips, ratio.
3. Régler options V4 (mode highlights, thème captions, auto transcript, dubbing FR, burn subtitles, gap).
4. Cliquer **Générer mes shorts**.
5. Une fois terminé:
   - prévisualiser les clips
   - exporter MP4
   - exporter SRT
   - exporter JSON
   - exporter ZIP global

## API

- `GET /api/health`
- `GET /api/config`
- `GET /api/youtube-cookies/status`
- `POST /api/youtube-cookies` (JSON: `{ "youtubeCookies": "..." }`)
- `DELETE /api/youtube-cookies`
- `POST /api/jobs` (multipart/form-data avec `video` **ou** JSON avec `videoUrl`)
- `GET /api/jobs/:jobId`
- `GET /api/jobs/:jobId/plan`
- `GET /api/jobs/:jobId/bundle`
- `GET /api/jobs/:jobId/clips/:clipId/stream`
- `GET /api/jobs/:jobId/clips/:clipId/download`
- `GET /api/jobs/:jobId/clips/:clipId/srt`

## Paramètres `POST /api/jobs`

- `video` (fichier) **ou**
- `videoUrl` (URL HTTP/HTTPS, YouTube supporté via `yt-dlp`)
- `clipDuration` (sec, jusqu’à 300)
- `clipsCount`
- `aspectRatio` (`9:16` | `1:1` | `16:9`)
- `transcript` (optionnel)
- `minGapSecBetweenClips`
- `subtitleTheme` (`classic` | `bold` | `cinema` | `neon`)
- `highlightMode` (`balanced` | `hook-first` | `viral`)
- `includeAutoTranscript` (`true`/`false`)
- `includeSrtInZip` (`true`/`false`)
- `burnSubtitles` (`true`/`false`)
- `dubFrenchAudio` (`true`/`false`) — remplace la piste audio par une voix FR synthétique

### Cookies YouTube persistants (recommandé)

Pour éviter de recoller les cookies à chaque génération:

1. Colle tes cookies YouTube dans l’interface.
2. Clique **Enregistrer les cookies**.
3. L’app les stocke côté serveur (`storage/secrets/youtube-cookies.txt`) et les réutilise automatiquement pour les liens YouTube.
4. Tu peux les supprimer avec **Supprimer cookies serveur**.

Le champ `youtubeCookies` dans `POST /api/jobs` reste supporté:
- si fourni, il est normalisé puis utilisé pour ce job
- il met aussi à jour le store persistant serveur
- si non fourni, le backend tente automatiquement le store persistant

### Exemple JSON (source URL)

```json
{
  "videoUrl": "https://www.youtube.com/watch?v=VIDEO_ID",
  "clipDuration": 30,
  "clipsCount": 4,
  "aspectRatio": "9:16",
  "highlightMode": "balanced",
  "subtitleTheme": "classic",
  "includeAutoTranscript": true
}
```

## Commandes utiles

```bash
npm run check
npm start
npm run start:v4
npm run start:v4:workers4
```

## Stack

- Frontend: HTML/CSS/JS
- Backend: Node.js + Express + Multer
- Queue: BullMQ + Redis (optionnel, fallback mémoire)
- Vidéo: FFmpeg/FFprobe
- Packaging: Archiver
