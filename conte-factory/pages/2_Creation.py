"""Page Creation — formulaire + gros % d'avancement (optimise 30 min)."""

from __future__ import annotations

import sys
import time
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import estimate_ai_clips, estimate_render_minutes
from modules.job_runner import (
    refresh_job_status,
    start_generation_job,
    stop_generation_job,
)
from modules.progress import get_progress
from ui_helpers import boot_app, go_page, nav_buttons, render_engine_status, render_sidebar

ctx = boot_app("video ia — Creation")
render_sidebar("Creation")
nav_buttons("Creation")

st.markdown(
    """
<div class="hero-card">
  <div class="section-label">Creation</div>
  <h2 style="margin:0;">Creer une video</h2>
  <p>Choisis ton theme et tes options — video ia s'occupe du reste.</p>
</div>
""",
    unsafe_allow_html=True,
)

render_engine_status(ctx, "crea")

status = refresh_job_status()
progress = status.get("progress") or get_progress()
job = status.get("job") or {}
running = bool(job.get("running") and status.get("alive"))

# --- Formulaire ---
with st.form("create_form", clear_on_submit=False):
    theme = st.text_input(
        "Theme ou prompt",
        placeholder="ex: un dragon timide qui apprend a voler",
        help="Decris l'histoire en une phrase.",
    )
    duration = st.slider(
        "Duree de la video (minutes)", min_value=1, max_value=60, value=5
    )
    voice = st.radio(
        "Voix",
        options=["femme", "homme", "auto"],
        index=0,
        horizontal=True,
    )
    age_label = st.selectbox(
        "Public (age)",
        options=[
            "1-9 ans (tous — rythme doux)",
            "1-3 ans (plus calme)",
            "4-6 ans (rythme moyen)",
            "7-9 ans (un peu plus de variete)",
        ],
        index=0,
        help="Adapte le nombre de changements d'image. L'histoire audio reste continue.",
    )
    age_map = {
        "1-9 ans (tous — rythme doux)": "1-9",
        "1-3 ans (plus calme)": "1-3",
        "4-6 ans (rythme moyen)": "4-6",
        "7-9 ans (un peu plus de variete)": "7-9",
    }
    age_group = age_map[age_label]
    subtitles = st.checkbox("Sous-titres", value=False)
    publish = st.checkbox("Publier sur YouTube a la fin", value=False)

    scenes = estimate_ai_clips(float(duration), age_group=age_group)
    est_low, est_high = estimate_render_minutes(float(duration), age_group=age_group)
    st.markdown(
        f"""
**Scenes animees :** {scenes} (1 clip Wan / scene, bouclee sur la voix)  
**Temps de creation estime :** environ **{est_low}–{est_high} minutes**

Pour 1–9 ans, la **voix** porte l'histoire.  
On change de decor toutes les ~2,5–3,5 min — assez pour rester doux, sans regenerer 100+ clips.
"""
    )
    if duration >= 20:
        st.caption(
            "Conseil : teste d'abord 3–5 minutes. "
            "30 min en public 1–9 ≈ ~10 scenes Wan, pas 15 ni 120."
        )

    submitted = st.form_submit_button(
        "Generer la video",
        type="primary",
        use_container_width=True,
        disabled=running or (ctx["uses_wan"] and not ctx["wan_ok"]),
    )

if submitted:
    if not theme.strip():
        st.error("Indique un theme.")
    elif ctx["uses_wan"] and not ctx["wan_ok"]:
        st.error("Moteur video pas encore pret — attends puis reessaie.")
    else:
        result = start_generation_job(
            theme=theme.strip(),
            duration_min=float(duration),
            voice=voice,
            subtitles=subtitles,
            publish=publish,
            age_group=age_group,
        )
        if result.get("ok"):
            st.success("Generation lancee.")
            st.rerun()
        else:
            st.warning(result.get("error") or result)

# --- Gros pourcentage (relu depuis le fichier a chaque affichage) ---
st.markdown("### Avancement de la creation")
progress = get_progress()
pct = float(progress.get("pct") or 0)
label = progress.get("label") or progress.get("message") or "En attente"
updated = progress.get("updated_at") or ""

st.markdown(
    f"""
<div class="progress-box" style="text-align:center;">
  <div style="font-size:3.6rem;font-weight:800;color:#3D2E6B;line-height:1;">{pct:.0f}%</div>
  <div style="margin-top:8px;font-size:1.15rem;font-weight:700;color:#5A458C;">{label}</div>
  <div style="margin-top:6px;color:#6A6478;">{progress.get('message') or ''}</div>
  <div style="margin-top:4px;color:#8A8499;font-size:0.9rem;">{progress.get('detail') or ''}</div>
  <div style="margin-top:4px;color:#A09AAC;font-size:0.8rem;">Maj: {updated}</div>
</div>
""",
    unsafe_allow_html=True,
)
st.progress(min(1.0, pct / 100.0))

cols = st.columns(3)
if progress.get("clips_total"):
    cols[0].metric(
        "Clips",
        f"{progress.get('clips_done') or 0}/{progress.get('clips_total')}",
    )
if progress.get("video_id"):
    cols[1].metric("Projet", f"#{progress['video_id']}")
cols[2].metric("Etape", str(progress.get("step") or "—"))

steps_ui = [
    ("sourcing", "Histoire"),
    ("storyboard", "Scenes"),
    ("audio", "Voix"),
    ("video_ai", "Images animees"),
    ("montage", "Montage"),
    ("done", "Termine"),
]
cur = str(progress.get("step") or "idle")
order = [s for s, _ in steps_ui]
try:
    cur_i = order.index(cur) if cur in order else (
        order.index("done") if cur == "publish" else -1
    )
except ValueError:
    cur_i = -1
chips = []
for i, (key, name) in enumerate(steps_ui):
    if cur == "error":
        mark = "○"
    elif cur_i > i or cur == "done":
        mark = "✓"
    elif cur_i == i or (cur == "start" and i == 0):
        mark = "●"
    else:
        mark = "○"
    chips.append(f"{mark} {name}")
st.caption(" → ".join(chips))

if progress.get("error"):
    st.error(progress["error"])

ref_cols = st.columns(2)
with ref_cols[0]:
    if st.button("Actualiser le %", use_container_width=True):
        st.rerun()

if running:
    st.info("Generation en cours — rafraichissement auto toutes les 3 s.")
    with ref_cols[1]:
        if st.button("Annuler la generation", use_container_width=True):
            stop_generation_job()
            st.rerun()
    time.sleep(3)
    st.rerun()
elif progress.get("step") == "done":
    st.success("Video terminee — retrouve-la dans Suivi pour la visionner.")
    if st.button("Voir dans Suivi"):
        go_page("pages/1_Tableau_de_bord.py")
