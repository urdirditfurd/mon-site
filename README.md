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
- **yt-dlp** (obligatoire pour les liens YouTube) : `pip install -U yt-dlp`
- Redis recommandé pour le mode BullMQ (optionnel)

## Mise à jour (local ou VPS)

### Sur ton PC (Windows PowerShell)

```powershell
cd C:\chemin\vers\mon-site
git pull origin main
npm install
npm start
```

Puis ouvre `http://localhost:3000`.

### Sur un VPS OVH (Linux)

```bash
cd ~/mon-site
chmod +x scripts/vps-update.sh
./scripts/vps-update.sh
```

Guide complet (2 sites sur le même VPS, Nginx, PM2, HTTPS) : [`docs/vps-ovh.md`](docs/vps-ovh.md)

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

### Auto-Pipeline V1 (opérationnel aujourd'hui)

Pour traiter plusieurs vidéos rapidement avec un preset prêt à publier:

1. Ouvre le bloc **Auto-Pipeline V1 (batch aujourd'hui)**.
2. Colle plusieurs liens (1 lien par ligne).
3. Choisis:
   - **Clips 2 min par source**
   - **Ignorer intro auto**
4. Clique **Lancer batch V1**.
5. Le preset applique automatiquement:
   - `clipDuration=120`
   - `languageMode=no-added-audio`
   - `burnSubtitles=false`
   - `includeSrtInZip=false`
   - ratio `9:16` + `frameMode=full-video`
6. Dans la liste batch:
   - **Ouvrir** charge le résultat dans la prévisualisation
   - **ZIP** télécharge le pack complet de cette source

### Version V2 — découverte auto YouTube

La V2 ajoute une découverte automatique de liens YouTube depuis l'app (sans collage manuel):

1. Ouvre le bloc **Version V2 — découverte auto YouTube**.
2. Saisis une niche (ex: `funny animals`) + langue/région + quantité.
3. Option V2.1:
   - **Exclure chaînes** (mots-clés blacklist)
   - **Anti-doublon historique** (évite les vidéos déjà traitées)
4. Clique **Trouver des vidéos (V2)**.
5. Clique **Injecter vers Batch V1** pour remplir automatiquement la zone batch.
5. Lance ensuite le traitement via **Lancer batch V1**.

API V2 utilisée:
- `GET /api/youtube/discover`
- Entrée: `q`, `maxResults`, `regionCode`, `relevanceLanguage`, `publishedWithinDays`, `order`, `excludeSeen`, `blockedChannelKeywords`
- Sortie: `candidates[]` triés avec score (vues, fraîcheur, durée, momentum, contenu short-friendly) + `stats` de filtrage

### Version V2.3 — planification auto-run (découverte → génération → publication)

La V2.3 ajoute un mode planifié:

1. Configure TikTok dans **Connexion TikTok (auto-publication)** (token + open_id).
2. Choisis l’intervalle (**Auto-run toutes les X minutes**).
3. (Optionnel) renseigne une **Base URL publique** si tu ne veux pas utiliser l’URL actuelle.
4. Clique **Activer / mettre à jour auto-run**.
5. Tu peux:
   - lancer un run immédiat avec **Lancer maintenant**
   - arrêter la planification avec **Désactiver auto-run**

Notes:
- Le scheduler réutilise la niche et les filtres V2 courants.
- Le nombre de clips est calculé automatiquement en 2 min par segment (`floor(durée/120)`).
- Les runs planifiés passent par la même logique que le bouton manuel “Trouver + générer + publier TikTok”.

### Version V2.2 — Auto-Publish TikTok (découverte -> génération -> publication)

La V2.2 ajoute un flux complet en un clic:

1. Renseigner la niche dans **Version V2 — découverte auto YouTube**.
2. Ouvrir **Auto-Publish TikTok (V2.2)**.
3. Coller `access_token` + `open_id`, choisir la confidentialité, et des hashtags par défaut.
4. Cliquer **Enregistrer config TikTok**.
5. Cliquer **Trouver + générer + publier TikTok**.

Le backend effectue automatiquement:
- découverte YouTube (avec filtres V2.1),
- génération de clips (durée par défaut 120s),
- nombre de clips calculé par source selon la durée de la vidéo,
- stockage des clips dans le job,
- publication TikTok via API `PULL_FROM_URL`,
- hashtags auto (`#funny`, `#fyp`, + tags pertinents animaux/cat/dog).

Notes importantes:
- La publication auto nécessite une app TikTok Developer avec scopes de publication valides.
- L'action "cliquer sur publier" n'est pas faite par navigateur/UI robot, mais par API officielle TikTok côté serveur.
- En cas de scope/audit non validé TikTok, la génération reste faite et les erreurs de publication sont renvoyées dans le statut.

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
   - **Plein cadre vidéo (sans flou)**: fond vidéo net sur toute la surface, sans déformation ni coupe du contenu principal.
   - **Fond flou (sans couper l'image)** si vous préférez le style social classique.
   - **Bandes noires** si vous préférez un cadre neutre.
6. Utiliser **Ignorer les X premières secondes** pour éviter explicitement les intros/génériques.
7. Cliquer **Générer mes shorts**.
8. Une fois terminé:
   - prévisualiser les clips
   - exporter MP4
   - exporter SRT
   - exporter JSON
   - exporter ZIP global

## Dépannage — « je n'arrive pas à me connecter »

### En local (sur ton PC)

1. Ouvre un terminal dans le dossier du projet.
2. Lance:

```bash
npm install
npm start
```

3. Ouvre **exactement** `http://localhost:3000` (pas un fichier HTML ouvert directement).
4. Le bandeau doit afficher **Backend prêt**. Si tu vois **Backend indisponible — lance: npm start**, le serveur Node n'est pas démarré.

### En production

- **Netlify seul ne fonctionne pas** pour ClipForge : le site affiche l'interface, mais toutes les routes `/api/*` échouent faute de serveur Node.
- Le README mentionnait `render.yaml` : ce fichier est maintenant inclus. Déploie via **Render Blueprint** (voir section ci-dessous).
- Vérifie que l'URL publique pointe bien vers le service Render actif (`/api/health` doit répondre `{"ok":true,...}`).

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
- `GET /api/tiktok/config/status`
- `POST /api/tiktok/config`
- `DELETE /api/tiktok/config`
- `POST /api/automation/discover-generate-publish`
- `GET /api/automation/schedule/status`
- `POST /api/automation/schedule`
- `POST /api/automation/schedule/run-now`
- `DELETE /api/automation/schedule`
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
- `frameMode` (`full-video` | `blur-fill` | `black-bars`)
- `transcript` (optionnel)
- `minGapSecBetweenClips`
- `ignoreIntroSec` (secondes à ignorer en début de vidéo)
- `subtitleTheme` (`classic` | `bold` | `cinema` | `neon`)
- `highlightMode` (`balanced` | `hook-first` | `viral`)
- `includeAutoTranscript` (`true`/`false`)
- `languageMode` (`translate-to-french` | `already-french` | `no-added-audio`)
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

## Sulphur Studio — Text-to-Video 100 % gratuit

Génération vidéo **sans aucune API payante** : modèles open-source Hugging Face + planificateur gratuit + FFmpeg.

| Composant | Solution | Coût |
|-----------|----------|------|
| Génération clips | Sulphur 2 / Wan 2.2 (GPU local) | **0€** |
| Planification scènes | **Mistral Free Tier** (VOANH / console.mistral.ai) | **0€** |
| Fallback scripts | Templates ou Ollama local | **0€** |
| Assemblage | FFmpeg serveur | **0€** |
| FAL cloud | Optionnel uniquement | payant |

### Planificateurs (défaut : Mistral Free Tier)

| Mode | Description |
|------|-------------|
| `mistral` | **Mistral Free Tier** via clé VOANH (`console.mistral.ai`, sans carte bancaire) |
| `free` | Templates cinématiques — aucune clé API |
| `ollama` | LLM local gratuit (`ollama run llama3.2`) |

Obtenir une clé Mistral gratuite (comme [VOANH AI](https://github.com/LaurentVoanh/Mistral-universal-Chat-Bot-free-tiers)) :

1. Créez un compte sur [console.mistral.ai](https://console.mistral.ai)
2. Menu **API Keys** → **Create new key**
3. Collez la clé dans VOANH via **⬡ API KEY** (stockée 365 jours en local)
4. Le studio vidéo la réutilise automatiquement pour planifier vos scènes

### Modèles vidéo supportés

| Clé | Modèle HF | Usage |
|-----|-----------|-------|
| `sulphur2` | SulphurAI/Sulphur-2-base | Qualité max (24GB VRAM) |
| `sulphur2-distilled` | Sulphur 2 Distilled | Rapide |
| `wan22` | Wan-AI/Wan2.2-TI2V-5B-Diffusers | Alternative officielle |
| `wan21lite` | Wan-AI/Wan2.1-T2V-1.3B-Diffusers | GPU 8GB |

### Sans GPU NVIDIA → Google Colab (recommandé)

Si vous n'avez pas de carte NVIDIA localement, utilisez le notebook Colab gratuit :

1. [colab.research.google.com](https://colab.research.google.com) → **GPU T4**
2. Ouvrir `colab/text-to-video-gratuit.ipynb` depuis ce repo
3. Configurer `TOPIC`, `DURATION_MIN`, `BATCH_COUNT` → **Tout exécuter**
4. Télécharger les MP4 générés

Guide détaillé : [`docs/colab-sans-gpu.md`](docs/colab-sans-gpu.md)

### Installation GPU (PC / VPS avec NVIDIA)

```bash
pip3 install -r requirements-video.txt
# ou
npm run setup:video

export HF_TOKEN=hf_xxx          # optionnel, accélère les téléchargements
export SULPHUR_MODEL_CACHE=./models
export SULPHUR_PLANNER=mistral            # Mistral Free Tier (défaut)
export SULPHUR_WORKER_CONCURRENCY=2   # jobs parallèles
npm start
```

### API production (0€)

| Endpoint | Description |
|----------|-------------|
| `GET /api/sulphur/health` | État GPU + modèles |
| `POST /api/sulphur/plan` | Planifier scènes gratuitement |
| `POST /api/sulphur/jobs` | Vidéo unique (sans clé API) |
| `POST /api/sulphur/jobs/auto` | Vidéo longue automatique |
| `POST /api/sulphur/batch` | Jusqu'à 500 vidéos par requête |
| `GET /api/sulphur/jobs/:id` | Suivi progression |
| `GET /api/sulphur/download/:id` | Télécharger MP4 |

Exemple batch quotidien avec **Mistral Free Tier** :

```bash
curl -X POST http://localhost:3000/api/sulphur/batch \
  -H "Content-Type: application/json" \
  -H "x-mistral-key: VOTRE_CLE_MISTRAL_GRATUITE" \
  -d '{
    "provider": "sulphur",
    "plannerMode": "mistral",
    "hfModel": "sulphur2",
    "clipSec": 5,
    "aspectRatio": "9:16",
    "mistralKey": "VOTRE_CLE_MISTRAL_GRATUITE",
    "items": [
      {"topic": "Les secrets de la productivité", "durationMin": 1},
      {"topic": "Histoire du football français", "durationMin": 2}
    ]
  }'
```

Sans clé Mistral, utilisez `"plannerMode": "free"` (templates, 0€).

Interface studio : `/studio` ou `video-factory.html` (script + durée + format, 0€ via Colab).

### Ollama (optionnel, toujours gratuit)

```bash
ollama pull llama3.2
export SULPHUR_PLANNER=ollama
```

## Commandes utiles

```bash
npm run check
npm start
npm run setup:video
npm run start:v4
npm run start:v4:workers4
```

## Stack

- Frontend: HTML/CSS/JS
- Backend: Node.js + Express + Multer
- Queue: BullMQ + Redis (optionnel, fallback mémoire)
- Vidéo: FFmpeg/FFprobe
- Packaging: Archiver
