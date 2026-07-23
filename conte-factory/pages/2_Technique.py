"""Fenetre 2 — Technique & historique (details de fabrication)."""

from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import EXPORTS_DIR, PINOKIO_WAN_URL
from db.database import list_videos, video_process_detail
from modules.publish import publish_youtube
from ui_helpers import (
    audio_preview_path,
    boot_app,
    fmt_min,
    mp4_path,
    render_sidebar,
    render_wan_bar,
    statut_badge,
    video_title,
)

ctx = boot_app()
render_sidebar("Technique")

st.title("2. Technique & historique")
st.caption("Script · audio · clips Wan · montage · durees · journal")
render_wan_bar(ctx)

st.page_link("pages/1_Tableau_de_bord.py", label="← Retour Tableau de bord", icon="📊")

videos = list_videos(50)
if not videos:
    st.info("Aucune video en base.")
    st.stop()

options = {
    f"#{v['id']} — {video_title(v)} [{v.get('statut')}]": int(v["id"])
    for v in videos
    if v
}
choice = st.selectbox("Choisir une video", list(options.keys()))
vid = options[choice]
detail = video_process_detail(vid)
v = detail.get("video") or {}

k1, k2, k3, k4, k5 = st.columns(5)
k1.metric("Statut", detail.get("statut_label", "—"))
k2.metric("Scenes", detail.get("scenes") or v.get("nombre_scenes") or "—")
k3.metric("Clips IA", detail.get("clips_ia", 0))
k4.metric("Duree", fmt_min(v.get("duree_sec")))
k5.metric("Temps creation", fmt_min(detail.get("duree_creation_sec")))

st.markdown("### Criteres de fabrication")
c1, c2, c3, c4 = st.columns(4)
c1.write(f"Storyboard : **{'OK' if detail.get('storyboard') else 'non'}**")
c2.write(f"Audio TTS : **{'OK' if detail.get('audio') else 'non'}**")
c3.write(f"Montage MP4 : **{'OK' if detail.get('montage') else 'non'}**")
c4.write("Sous-titres : **non** (choix projet)")

st.markdown("### Identifiants")
st.write(f"- Theme : {v.get('theme') or '—'}")
st.write(f"- Titre : {video_title(v)}")
st.write(f"- Hash : `{str(v.get('hash_script') or '')[:18]}…`")
st.write(f"- Dossier projet : `{v.get('chemin_projet') or '—'}`")
st.write(f"- Statut : {statut_badge(v.get('statut'))}")

st.markdown("### Visionner")
mp4 = mp4_path(v)
audio = audio_preview_path(v)
if mp4:
    st.success("Film MP4 disponible")
    st.video(str(mp4))
elif audio:
    st.warning(
        "Pas de MP4 final. Tu peux ecouter l'audio. "
        "Sur le Tableau de bord, clique **Continuer** pour lancer Wan + montage."
    )
    st.audio(str(audio))
else:
    st.info("Rien a lire pour l'instant.")

st.markdown("### Script (apercu)")
if detail.get("script_apercu"):
    st.text(detail["script_apercu"])
else:
    st.caption("Pas de script trouve.")

st.markdown("### Journal")
events = detail.get("events") or []
if not events:
    st.caption("Aucun evenement.")
else:
    for e in events[-25:]:
        st.write(
            f"`{str(e.get('created_at') or '')[11:19]}` "
            f"**{e.get('niveau')}** — {e.get('message')}"
        )

if mp4 and v.get("statut") in {"pret", "montage_ok", "video_prete"}:
    if st.button("Uploader sur YouTube"):
        try:
            st.success(publish_youtube(vid, force=True))
            st.rerun()
        except Exception as exc:
            st.error(str(exc))

st.divider()
st.subheader("Exports disque")
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
exports = sorted(EXPORTS_DIR.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
if not exports:
    st.caption("Aucun MP4 dans data/exports — le montage n'a pas encore produit de film.")
else:
    for mp4f in exports[:8]:
        st.write(f"**{mp4f.name}** — {mp4f.stat().st_size / 1e6:.1f} Mo")
        try:
            st.video(str(mp4f))
        except Exception as exc:
            st.caption(str(exc))

with st.expander("Wan en direct"):
    if ctx["wan_ok"]:
        components.iframe(PINOKIO_WAN_URL, height=520, scrolling=True)
    else:
        st.warning("Wan hors ligne.")
