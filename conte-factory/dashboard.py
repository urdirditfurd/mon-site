"""Dashboard matinal — ouvre dans le navigateur chaque matin.

Lancer :
  streamlit run dashboard.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import CHANNEL_NAME, IMAGE_MODE, TARGET_DURATION_MIN, TTS_VOICE, ensure_dirs
from db.database import init_db, is_paused, list_videos, set_paused, stats
from main import run_pipeline
from modules.publish import publish_youtube

ensure_dirs()
init_db()

st.set_page_config(page_title=f"{CHANNEL_NAME} — Matin", page_icon="🌙", layout="wide")

st.title(f"🌙 {CHANNEL_NAME}")
st.caption("Tableau de bord matinal — contes longs pour YouTube")

s = stats()
c1, c2, c3, c4 = st.columns(4)
c1.metric("Vidéos créées", s["total"])
c2.metric("Publiées", s["publiees"])
c3.metric("Erreurs", s["erreurs"])
c4.metric("Pipeline", "⏸ Pause" if s["pause"] else "▶ Actif")

st.divider()

left, right = st.columns([1, 1])

with left:
    st.subheader("Rapport du jour")
    derniere = s["derniere"]
    if not derniere:
        st.info("Aucune vidéo pour l'instant. Lance une création ci-dessous.")
    else:
        duree = derniere.get("duree_sec") or 0
        st.write(f"**Titre :** {derniere['titre']}")
        st.write(f"**Statut :** `{derniere['statut']}`")
        st.write(f"**Durée :** {duree/60:.1f} min" if duree else "**Durée :** —")
        if derniere.get("chemin_video"):
            st.write(f"**Fichier :** `{derniere['chemin_video']}`")
        if derniere.get("youtube_id"):
            st.write(f"**YouTube :** https://youtu.be/{derniere['youtube_id']}")
        if derniere.get("erreur"):
            st.error(derniere["erreur"])

with right:
    st.subheader("Alertes")
    if not s["alertes"]:
        st.success("Rien à signaler.")
    else:
        for a in s["alertes"]:
            st.warning(f"#{a.get('video_id')} — {a['message']}")

st.divider()
st.subheader("Commandes")

col_a, col_b, col_c = st.columns(3)
with col_a:
    if st.button("⏸ Mettre en pause", use_container_width=True):
        set_paused(True)
        st.rerun()
with col_b:
    if st.button("▶ Reprendre", use_container_width=True):
        set_paused(False)
        st.rerun()
with col_c:
    st.write(f"Voix : `{TTS_VOICE}` · Images : `{IMAGE_MODE}` · Cible : {TARGET_DURATION_MIN} min")

theme = st.text_input("Thème du conte (optionnel)", placeholder="ex: un dragon timide")
mode_short = st.checkbox("Mode test rapide (~3 min)", value=True)
force_publish = st.checkbox("Publier sur YouTube après montage (avancé)", value=False)

if st.button("✨ Créer une nouvelle vidéo", type="primary", use_container_width=True):
    if is_paused():
        st.error("Le pipeline est en pause. Clique sur Reprendre d'abord.")
    else:
        with st.spinner("Création en cours… cela peut prendre plusieurs minutes."):
            try:
                result = run_pipeline(
                    theme=theme or None,
                    short=mode_short,
                    publish=force_publish,
                )
                st.success("Terminé.")
                st.json(result)
            except Exception as exc:
                st.exception(exc)

st.divider()
st.subheader("Historique")
videos = list_videos(30)
if not videos:
    st.caption("Vide pour le moment.")
else:
    for v in videos:
        with st.expander(f"#{v['id']} — {v['titre']} [{v['statut']}]"):
            st.write(v)
            if v["statut"] in {"pret", "montage_ok"} and st.button(
                "Uploader YouTube", key=f"yt_{v['id']}"
            ):
                try:
                    out = publish_youtube(v["id"], force=True)
                    st.success(out)
                except Exception as exc:
                    st.error(str(exc))
