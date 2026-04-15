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

Le mode express applique des réglages short-form recommandés **sans écraser la durée choisie**:
- ratio **9:16** (TikTok/Reels)
- transcription auto activée
- doublage audio FR activé (si mode langue = "vidéo à traduire")

### Mode avancé

1. Fournir une source vidéo:
   - soit via **URL** (YouTube ou lien direct MP4/MOV/WebM)
   - soit via **upload fichier** local
2. Régler durée, nombre de clips, ratio.
3. Choisir le **mode langue**:
   - **Vidéo à traduire en français**: active le doublage FR selon vos options.
   - **Vidéo déjà en français**: coupe automatiquement les options de doublage (pas de traduction audio).
   - **Vidéo sans ajout d'audio**: ne génère aucun doublage, conserve l'audio original.
4. Régler durée, nombre de clips et options V4 (mode highlights, thème captions, auto transcript, burn subtitles, gap).
5. Choisir la mise en page:
   - **Fond flou (sans couper l'image)** pour éviter les bandes noires.
   - **Bandes noires** si vous préférez un cadre neutre.
6. Utiliser **Ignorer les X premières secondes** pour éviter explicitement les intros/génériques.
7. Cliquer **Générer mes shorts**.
8. Une fois terminé:
   - prévisualiser les clips
   - exporter MP4
   - exporter SRT
   - exporter JSON
   - exporter ZIP global

## Déploiement via GitHub + Render (lien stable)

Les liens tunnels (`trycloudflare`, `loca.lt`) expirent.  
Pour un lien fixe, déploie le repo sur Render avec la config fournie.

### 1) Prérequis

- Repo GitHub à jour (ce repo)
- Compte Render connecté à GitHub
- Plan **Free** possible (sans paiement, mais mise en veille après inactivité)
- Plan **Starter** recommandé si tu veux éviter la veille

### 2) Déploiement

1. Ouvre Render > **New +** > **Blueprint**.
2. Sélectionne ton repo GitHub `urdirditfurd/mon-site`.
3. Render détecte automatiquement `render.yaml`.
4. Lance le déploiement.

Render crée:
- un service web Docker (`clipforge-studio`)
- un healthcheck sur `/api/health`

### 3) Résultat

- Tu obtiens une URL stable de type `https://clipforge-studio.onrender.com`
- Le service redéploie automatiquement à chaque push GitHub
- En plan Free, le service peut se mettre en veille (réveil automatique au prochain accès)

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
- `clipDuration` (sec, jusqu’à 600)
- `clipsCount`
- `aspectRatio` (`9:16` | `1:1` | `16:9`)
- `frameMode` (`blur-fill` | `black-bars`)
- `transcript` (optionnel)
- `minGapSecBetweenClips`
- `ignoreIntroSec` (secondes à ignorer en début de vidéo)
- `subtitleTheme` (`classic` | `bold` | `cinema` | `neon`)
- `highlightMode` (`balanced` | `hook-first` | `viral`)
- `includeAutoTranscript` (`true`/`false`)
- `languageMode` (`translate-to-french` | `already-french`)
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
