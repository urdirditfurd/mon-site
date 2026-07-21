# Conte Factory — trame d’origine (inchangée)

Objectif : publier automatiquement des **vidéos IA de 30 minutes et plus**, générées à partir d’un script, sans bloquer le serveur grâce à une découpe modulaire.

```
[1. Script & Déduplication]
        ↓
[2. Adaptation & Storyboard]
        ↓
[3. Moteur Vidéo & Audio]     ← vraie génération vidéo IA par scènes
        ↓
[4. Montage & Publication]    ← upload YouTube dès que le MP4 est prêt
        ↓
[5. Dashboard Matinal]
```

Sous-titres : **non requis** (l’audio porte la narration).

---

## Moteur vidéo IA choisi : Wan 2.1 (Pinokio)

Parmi les apps text-to-video Pinokio du repo / guide Snapdragon, le plus adapté aux **contes enfants longs** est :

| Critère | Choix |
|---|---|
| App | **`pinokio/wan-snapdragon-arm`** |
| Modèle | **Wan 2.1 T2V 1.3B** |
| Pourquoi | Déjà dans le projet, tourne sans NVIDIA (Snapdragon/CPU), style illustration ok pour contes, CLI + Gradio branchables |
| Alternatives écartées | Hunyuan (trop lourd), Wan2GP CUDA (besoin NVIDIA), Kling FAL (payant, gardé en fallback) |

Dans Conte Factory : `CONTE_VIDEO_PROVIDER=pinokio` (défaut).

---

## Réévaluation du temps de création (trame conservée)

Ton plan initial en 3 phases reste la bonne structure.  
**Ce n’est pas un projet “1 journée”** si la contrainte de viabilité est bien : *une vraie vidéo IA ~30 min publiée*.

### Phase 1 — Script & Audio
**Charge :** faible  
**Contenu :** histoire (LLM) + SQLite anti-doublon + voix off (Edge-TTS / XTTS)  
**Blocage possible :** aucun critique  
**Statut dans ce repo :** déjà amorcé

### Phase 2 — Visuels IA & Assemblage
**Charge :** très élevée (cœur du projet)  
**Contenu :**
- découpage du script en N scènes
- génération **vidéo IA Wan 2.1** via Pinokio (scène par scène)
- file d’attente + reprises si une scène échoue
- FFmpeg : coller les clips + piste audio + musique

**Ordre de grandeur pour 30 min (Wan Pinokio) :**
- clips courts (~2 s de mouvement) bouclés pour coller à l’audio
- ~180 segments à générer pour 30 min (selon `CONTE_AI_CLIP_SEC`)
- **local Snapdragon/CPU :** souvent **plusieurs heures à plus d’une nuit** (5–15 min/clip)
- **Colab GPU** (bouton Pinokio) : bien plus rapide par clip, mais session limitée
- **FAL fallback :** plus rapide, crédits payants

**Blocages possibles :**
- Pinokio Wan pas installé / pas lancé (Run)
- RAM insuffisante (32 Go recommandé sur Snapdragon)
- crédits API si fallback FAL

### Phase 3 — Automatisation & Dashboard
**Charge :** moyenne  
**Contenu :** YouTube Data API (upload auto dès fin de montage) + Streamlit + Cron 02:00  
**Blocage possible :** OAuth Google / quotas YouTube (à brancher une fois)

---

## Verdict clair

| Objectif | Temps de mise en place (ordre de grandeur) |
|---|---|
| Pipeline complet **selon ta trame** (script → storyboard → **vidéo IA** → montage → **publish auto** → dashboard) | **~3 phases** comme dans ton plan initial — Phase 2 domine largement |
| Première **vraie** vidéo IA courte (2–5 min) bout-en-bout + publish | Fin de Phase 2 partielle + Phase 3 upload |
| Première **vraie** vidéo IA **~30 min** publiée | Phase 2 complète + budget API (ou GPU dédié) + une nuit de rendu |

**Conclusion :** on garde ta trame. On n’utilise pas le raccourci “images + zoom”.  
Le délai réaliste n’est pas “tout fini en une journée” : la Phase 2 (moteur vidéo IA longue durée) est le goulot. Les Phases 1 et 3 sont rapides en comparaison.

---

## Ce qu’il faut avoir avant de lancer Phase 2

1. **Pinokio** + app **Wan Snapdragon ARM** installée et testée (bouton Run)
2. Clé YouTube Data API + `client_secrets.json` (pour la publication auto)
3. Cron / lancement de nuit (le rendu 30 min ne doit pas saturer la journée)

### Icône bureau « video ia » (Windows)

**Si le projet n’est pas encore là** — une commande PowerShell :

```powershell
irm https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/conte-factory-pipeline-0391/conte-factory/scripts/setup-windows-video-ia.ps1 | iex
```

**Si le projet est déjà dans** `C:\Users\...\mon-site` (ton cas) :

```powershell
cd $env:USERPROFILE\mon-site
git pull
cd conte-factory
powershell -ExecutionPolicy Bypass -File scripts\setup-windows-video-ia.ps1
```

Le script installe **Python** si besoin, crée `.venv`, puis pose le raccourci **video ia** sur le Bureau.

Ensuite : Pinokio → **Wan Snapdragon ARM** → Run → double-clic **video ia**.

---

## Enchaînement recommandé (trame originale)

```
Phase 1 : Script & Audio
  ├── Setup VPS (Python, FFmpeg, Git)
  ├── Histoire + SQLite anti-doublon
  └── TTS (Edge-TTS ou XTTS)

Phase 2 : Visuels IA & Assemblage
  ├── Génération vidéo IA scène par scène (API ou ComfyUI)
  ├── File d’attente + reprise sur erreur
  ├── FFmpeg : clips IA + audio + musique
  └── Test export ~30 min

Phase 3 : Automatisation & Dashboard
  ├── YouTube Data API → publish auto après montage
  ├── Dashboard Streamlit
  └── Cron 02:00
```

Le détail d’installation et les commandes : voir les modules dans ce dossier + `.env.example`.
