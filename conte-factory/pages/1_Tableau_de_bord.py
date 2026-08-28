"""Page Suivi — videos creees, lecture, YouTube (sans technique Wan)."""

from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from db.database import list_videos, set_paused, stats
from modules.job_runner import start_resume_job
from modules.progress import get_progress
from modules.publish import publish_youtube
from ui_helpers import (
    audio_preview_path,
    boot_app,
    fmt_min,
    go_page,
    mp4_path,
    nav_buttons,
    next_step_for,
    render_engine_status,
    render_sidebar,
    statut_badge,
    video_title,
)

ctx = boot_app("video ia — Suivi")
render_sidebar("Suivi")
nav_buttons("Suivi")

st.markdown(
    """
<div class="hero-card">
  <div class="section-label">Suivi</div>
  <h2 style="margin:0;">Tes videos</h2>
  <p>Statut, lecture, publication YouTube.</p>
</div>
""",
    unsafe_allow_html=True,
)

render_engine_status(ctx, "suivi")

prog = get_progress()
if prog.get("running"):
    st.info(
        f"Creation en cours : {prog.get('pct', 0):.0f}% — {prog.get('message')} "
        "(details dans Creation)"
    )
    if st.button("Voir la progression"):
        go_page("pages/2_Creation.py")

s = stats()
m1, m2, m3, m4 = st.columns(4)
m1.metric("Creees", s["total"])
m2.metric("Pretes", s.get("pretes", 0))
m3.metric("Publiees", s["publiees"])
m4.metric("Erreurs", s["erreurs"])

pa, pb, pc = st.columns(3)
with pa:
    if st.button("Nouvelle creation", type="primary", use_container_width=True):
        go_page("pages/2_Creation.py")
with pb:
    if st.button("Pause", use_container_width=True):
        set_paused(True)
        st.rerun()
with pc:
    if st.button("Reprendre", use_container_width=True):
        set_paused(False)
        st.rerun()

st.divider()
st.subheader("Derniere video")
derniere = s.get("derniere")
if not derniere:
    st.info("Aucune video. Va dans Creation pour en lancer une.")
else:
    st.write(f"**{video_title(derniere)}**")
    st.write(statut_badge(derniere.get("statut")))
    st.write(f"Duree : {fmt_min(derniere.get('duree_sec'))}")
    mp4 = mp4_path(derniere)
    audio = audio_preview_path(derniere)
    if mp4:
        st.video(str(mp4))
    elif audio:
        st.warning("Film pas encore pret — audio disponible. Reprends l'animation I2V.")
        st.audio(str(audio))
        step = next_step_for(derniere.get("statut")) or "video_ai"
        if st.button(
            f"Continuer I2V + montage (#{derniere['id']})",
            type="primary",
            use_container_width=True,
        ):
            result = start_resume_job(
                video_id=int(derniere["id"]), only=step, publish=False
            )
            if result.get("ok"):
                st.success("Reprise lancee en arriere-plan.")
                go_page("pages/2_Creation.py")
            else:
                st.warning(result.get("error") or result)
    if derniere.get("youtube_id"):
        st.link_button("Voir sur YouTube", f"https://youtu.be/{derniere['youtube_id']}")
    if derniere.get("erreur"):
        st.error(derniere["erreur"])

st.divider()
st.subheader("Toutes les videos")
for v in list_videos(40):
    if not v:
        continue
    with st.expander(f"#{v['id']} — {video_title(v)} · {statut_badge(v.get('statut'))}"):
        st.write(f"Theme : {v.get('theme') or '—'}")
        st.write(f"Duree : {fmt_min(v.get('duree_sec'))}")
        mp4 = mp4_path(v)
        if mp4:
            st.video(str(mp4))
            if v.get("statut") in {"pret", "montage_ok", "video_prete"} and not v.get(
                "youtube_id"
            ):
                if st.button("Publier YouTube", key=f"yt_{v['id']}"):
                    try:
                        st.success(publish_youtube(int(v["id"]), force=True))
                        st.rerun()
                    except Exception as exc:
                        st.error(str(exc))
        else:
            step = next_step_for(v.get("statut"))
            if step and step != "publish":
                if st.button(f"Continuer ({step})", key=f"c_{v['id']}"):
                    result = start_resume_job(
                        video_id=int(v["id"]), only=step, publish=False
                    )
                    if result.get("ok"):
                        st.success("Reprise lancee — vois Creation pour le %.")
                        go_page("pages/2_Creation.py")
                    else:
                        st.warning(result.get("error") or result)
