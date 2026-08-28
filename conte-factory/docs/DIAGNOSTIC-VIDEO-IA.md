# Video IA — Diagnostic & Onboarding Développeur

> **Dernière mise à jour :** juillet 2026  
> **Branche active :** `cursor/pipeline-quality-fixes-0391`  
> **Repo GitHub :** `urdirditfurd/mon-site`  
> **Chemin Windows :** `C:\ConteFactory\conte-factory`

---

## 1. Objectif du projet

**Video IA** (nom interne : *Conte Factory*) est une application SaaS de **génération automatique de vidéos de contes pour enfants** en français.

L'utilisateur saisit un **thème** (ex. « un dragon violet qui chante dans les nuages »), choisit un **style visuel**, une **durée** et un **public cible**. Le pipeline produit ensuite :

1. Une **histoire structurée** en scènes
2. Des **dialogues audio** (voix Edge-TTS, multi-personnages)
3. Des **clips vidéo animés** (I2V local via GPU NVIDIA)
4. Un **montage final** MP4 (FFmpeg, musique, sous-titres optionnels)
5. Une **publication YouTube** optionnelle

**Cible matérielle :** PC Windows avec GPU NVIDIA (RTX 3080 10 Go documenté).  
**Interface :** Streamlit (`dashboard.py` → http://127.0.0.1:8501)

---

## 2. Architecture globale

```
┌─────────────────────────────────────────────────────────────────┐
│  UI Streamlit (conte-factory/.venv — PAS de torch)              │
│  dashboard.py · pages/1_Tableau_de_bord · pages/2_Creation      │
│  job_runner.py → lance main.py en sous-processus                │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  Pipeline Python (main.py)                                      │
│  sourcing → storyboard → audio → video_ai → montage → publish   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ Edge-TTS      │  │ Pinokio I2V   │  │ FFmpeg        │
│ (voix)        │  │ port 7861     │  │ (montage)     │
│ pas de clé    │  │ torch+CUDA    │  │ sur PATH      │
└───────────────┘  └───────────────┘  └───────────────┘
```

### Deux environnements Python (point critique)

| Environnement | Chemin | Contenu | Rôle |
|---------------|--------|---------|------|
| **App** | `conte-factory\.venv\` | streamlit, edge-tts, requests… | UI + orchestration |
| **Moteurs IA** | `pinokio\wan-i2v\app\env\` | torch, diffusers, CUDA | Génération vidéo GPU |

**Ne jamais installer torch dans `conte-factory\.venv`.**

---

## 3. Arborescence disque (Windows)

```
C:\ConteFactory\                          ← racine Git (mon-site)
├── conte-factory\                        ← APPLICATION VIDEO IA
│   ├── dashboard.py                      ← Point d'entrée Streamlit
│   ├── main.py                           ← Orchestrateur CLI
│   ├── config.py                         ← Variables d'environnement
│   ├── .env                              ← Config locale (non versionné)
│   ├── .venv\                            ← Python app (léger)
│   ├── pages\
│   │   ├── 1_Tableau_de_bord.py          ← Suivi vidéos
│   │   ├── 2_Creation.py                 ← Formulaire création
│   │   └── 3_Projet_Dev.py               ← Ce diagnostic (UI)
│   ├── modules\                          ← Logique pipeline (voir §5)
│   ├── db\database.py                    ← SQLite
│   ├── data\                             ← Données runtime
│   │   ├── database.db
│   │   ├── videos\video_XXXX\            ← Un dossier par projet
│   │   ├── exports\                      ← MP4 finaux
│   │   ├── progress.json                 ← État UI
│   │   └── job.log                       ← Log sous-processus
│   ├── assets\
│   │   ├── scripts\                      ← Scripts JSON structurés
│   │   ├── characters\                   ← Fiches personnages
│   │   └── music\                        ← Musiques libres de droit
│   ├── scripts\
│   │   ├── DEMARRER-VIDEO-IA.bat         ← Lancement quotidien
│   │   ├── SWITCH-TO-I2V.bat             ← Basculer mode I2V
│   │   └── verify_pipeline.py            ← Pré-vol (tests)
│   └── tests\test_smoke.py               ← 15 tests unitaires
│
└── pinokio\                              ← MOTEURS IA (séparés)
    ├── wan-i2v\app\                      ← I2V LTX/Wan (port 7861)
    ├── wan-snapdragon-arm\app\           ← Wan T2V (port 7860)
    └── talking-wav2lip\app\              ← Wav2Lip legacy (port 7870)
```

---

## 4. Pipeline détaillé (6 étapes)

| # | Étape | Module | Entrée | Sortie | Fichiers clés |
|---|-------|--------|--------|--------|---------------|
| 1 | **Sourcing** | `modules/sourcing.py` | Thème ou `--script` JSON | `story.json` + ligne DB | `data/videos/video_XXXX/story.json` |
| 2 | **Storyboard** | `modules/storyboard.py` + `clip_prompts.py` | `story.json` | `storyboard.json` | Scènes, dialogues, prompts visuels EN |
| 3 | **Audio** | `modules/audio.py` | `storyboard.json` | `audio/narration.mp3` | Edge-TTS multi-voix, 44.1 kHz |
| 4 | **Vidéo IA** | `modules/video_ai.py` → `i2v_pipeline.py` | Storyboard + stills | `ai_clips/scene_XXX_part00.mp4` | 1 image → 1 clip I2V par scène |
| 5 | **Montage** | `modules/montage.py` | Clips + audio + musique | `data/exports/XXXX_Titre.mp4` | Crossfade 0.5s, musique -16 dB |
| 6 | **Publish** | `modules/publish.py` | `publish.json` + MP4 | YouTube (optionnel) | OAuth dans `secrets/` |

### Statuts DB (`videos.statut`)

```
nouveau → script_ok → storyboard_ok → audio_ok → images_ok → montage_ok → pret → publie
                                                                              ↓
                                                                           erreur
```

### Contenu d'un projet (`data/videos/video_0036/`)

```
story.json              # Histoire, dialogues, métadonnées
storyboard.json         # Scènes, durées, clip_plans, ai_clip_files
audio/
  narration.mp3         # Piste complète
  scene_001_line00.mp3  # Par réplique (mode talking)
ai_clips/
  stills/scene_001.png  # 1 image de référence par scène
  scene_001_part00.mp4  # Clip I2V trimmé
clips/                  # Clips ajustés durée (intermédiaire montage)
publish.json            # Métadonnées YouTube
```

---

## 5. Modules clés

### Pipeline core

| Module | Rôle |
|--------|------|
| `sourcing.py` | Génération histoire (builtin / Mistral / Ollama) ou chargement JSON structuré |
| `script_parser.py` | Validation et parsing des scripts JSON (`assets/scripts/`) |
| `storyboard.py` | Découpage scènes, prompts visuels EN (LLM ou fallback) |
| `audio.py` | Edge-TTS multi-personnages, nettoyage texte parasite, ajustement durée |
| `video_ai.py` | Routeur provider (i2v / talking / wan / images / fal) |
| `i2v_pipeline.py` | Workflow I2V complet : stills → batch I2V → trim anti-boucle |
| `i2v_ai.py` | Client moteur I2V (CLI + Gradio) |
| `montage.py` | FFmpeg : concat, crossfade, mix musique, SRT, export H.264 |
| `publish.py` | Upload YouTube Data API v3 |
| `job_runner.py` | Lance `main.py` en arrière-plan depuis l'UI Streamlit |

### Qualité visuelle / narrative (P1–P5)

| Module | Rôle |
|--------|------|
| `style_lock.py` | Cohérence style (aquarelle ≠ Pixar, negative prompts) |
| `character_lock.py` | Image de référence héros + clause identité dans les prompts |
| `character_ref.py` | Portraits 1080p pour lip-sync (mode talking) |
| `clip_prompts.py` | Plans de clips, anti-boucle, 1 clip/scène pour scripts structurés |
| `motion_prompts.py` | Templates mouvement (marche, regarde, frappe…) |
| `clip_postprocess.py` | `trim_loop_tail()` — coupe ~35% fin de clip (anti-boucle) |
| `loop_detection.py` | Détection similarité frames (optionnel) |
| `youth_spec.py` | Profils par âge : FPS, durée plans, TTS, couleurs |

### Infrastructure

| Module | Rôle |
|--------|------|
| `progress.py` | `progress.json` avec % pondéré (video_ai = 22–75%) |
| `i2v_service.py` | Démarrage auto serveur Gradio I2V (:7861) |
| `wan_service.py` | Démarrage auto Wan T2V (:7860) |
| `lipsync_service.py` | Démarrage auto Wav2Lip (:7870) |
| `image_ai.py` | Génération stills (Pollinations → Pillow fallback) |

### Legacy (ne pas utiliser pour le pipeline principal)

- `video_generator.py` — ancien wrapper Wan
- `video_assembler.py` — ancien montage FFmpeg

---

## 6. Modes `VIDEO_PROVIDER`

Configuré via `CONTE_VIDEO_PROVIDER` dans `.env` :

| Valeur | Pipeline | Moteur | Port | Statut |
|--------|----------|--------|------|--------|
| **`i2v`** (défaut) | TTS → image → I2V | LTX / Wan Fun 1.3B | 7861 | **Recommandé** |
| `talking` | TTS → portrait → Wav2Lip | talking-wav2lip | 7870 | Legacy |
| `pinokio` / `wan` | Text-to-video brut | Wan 2.1 T2V | 7860 | Optionnel |
| `images` | Illustration + Ken Burns | Pollinations/Pillow | — | Fallback |
| `fal` | Cloud Kling | FAL API | — | Optionnel cloud |

### Paramètres I2V selon style

| Profil | Condition | CFG | Motion | Résolution | Frames | Steps |
|--------|-----------|-----|--------|------------|--------|-------|
| Face-safe | Styles non-Pixar | 3.5 | 0.3 | 848×480 | 33 | 22 |
| Pixar 3D | `style_key=3d_mignon` | 4.0 | 0.55 | 1024×576 | 81 | 25 |

Appliqués dynamiquement par `video_ai._apply_i2v_env()` avant chaque appel I2V.

---

## 7. Configuration (.env)

Copier `.env.example` → `.env`. Variables essentielles :

```env
CONTE_VIDEO_PROVIDER=i2v
CONTE_TARGET_DURATION_MIN=5
CONTE_TTS_VOICE=fr-FR-VivienneMultilingualNeural
CONTE_TTS_RATE=-12%
CONTE_VIDEO_FPS=24
CONTE_MUSIC_VOLUME=0.158
CONTE_AUTO_START_I2V=1
WAN_I2V_BACKEND=ltx
PINOKIO_I2V_URL=http://127.0.0.1:7861
CONTE_STORY_MODE=builtin
```

Voir `config.py` pour la liste complète (~40 variables).

---

## 8. Ce qui a été fait (juillet 2026)

### Pipeline qualité (branche `cursor/pipeline-quality-fixes-0391`)

| # | Correction | Fichiers | Statut |
|---|-----------|----------|--------|
| P1 | Scripts JSON structurés (scène par scène, prompts visuels fixes) | `script_parser.py`, `assets/scripts/` | ✅ |
| P2 | Style lock (aquarelle ≠ Pixar, negative prompts) | `style_lock.py`, `creative_options.py` | ✅ |
| P3 | Character lock (image référence héros, clause identité) | `character_lock.py`, `character_ref.py` | ✅ |
| P4 | Anti-boucle (trim fin clip, motion prompts, détection frames) | `clip_postprocess.py`, `loop_detection.py` | ✅ |
| P5 | Motion prompts (actions typées : marche, regarde, frappe…) | `motion_prompts.py`, `clip_prompts.py` | ✅ |

### Corrections qualité vidéo (dernière itération)

| Correction | Détail |
|-----------|--------|
| **Nettoyage TTS** | `_strip_parasitic_text()` supprime intro/salutations/métadonnées avant Edge-TTS |
| **Character anchor** | Portraits 1920×1080, cadrage MCU, visage centré 40% |
| **Post-traitement lip-sync** | Unsharp mask + smartblur après Wav2Lip |
| **Montage** | Crossfade 0.5s inter-scènes, musique fade-in 2s à -16 dB |
| **Params I2V Pixar** | Motion 0.55, 1024×576, CFG 4.0 appliqués dynamiquement |
| **1 clip/scène** | `MAX_CLIPS_PER_SCENE=1` pour éviter crash (33 clips) |
| **Reprise projets** | `resolve_project_dir()` répare chemins vides en DB |
| **`--force-new`** | Hash unique pour éviter collision SQLite |
| **UI générique** | Suppression checkbox Petit Chaperon hardcodé, thème libre |
| **Crash handling** | `job.exit` + messages d'erreur détaillés dans l'UI |
| **Tests** | 15 tests smoke (TTS, I2V params, style lock, hash, paths) |

---

## 9. Ce qu'il reste à faire

### Priorité haute

| # | Tâche | Détail | Difficulté |
|---|-------|--------|------------|
| 1 | **Cohérence visuelle personnages** | IP-Adapter / ControlNet pour verrouiller le visage entre scènes (au-delà du prompt lock actuel) | Élevée — nécessite intégration modèle |
| 2 | **Merge branche → main** | `cursor/pipeline-quality-fixes-0391` n'est pas encore mergée dans `main` | Faible — review + merge |
| 3 | **Tests intégration I2V** | Aucun test GPU/FFmpeg end-to-end ; CI sans CUDA | Moyenne |
| 4 | **Durée vidéo** | Narrations courtes → vidéos ~2 min au lieu de 5 min cible | Moyenne — allonger dialogues ou ajuster `SCENE_TARGET_SEC` |

### Priorité moyenne

| # | Tâche | Détail |
|---|-------|--------|
| 5 | **Smart loop trim** | `loop_detection.py` existe mais pas intégré comme trim intelligent (actuellement coupe fixe 65%) |
| 6 | **Scripts JSON depuis UI** | Upload/import script structuré dans `2_Creation.py` (actuellement CLI uniquement via `--script`) |
| 7 | **YouTube publish** | Libs Google commentées dans `requirements.txt` ; OAuth manuel |
| 8 | **Volume musique unifié** | `config.MUSIC_VOLUME` = -16 dB mais `youth_spec` utilise encore -14 dB |
| 9 | **Schéma JSON versionné** | `storyboard.json` / `clip_plans` sans version explicite |

### Priorité basse / dette technique

| # | Tâche | Détail |
|---|-------|--------|
| 10 | Supprimer modules legacy (`video_generator.py`, `video_assembler.py`) |
| 11 | Dédupliquer découverte API Gradio (`video_ai.py` vs `i2v_ai.py`) |
| 12 | Tests Streamlit UI |
| 13 | Mode `fal` cloud moins maintenu |
| 14 | Documentation API interne (docstrings modules) |

---

## 10. Commandes essentielles (Windows PowerShell)

### Installation initiale

```powershell
cd C:\ConteFactory
git fetch origin cursor/pipeline-quality-fixes-0391
git checkout cursor/pipeline-quality-fixes-0391

cd conte-factory
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
copy .env.example .env
.\scripts\SWITCH-TO-I2V.bat
```

### Lancement quotidien

```powershell
cd C:\ConteFactory\conte-factory
.\scripts\DEMARRER-VIDEO-IA.bat
```

Ou manuellement :

```powershell
cd C:\ConteFactory\conte-factory
.\.venv\Scripts\streamlit.exe run dashboard.py --server.port 8501
```

### Génération CLI (sans UI)

```powershell
cd C:\ConteFactory\conte-factory

# Test court depuis un thème
.\.venv\Scripts\python.exe main.py --theme "dragon violet dans les nuages" --duration 3 --age 7-10 --style 3d_mignon --no-publish

# Script structuré (meilleure qualité)
.\.venv\Scripts\python.exe main.py --script assets\scripts\petit_chaperon_rouge.json --no-publish

# Reprendre après crash
.\.venv\Scripts\python.exe main.py --resume 36 --only video_ai,montage --no-publish

# Estimation temps
.\.venv\Scripts\python.exe main.py --estimate --duration 5
```

### Diagnostic / réparation

```powershell
# Pré-vol (compile + imports + 15 tests)
.\.venv\Scripts\python.exe scripts\verify_pipeline.py

# Scanner projets disque vs DB
.\.venv\Scripts\python.exe scripts\diagnostic_projet.py --scan-all

# Réinitialiser clips I2V d'un projet
.\.venv\Scripts\python.exe scripts\clear_ai_clips.py 36

# Réparer Git (ORIG_HEAD cassé)
Remove-Item -Force -ErrorAction SilentlyContinue .git\ORIG_HEAD
git gc --prune=now
git pull origin cursor/pipeline-quality-fixes-0391
```

### URLs locales

| Service | URL |
|---------|-----|
| Dashboard Streamlit | http://127.0.0.1:8501 |
| Wan I2V Gradio | http://127.0.0.1:7861 |
| Wan T2V Gradio | http://127.0.0.1:7860 |
| Wav2Lip Gradio | http://127.0.0.1:7870 |

---

## 11. Pièges connus

| Problème | Cause | Solution |
|----------|-------|----------|
| `dashboard.py` introuvable | Mauvais dossier (`C:\ConteFactory` au lieu de `conte-factory\`) | `cd C:\ConteFactory\conte-factory` |
| `ORIG_HEAD` cassé | Référence Git corrompue sur Windows | `Remove-Item .git\ORIG_HEAD` puis `git gc --prune=now` |
| `streamlit` non reconnu | Pas dans le venv | `.\.venv\Scripts\pip install streamlit` |
| Params I2V par défaut (848×480) malgré Pixar | Env vars non appliquées avant appel I2V | Vérifier `video_ai._apply_i2v_env()` |
| `storyboard.json manquant` en reprise | `chemin_projet` vide en DB | `resolve_project_dir()` le répare automatiquement |
| Crash 33 clips | `MAX_CLIPS_PER_SCENE` était à 3 | Maintenant limité à 1 |
| `UNIQUE constraint hash_script` | `--force-new` sans hash unique | Corrigé : UUID + timestamp dans le hash |
| Scheduler `dpmpp_2m` | Crash I2V | Toujours utiliser `default` |
| CFG > 4 | Visages fondus | Plafonné à 4.0 dans le code |
| torch dans mauvais venv | Confusion app vs pinokio | torch uniquement dans `pinokio\*\app\env\` |

---

## 12. Tests

```powershell
cd C:\ConteFactory\conte-factory
.\.venv\Scripts\python.exe -m unittest tests.test_smoke -v
```

**15 tests** couvrant : fingerprint, TTS pitch/rate, style lock, character lock, motion prompts, script parser, I2V Pixar params, `resolve_project_dir`, nettoyage TTS, volume musique.

**Non testé :** I2V GPU, FFmpeg montage end-to-end, Edge-TTS réseau, UI Streamlit.

---

## 13. Fichiers à lire en priorité

| Priorité | Fichier | Pourquoi |
|----------|---------|----------|
| 1 | `main.py` | Orchestration pipeline, flags CLI, reprise |
| 2 | `config.py` | Toutes les variables d'environnement |
| 3 | `modules/i2v_pipeline.py` | Chemin animation principal |
| 4 | `db/database.py` | Modèle projet, statuts, reprise |
| 5 | `modules/job_runner.py` | Pont UI → CLI |
| 6 | `modules/audio.py` | TTS + nettoyage texte |
| 7 | `modules/montage.py` | FFmpeg final |
| 8 | `pages/2_Creation.py` | Formulaire utilisateur |
| 9 | `assets/scripts/petit_chaperon_rouge.json` | Exemple script structuré |
| 10 | `scripts/DEMARRER-VIDEO-IA.bat` | Lancement Windows |

---

## 14. Contacts & ressources

- **Repo :** https://github.com/urdirditfurd/mon-site
- **Branche active :** `cursor/pipeline-quality-fixes-0391`
- **PR qualité :** #17
- **Guides existants :** `docs/GUIDE.md`, `docs/GUIDE-1-JOUR-NVIDIA.md`, `docs/PLAN-1-JOUR-COMPLET.md`
