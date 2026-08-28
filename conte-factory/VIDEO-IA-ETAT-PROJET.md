# Conte Factory — Vidéo IA : état du projet (onboarding)

Document destiné aux nouveaux développeurs.  
Branche active : `cursor/conte-factory-pipeline-0391` · Dernier succès validé : projet `#1` « Le petit chaperon rouge » (~4 min 52 s).

---

## 1. Qu’est-ce que c’est ?

**Conte Factory** génère des contes jeunesse en vidéo (FR) sur PC Windows GPU (cible RTX 3080 10 Go) :

1. Écriture d’histoire (builtin / Mistral / Ollama)
2. Storyboard + découpage en scènes dialogues
3. TTS Edge (voix jeunesse)
4. Animation **Image-to-Video** (LTX / Wan) — clips courts anti-boucle
5. Montage FFmpeg → MP4 export
6. Publication YouTube optionnelle

UI Streamlit (`dashboard.py`) + CLI (`main.py`).

---

## 2. Architecture actuelle

```
Utilisateur (thème, âge, durée, style)
        │
        ▼
┌───────────────────┐
│  sourcing.py      │  → story.json (script + dialogues)
└─────────┬─────────┘
          ▼
┌───────────────────┐
│  storyboard.py    │  → storyboard.json
│  + clip_prompts   │     scenes[] + clip_plans[] (3–5 s)
└─────────┬─────────┘
          ▼
┌───────────────────┐
│  audio.py         │  → audio/narration.mp3 + scene_*.mp3
└─────────┬─────────┘
          ▼
┌───────────────────┐
│  i2v_pipeline.py  │  1 still / scène → I2V batch → trim loops
│  clip_postprocess │  → ai_clips/scene_XXX_partYY.mp4
└─────────┬─────────┘
          ▼
┌───────────────────┐
│  montage.py       │  → data/exports/XXXX_Titre.mp4
└─────────┬─────────┘
          ▼
┌───────────────────┐
│  publish.py       │  YouTube (optionnel)
└───────────────────┘
```

### Fichiers clés

| Fichier | Rôle |
|---------|------|
| `main.py` | Orchestrateur CLI (`--theme`, `--resume`, `--only`) |
| `config.py` | Env vars (`CONTE_*`, `PINOKIO_I2V_*`) |
| `modules/clip_prompts.py` | Anti-loop, caméra, `clip_plans` |
| `modules/clip_postprocess.py` | Coupe 30–50 % fin de clip |
| `modules/i2v_pipeline.py` | Pipeline I2V clip-par-clip |
| `modules/i2v_ai.py` | Client CLI/Gradio Wan/LTX |
| `modules/youth_spec.py` | Rythme / résolution par âge |
| `pinokio/wan-i2v/` | Moteur I2V (venv séparé + torch) |

### Données projet

```
data/videos/video_XXXX/
  story.json
  storyboard.json          # clip_plans par scène
  audio/
  ai_clips/
    stills/scene_XXX.png   # 1 image ref / scène narrative
    i2v_raw/…              # clips bruts I2V
    scene_XXX_partYY.mp4   # clips nettoyés (anti-loop)
data/exports/XXXX_*.mp4
data/database.db
```

---

## 3. Caractéristiques techniques Vidéo IA (état actuel)

### Moteur

| Paramètre | Valeur |
|-----------|--------|
| Provider | `CONTE_VIDEO_PROVIDER=i2v` |
| Backend | `WAN_I2V_BACKEND=ltx` (rapide) ou `wan` |
| Résolution I2V | **848×480** |
| Frames | 33 |
| Steps | 22 |
| CFG / guidance | **3.5** (plafond anti-déformation visage) |
| Motion scale | **0.3** |
| Scheduler | `default` (éviter `dpmpp_2m` → crash) |
| Export montage | 1920×1080 @ 24 fps |

### Anti-répétitions (livré)

| Règle | Implémentation |
|-------|----------------|
| Suffixe prompts anti-loop | `continuous single sequence shot`, `no repetition`, `stable anatomy`… |
| Actions début/fin | `finish_action()` (ex. dancing → starts then stops) |
| Caméra obligatoire | static / slow pan / slow zoom in / zoom out |
| Clips courts | **3–5 s**, max **3 clips / scène narrative** |
| Structure | `{description, action, camera, duration, init_frame}` |
| Image ref | **1 still PNG par scène** → réutilisée pour ses clips I2V |
| Post-process | `trim_loop_tail` : conserve ~65 % du début du clip |
| Jamais 1 prompt long | génération **clip par clip** en batch (1 chargement modèle) |

### Pipeline validé (prod locale)

- Projet `#1` Petit Chaperon : **33 clips** → montage **~292 s** OK
- Export : `data/exports/0001_Le_petit_chaperon_rouge.mp4`

---

## 4. Où nous en sommes

### Fait ✅

- Pipeline I2V face-safe + anti-boucle opérationnel
- **P1 Script structuré** : `--script` JSON (`script_parser.py`, template Petit Chaperon)
- **P2 Style lock** : `style_lock.py` (anti mélange aquarelle/Pixar)
- **P3 Character lock** : `character_lock.py` + `hero_ref.png` par projet
- **P4 Loop detection** : similarité de frames + trim (`loop_detection.py`)
- **P5 Motion templates** : `motion_prompts.py` (marche/regarde/court…)
- Découpage `clip_plans` + trim loops
- TTS jeunesse HQ (Edge Vivienne / Remy)
- Durée cible calée (audio + montage `-t`)
- UI Creation / Dashboard Streamlit
- Scripts Windows : `SWITCH-TO-I2V`, `INSTALL-I2V`, `verify_pipeline`
- Reprise projet (`--resume`, `ensure_story_files`)
- Vérification pré-lancement (`scripts/verify_pipeline.py`)

