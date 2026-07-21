"""Dashboard matinal — contrôle de la chaîne de contes IA.

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

from config import (
    AI_CLIP_SEC,
    AUTO_PUBLISH,
    CHANNEL_NAME,
    FAL_CONCURRENCY,
    FAL_KEY,
    TARGET_DURATION_MIN,
    TTS_VOICE,
    VIDEO_PROVIDER,
    ensure_dirs,
    estimate_ai_clips,
)
from db.database import init_db, is_paused, list_videos, set_paused, stats
from main import run_pipeline
from modules.publish import publish_youtube

ensure_dirs()
init_db()

st.set_page_config(page_title=f"{CHANNEL_NAME} — Matin", page_icon="🌙", layout="wide")
st.title(f"🌙 {CHANNEL_NAME}")
st.caption("Trame d’origine : script → storyboard → vidéo IA → montage → publication auto")

s = stats()
c1, c2, c3, c4 = st.columns(4)
c1.metric("Vidéos créées", s["total"])
c2.metric("Publiées", s["publiees"])
c3.metric("Erreurs", s["erreurs"])
c4.metric("Pipeline", "⏸ Pause" if s["pause"] else "▶ Actif")

clips = estimate_ai_clips()
st.info(
    f"Cible {TARGET_DURATION_MIN} min ≈ **{clips} clips IA** × {AI_CLIP_SEC}s · "
    f"provider `{VIDEO_PROVIDER}` · concurrence {FAL_CONCURRENCY} · "
    f"publish auto={'oui' if AUTO_PUBLISH else 'non'} · "
    f"clé FAL={'OK' if FAL_KEY else 'MANQUANTE'}"
)

st.divider()
left, right = st.columns(2)
with left:
    st.subheader("Rapport du jour")
    derniere = s["derniere"]
    if not derniere:
        st.info("Aucune vidéo pour l’instant.")
    else:
        duree = derniere.get("duree_sec") or 0
        st.write(f"**Titre :** {derniere['titre']}")
        st.write(f"**Statut :** `{derniere['statut']}`")
        st.write(f"**Durée :** {duree/60:.1f} min" if duree else "**Durée :** —")
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
col_a, col_b, col_c = st.columns(3)
with col_a:
    if st.button("⏸ Pause", use_container_width=True):
        set_paused(True)
        st.rerun()
with col_b:
    if st.button("▶ Reprendre", use_container_width=True):
        set_paused(False)
        st.rerun()
with col_c:
    st.write(f"Voix `{TTS_VOICE}`")

theme = st.text_input("Thème", placeholder="ex: un dragon timide")
mode_short = st.checkbox("Test court (pas 30 min)", value=True)
no_publish = st.checkbox("Ne pas publier sur ce run", value=False)

if st.button("✨ Lancer génération + publish", type="primary", use_container_width=True):
    if is_paused():
        st.error("Pipeline en pause.")
    elif not FAL_KEY and VIDEO_PROVIDER == "fal":
        st.error("Ajoute FAL_KEY dans .env (génération vidéo IA obligatoire).")
    else:
        with st.spinner("Génération en cours (peut durer des heures pour 30 min)…"):
            try:
                result = run_pipeline(
                    theme=theme or None,
                    short=mode_short,
                    publish=False if no_publish else None,
                )
                st.success("Terminé.")
                st.json(result)
            except Exception as exc:
                st.exception(exc)

st.divider()
st.subheader("Historique")
for v in list_videos(30):
    with st.expander(f"#{v['id']} — {v['titre']} [{v['statut']}]"):
        st.write(v)
        if v["statut"] in {"pret", "montage_ok"} and st.button(
            "Uploader YouTube", key=f"yt_{v['id']}"
        ):
            try:
                st.success(publish_youtube(v["id"], force=True))
            except Exception as exc:
                st.error(str(exc))
