"""Page Projet — diagnostic et onboarding développeur."""

from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import (
    MUSIC_VOLUME,
    TARGET_DURATION_MIN,
    VIDEO_FPS,
    VIDEO_PROVIDER,
    VIDEO_WIDTH,
    VIDEO_HEIGHT,
    ensure_dirs,
)
from db.database import init_db, stats
from ui_helpers import boot_app, nav_buttons, render_sidebar

ctx = boot_app("video ia — Projet Dev")
render_sidebar("Projet")
nav_buttons("Projet")

st.markdown(
    """
<div class="hero-card">
  <div class="section-label">Onboarding</div>
  <h2 style="margin:0;">Diagnostic Video IA</h2>
  <p>Vue d'ensemble du projet pour les developpeurs.</p>
</div>
""",
    unsafe_allow_html=True,
)

ensure_dirs()
init_db()
s = stats()

# --- Objectif ---
st.markdown("### Objectif")
st.info(
    "**Video IA** (Conte Factory) genere automatiquement des **videos de contes pour enfants** "
    "en francais : theme → histoire → voix → animation I2V → montage MP4 → YouTube."
)

# --- Metriques live ---
c1, c2, c3, c4 = st.columns(4)
c1.metric("Provider", VIDEO_PROVIDER)
c2.metric("FPS export", VIDEO_FPS)
c3.metric("Resolution", f"{VIDEO_WIDTH}x{VIDEO_HEIGHT}")
c4.metric("Projets DB", s["total"])

# --- Architecture ---
st.markdown("### Architecture")
st.code(
    """
UI Streamlit (dashboard.py, pages/)
    │
    ▼
main.py  ── sourcing → storyboard → audio → video_ai → montage → publish
    │
    ├── Edge-TTS (voix, pas de cle API)
    ├── Pinokio I2V (port 7861, torch+CUDA)
    └── FFmpeg (montage, sur PATH)
""",
    language=None,
)

st.markdown("**Deux environnements Python :**")
st.markdown(
    "| Env | Chemin | Contenu |\n"
    "|-----|--------|--------|\n"
    "| App | `conte-factory\\.venv\\` | streamlit, edge-tts (PAS de torch) |\n"
    "| Moteurs | `pinokio\\wan-i2v\\app\\env\\` | torch, diffusers, CUDA |"
)

# --- Pipeline ---
st.markdown("### Pipeline (6 etapes)")
steps = [
    ("1. Sourcing", "sourcing.py", "Theme → story.json"),
    ("2. Storyboard", "storyboard.py", "Scenes, dialogues, prompts visuels EN"),
    ("3. Audio", "audio.py", "Edge-TTS multi-voix, nettoyage texte"),
    ("4. Video IA", "i2v_pipeline.py", "Image → I2V → clip MP4 par scene"),
    ("5. Montage", "montage.py", "FFmpeg crossfade + musique -16 dB"),
    ("6. Publish", "publish.py", "Upload YouTube (optionnel)"),
]
for name, mod, desc in steps:
    st.markdown(f"- **{name}** (`modules/{mod}`) — {desc}")

# --- Modules qualite ---
with st.expander("Modules qualite (P1-P5)"):
    st.markdown(
        "| Module | Role |\n"
        "|--------|------|\n"
        "| `style_lock.py` | Coherence style (aquarelle ≠ Pixar) |\n"
        "| `character_lock.py` | Image reference heros + clause identite |\n"
        "| `clip_prompts.py` | Plans clips, anti-boucle, 1 clip/scene |\n"
        "| `motion_prompts.py` | Templates mouvement (marche, regarde…) |\n"
        "| `clip_postprocess.py` | Trim anti-boucle (~65% debut) |\n"
        "| `audio._strip_parasitic_text()` | Supprime intro/salutations TTS |"
    )