### Nouveau test recommandé (script fidèle au conte)

```powershell
cd C:\ConteFactory\conte-factory
.\.venv\Scripts\python.exe main.py --script assets\scripts\petit_chaperon_rouge.json --no-publish
```

### Partiel / fragile ⚠️

- Environnement Windows : refs Git cassées (`ORIG_HEAD`), venv I2V ≠ venv ConteFactory
- `torch` doit être dans le venv **pinokio/wan-i2v** (pas dans `.venv` ConteFactory)
- Cohérence personnage entre scènes (pas encore de lock ID fort / IP-Adapter)
- Qualité visage encore variable selon prompt / motion
- Publication YouTube : libs Google parfois absentes
- Message d’erreur Unicode Windows (corrigé récemment, à surveiller)

### Non fait / backlog ❌

- Détection réelle des loops (analyse optique) — aujourd’hui coupe fixe 30–50 %
- Continuity : même héros d’une scène à l’autre (référence personnage persistante)
- Upscale / export 4K qualité (flag existe, peu testé)
- Tests d’intégration I2V automatisés (GPU CI absent)
- Mode cloud (fal/Kling) peu maintenu face au chemin I2V local
- Lip-sync talking = legacy, non recommandé

---

## 5. Points à améliorer (priorisés)

### P0 — Qualité & stabilité

1. **Identité personnage** : image de référence héros partagée + IP-Adapter / ControlNet face  
2. **Détection de loops intelligente** (similarité frames début/fin) au lieu du trim aveugle  
3. **Health-check torch/CUDA** au démarrage UI avec message clair + bouton install  
4. **Stabiliser les installs Windows** (un seul script « bootstrap » : git + venv CF + venv I2V + .env)

### P1 — Perf & coût GPU

5. Réduire encore le temps : cache stills, skip clips déjà bons, batch smarter  
6. Paramètres adaptatifs VRAM (RTX 3080 10 Go vs autres cartes)  
7. Option « preview rapide » (1 clip/scène, steps bas) vs « final »

### P2 — Produit

8. Prévisualisation storyboard + clip_plans dans l’UI avant I2V  
9. Contrôle qualité post-montage (durée, silence, black frames)  
10. Publication YouTube fiable + retry  
11. Docs / onboarding (ce fichier) + diagramme à jour dans le README

### P3 — Architecture

12. Séparer clairement packages `conte_factory` vs `pinokio` engines  
13. Contrat JSON versionné pour `storyboard.json` / `clip_plans`  
14. Tests unitaires sur `finish_action`, `ensure_camera`, trim, montage durée

---

## 6. Démarrage rapide (dev)

```powershell
# 1) Code
cd C:\ConteFactory
git fetch origin cursor/conte-factory-pipeline-0391 --depth=50
git reset --hard FETCH_HEAD

# 2) Venv app
cd conte-factory
.\.venv\Scripts\python.exe scripts\verify_pipeline.py

# 3) Moteur I2V (torch CUDA) — une fois
powershell -ExecutionPolicy Bypass -File C:\ConteFactory\pinokio\wan-i2v\INSTALL-I2V.ps1

# 4) Config
.\scripts\SWITCH-TO-I2V.bat

# 5) Nouveau conte 5 min
.\.venv\Scripts\python.exe main.py --theme "..." --duration 5 --age "7-10" --style aquarelle --no-publish

# Reprise
.\.venv\Scripts\python.exe main.py --resume 1 --only video_ai --no-publish
```

### Commandes utiles

| Besoin | Commande |
|--------|----------|
| Vérifier code | `python scripts/verify_pipeline.py` |
| Scanner projets | `python scripts/diagnostic_projet.py --scan-all` |
| Clear clips IA | `python scripts/clear_ai_clips.py <id>` |
| UI | `python -m streamlit run dashboard.py` |

---

## 7. Pièges connus

- **Deux Python** : ConteFactory `.venv` ≠ Wan I2V `pinokio/wan-i2v/app/env` — `torch` va dans le second  
- **Ne pas** utiliser `dpmpp_2m` comme scheduler I2V  
- CFG > 4 → visages fondus  
- `git clean -fd` peut casser des configs locales si mal utilisé (scripts de réparation protègent `.venv` / `data`)  
- `--only storyboard,video_ai` nécessite des **guillemets** sous PowerShell  
- Dossier `video_XXXX` vide ≠ projet valide (artefacts requis : `story.json` / audio)

---

## 8. Glossaire court

| Terme | Sens |
|-------|------|
| Scène narrative | Unité storyboard (dialogue / TTS) |
| Clip plan | Micro-plan 3–5 s (1 action + 1 caméra) |
| init_frame | Image fixe de départ I2V |
| Face-safe | Params CFG/motion/res limités pour préserver le visage |
| Trim anti-loop | Coupe la fin du clip où l’IA régénère souvent la même action |

---

*Dernière mise à jour : juillet 2026 — après validation pipeline anti-boucle sur projet #1.*
