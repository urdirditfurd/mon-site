"""Page Creation — formulaire utilisateur + progression (sans UI Wan)."""

from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from modules.job_runner import (
    refresh_job_status,
    start_generation_job,
    stop_generation_job,
)
from modules.progress import get_progress
from ui_helpers import boot_app, nav_buttons, render_engine_status, render_sidebar

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
    duration = st.slider("Duree de la video (minutes)", min_value=1, max_value=60, value=5)
    voice = st.radio(
        "Voix",
        options=["femme", "homme", "auto"],
        index=0,
        horizontal=True,
    )
    subtitles = st.checkbox("Sous-titres", value=False)
    publish = st.checkbox("Publier sur YouTube a la fin", value=False)

    # Estimation simple (ordre de grandeur GPU)
    est_low = duration * 8
    est_high = duration * 20
    st.caption(
        f"Temps estime (ordre de grandeur GPU) : environ {est_low}–{est_high} minutes "
        f"selon ta carte et la duree."
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
        st.error("Moteur video pas encore pret — attends quelques secondes puis reessaie.")
    else:
        result = start_generation_job(
            theme=theme.strip(),
            duration_min=float(duration),
            voice=voice,
            subtitles=subtitles,
            publish=publish,
        )
        if result.get("ok"):
            st.success("Generation lancee.")
            st.rerun()
        else:
            st.warning(result.get("error") or result)

# --- Progression live ---
st.markdown("### Avancement")
pct = float(progress.get("pct") or 0)
st.progress(min(1.0, pct / 100.0), text=f"{pct:.0f}% — {progress.get('label') or progress.get('message') or ''}")

st.markdown(
    f"""
<div class="progress-box">
  <strong>{progress.get('message') or 'En attente'}</strong><br/>
  <span style="color:#6A6478">{progress.get('detail') or ''}</span>
</div>
""",
    unsafe_allow_html=True,
)

if progress.get("clips_total"):
    st.caption(
        f"Clips video : {progress.get('clips_done') or 0}/{progress.get('clips_total')}"
    )

if progress.get("video_id"):
    st.caption(f"Projet video #{progress['video_id']}")

if progress.get("error"):
    st.error(progress["error"])

if running:
    st.info("Generation en cours — cette page se rafraichit toute seule.")
    if st.button("Annuler la generation"):
        stop_generation_job()
        st.rerun()
elif progress.get("step") == "done":
    st.success("Video terminee — retrouve-la dans Suivi pour la visionner.")
    if st.button("Voir dans Suivi"):
        from ui_helpers import go_page

        go_page("pages/1_Tableau_de_bord.py")
