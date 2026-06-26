# Fiction Studio — Script → images → montage MP4

Pipeline **plan par plan** pour courts/longs métrages IA, sans text-to-video lourd.

## Flux

1. **Script** → découpage en plans (Mistral gratuit ou templates)
2. **Images** → 1 image par plan via Hugging Face (FLUX Schnell + fallback SDXL)
3. **Montage** → Ken Burns, concat FFmpeg
4. **Post** → sous-titres (narration), musique libre de droit, export MP4 + SRT

## Coût réaliste

| Composant | Coût |
|-----------|------|
| Planification Mistral | Gratuit (Free Tier) |
| Images HF (FLUX Schnell) | Crédits mensuels gratuits (~0,10 $/mois compte free) |
| Montage local | 0 € (FFmpeg sur votre PC) |

Ce n'est **pas illimité**, mais bien plus abordable que le text-to-video.

## Clés API — une seule fois (recommandé)

### Option A — fichier `.env` sur votre PC (usage perso)

1. Copiez `.env.example` en `.env` à la racine du projet
2. Collez vos clés :

```env
HF_TOKEN=hf_votre_token
MISTRAL_API_KEY=votre_cle_mistral
```

3. Relancez `npm start` — **plus besoin de les retaper** dans le navigateur

Le fichier `.env` reste sur votre machine et **n'est jamais publié** sur GitHub.

### Option B — saisie dans le navigateur

Les clés sont mémorisées dans `localStorage` (une fois suffit par navigateur).

### Ne jamais faire

- Mettre les clés dans `index.html`, `app.js` ou `video-factory.js` → visibles par tous
- Committer `.env` sur GitHub → vol de clés

### Produit vendable

Chaque client utilise **ses propres** clés gratuites HF + Mistral, ou vous hébergez un serveur avec **votre** `.env` (vous payez les usages).

## Token Hugging Face

1. Créez un compte sur [huggingface.co](https://huggingface.co)
2. [Settings → Access Tokens](https://huggingface.co/settings/tokens) → **Read**
3. Collez le token dans Video Factory ou ClipForge

Variable serveur optionnelle : `HF_TOKEN` ou `HUGGINGFACE_HUB_TOKEN`

## FPS et durée par plan

- **24 fps** par défaut (cinéma)
- **1 image = 1 plan** de 4–10 secondes animé en Ken Burns
- Pas besoin de 24 images/seconde : FFmpeg anime chaque image fixe

Exemple : vidéo 1 min, plans de 5 s → **12 images** à générer.

## API

```http
POST /api/fiction/jobs
Content-Type: application/json
x-hf-token: hf_...
x-mistral-key: ... (optionnel)

{
  "script": "...",
  "durationMin": 1,
  "clipSec": 5,
  "aspectRatio": "9:16",
  "visualStyle": "cinematic",
  "burnSubtitles": true,
  "backgroundMusic": true
}
```

```http
GET /api/fiction/jobs/:id
GET /api/fiction/download/:id
GET /api/fiction/download/:id/subtitles
GET /api/fiction/health
```

## Import manuel (sans HF)

```json
{
  "imageProvider": "manual",
  "manualImages": ["data:image/png;base64,...", "..."],
  "script": "...",
  "durationMin": 1,
  "clipSec": 5
}
```

## Styles visuels

`cinematic`, `anime`, `illustration`, `documentary`, `noir`, `fantasy`

## Interfaces

- **Video Factory** : `/studio` — mode **Fiction Studio** (par défaut)
- **ClipForge** : mode « Fiction Studio » dans le sélecteur

## Local open source (avancé)

Pour aller plus loin sans API : FLUX / SD en local via Diffusers (GPU ou Colab). Le repo officiel FLUX Schnell est Apache-2.0 sur GitHub `black-forest-labs/FLUX.1-schnell`.