# --- Ce qui est fait ---
st.markdown("### Ce qui est fait")
done = [
    "Scripts JSON structures (scene par scene, prompts fixes)",
    "Style lock + character lock (coherence visuelle)",
    "Anti-boucle (trim clip + motion prompts)",
    "Nettoyage TTS (suppression textes parasites)",
    "Post-traitement lip-sync (sharpen + feathering)",
    "Crossfade 0.5s inter-scenes + musique fade-in -16 dB",
    "Params I2V Pixar dynamiques (motion 0.55, 1024x576)",
    "1 clip/scene (anti-crash)",
    "Reprise projets (resolve_project_dir)",
    "UI generique (n'importe quelle histoire via theme)",
    "15 tests smoke unitaires",
]
for item in done:
    st.markdown(f"- ✅ {item}")

# --- Ce qu'il reste ---
st.markdown("### Ce qu'il reste a faire")
todo_high = [
    "Cohérence visuelle personnages (IP-Adapter / ControlNet)",
    "Merger branche pipeline-quality-fixes → main",
    "Tests integration I2V + FFmpeg end-to-end",
    "Allonger narrations pour atteindre duree cible (~5 min)",
]
todo_med = [
    "Smart loop trim (integrer loop_detection.py)",
    "Import script JSON depuis l'UI",
    "YouTube publish (libs Google + OAuth)",
    "Unifier volume musique (youth_spec vs config)",
]
for item in todo_high:
    st.markdown(f"- 🔴 **{item}**")
for item in todo_med:
    st.markdown(f"- 🟡 {item}")

# --- Commandes ---
st.markdown("### Commandes essentielles (Windows)")
st.code(
    """# Lancement quotidien
cd C:\\ConteFactory\\conte-factory
.\\scripts\\DEMARRER-VIDEO-IA.bat

# Ou manuellement
.\\.venv\\Scripts\\streamlit.exe run dashboard.py --server.port 8501

# Generation CLI
.\\.venv\\Scripts\\python.exe main.py --theme "dragon violet" --duration 3 --no-publish

# Pre-vol (tests)
.\\.venv\\Scripts\\python.exe scripts\\verify_pipeline.py

# Reprendre apres crash
.\\.venv\\Scripts\\python.exe main.py --resume 36 --only video_ai,montage --no-publish""",
    language="powershell",
)

# --- Pièges ---
with st.expander("Pieges connus"):
    st.markdown(
        "| Probleme | Solution |\n"
        "|----------|----------|\n"
        "| `dashboard.py` introuvable | `cd C:\\ConteFactory\\conte-factory` (sous-dossier!) |\n"
        "| `ORIG_HEAD` casse | `Remove-Item .git\\ORIG_HEAD` puis `git gc --prune=now` |\n"
        "| Params I2V par defaut malgre Pixar | Verifier `_apply_i2v_env()` dans video_ai.py |\n"
        "| storyboard.json manquant | `resolve_project_dir()` repare auto |\n"
        "| torch dans mauvais venv | torch uniquement dans `pinokio\\*\\app\\env\\` |"
    )

# --- Doc complete ---
doc_path = ROOT / "docs" / "DIAGNOSTIC-VIDEO-IA.md"
if doc_path.exists():
    with st.expander("Documentation complete (DIAGNOSTIC-VIDEO-IA.md)"):
        st.markdown(doc_path.read_text(encoding="utf-8"))

# --- Fichiers prioritaires ---
st.markdown("### Fichiers a lire en priorite")
st.markdown(
    "1. `main.py` — orchestration\n"
    "2. `config.py` — variables env\n"
    "3. `modules/i2v_pipeline.py` — animation I2V\n"
    "4. `db/database.py` — modele projet\n"
    "5. `modules/job_runner.py` — pont UI → CLI\n"
    "6. `modules/audio.py` — TTS + nettoyage\n"
    "7. `modules/montage.py` — FFmpeg final\n"
    "8. `pages/2_Creation.py` — formulaire utilisateur"
)
