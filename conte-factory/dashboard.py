"""Dashboard video ia — branché en direct sur Wan (127.0.0.1:7860).

Lancer (Wan doit déjà tourner) :
  streamlit run dashboard.py --server.port 8501
"""

from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import (
    AI_CLIP_SEC,
    AUTO_PUBLISH,
    CHANNEL_NAME,
    EXPORTS_DIR,
    FAL_KEY,
    PINOKIO_WAN_URL,
    TARGET_DURATION_MIN,
    TTS_VOICE,
    VIDEO_PROVIDER,
    ensure_dirs,
    estimate_ai_clips,
)
from db.database import init_db, is_paused, list_videos, set_paused, stats
from main import run_pipeline
from modules.publish import publish_youtube
from modules.video_ai import pinokio_wan_health

ensure_dirs()
init_db()

st.set_page_config(
    page_title="video ia",
    page_icon=str(ROOT / "assets" / "video-ia-icon.png"),
    layout="wide",
)

# Rafraîchissement auto des données réelles
st_autorefresh = getattr(st, "fragment", None)
try:
    from streamlit_autorefresh import st_autorefresh as _ar

    _ar(interval=5000, key="wan_live_refresh")
except Exception:
    pass

st.title(f"🎬 video ia — {CHANNEL_NAME}")
st.caption(
    f"Dashboard **8501** ↔ moteur Wan **{PINOKIO_WAN_URL}** → montage → YouTube"
)

health = pinokio_wan_health(deep=False)
s = stats()
wan_ok = bool(health.get("gradio_up"))

# --- Bandeau connexion Wan (données réelles) ---
b1, b2, b3, b4, b5 = st.columns(5)
b1.metric("Wan Gradio", "🟢 EN LIGNE" if wan_ok else "🔴 HORS LIGNE")
b2.metric("Vidéos créées", s["total"])
b3.metric("Publiées", s["publiees"])
b4.metric("Erreurs", s["erreurs"])
b5.metric("Pipeline", "⏸ Pause" if s["pause"] else "▶ Actif")

if wan_ok:
    st.success(
        f"Wan connecté : `{health.get('gradio_url')}`"
        + (f" — {health.get('gradio_title')}" if health.get("gradio_title") else "")
    )
else:
    st.error(
        "Wan n’est pas joignable. Lance d’abord :\n\n"
        "`LANCER-WAN-NVIDIA.bat` puis recharge cette page.\n\n"
        f"URL attendue : `{PINOKIO_WAN_URL}`"
    )
    if health.get("gradio_error"):
        st.caption(health["gradio_error"])

with st.expander("Détails connexion Wan (live)", expanded=not wan_ok):
    st.json(
        {
            "gradio_up": health.get("gradio_up"),
            "gradio_url": health.get("gradio_url"),
            "gradio_title": health.get("gradio_title"),
            "engine": health.get("engine"),
            "ready_for_pipeline": health.get("ready_for_pipeline"),
            "provider": VIDEO_PROVIDER,
            "target_min": TARGET_DURATION_MIN,
            "clips_estimes": estimate_ai_clips(),
            "ai_clip_sec": AI_CLIP_SEC,
            "auto_publish": AUTO_PUBLISH,
            "voix": TTS_VOICE,
        }
    )
    c_ref, c_open, c_deep = st.columns(3)
    with c_ref:
        if st.button("🔄 Rafraîchir", use_container_width=True):
            st.rerun()
    with c_open:
        st.link_button("Ouvrir Wan (7860)", PINOKIO_WAN_URL, use_container_width=True)
    with c_deep:
        if st.button("🔍 Check GPU profond", use_container_width=True):
            st.session_state["deep_health"] = pinokio_wan_health(deep=True)
    if st.session_state.get("deep_health"):
        st.write(st.session_state["deep_health"])

st.divider()

# --- Intégration visuelle Wan dans le dashboard ---
tab_pilot, tab_wan, tab_exports = st.tabs(
    ["Pilototer le pipeline", "Wan en direct (7860)", "Exports réels"]
)

with tab_wan:
    st.subheader("Interface Wan intégrée")
    if wan_ok:
        components.iframe(PINOKIO_WAN_URL, height=720, scrolling=True)
    else:
        st.warning("Démarre Wan pour voir l’interface ici.")

with tab_exports:
    st.subheader("Fichiers MP4 générés (disque)")
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    exports = sorted(EXPORTS_DIR.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not exports:
        st.info("Aucun export pour l’instant — lance une génération.")
    else:
        for mp4 in exports[:8]:
            st.write(f"**{mp4.name}** — {mp4.stat().st_size / 1e6:.1f} Mo")
            try:
                st.video(str(mp4))
            except Exception as exc:
                st.caption(f"Lecture impossible: {exc}")

with tab_pilot:
    left, right = st.columns(2)
    with left:
        st.subheader("Rapport du jour (SQLite)")
        derniere = s["derniere"]
        if not derniere:
            st.info("Aucune vidéo en base.")
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

    theme = st.text_input("Thème du conte", placeholder="ex: un dragon timide")
    mode_short = st.checkbox("Test court (recommandé d’abord)", value=True)
    no_publish = st.checkbox("Ne pas publier sur ce run", value=True)

    if st.button(
        "✨ Lancer pipeline (Wan → audio → montage)",
        type="primary",
        use_container_width=True,
        disabled=not wan_ok and VIDEO_PROVIDER.lower().startswith(("pinokio", "wan")),
    ):
        if is_paused():
            st.error("Pipeline en pause.")
        elif VIDEO_PROVIDER == "fal" and not FAL_KEY:
            st.error("Ajoute FAL_KEY dans .env.")
        elif VIDEO_PROVIDER.lower().startswith(("pinokio", "wan")) and not wan_ok:
            st.error("Wan hors ligne — lance LANCER-WAN-NVIDIA.bat")
        else:
            progress = st.progress(0, text="Démarrage…")
            log_box = st.empty()
            try:
                progress.progress(10, text="Script + storyboard + audio…")
                result = run_pipeline(
                    theme=theme or None,
                    short=mode_short,
                    publish=False if no_publish else None,
                )
                progress.progress(100, text="Terminé")
                st.success("Pipeline terminé — données réelles ci-dessous.")
                log_box.json(result)
                st.rerun()
            except Exception as exc:
                progress.progress(100, text="Erreur")
                st.exception(exc)

    st.divider()
    st.subheader("Historique (base réelle)")
    for v in list_videos(30):
        with st.expander(f"#{v['id']} — {v['titre']} [{v['statut']}]"):
            st.write(v)
            chemin = v.get("chemin_video")
            if chemin and Path(chemin).exists():
                st.video(chemin)
            if v["statut"] in {"pret", "montage_ok"} and st.button(
                "Uploader YouTube", key=f"yt_{v['id']}"
            ):
                try:
                    st.success(publish_youtube(v["id"], force=True))
                except Exception as exc:
                    st.error(str(exc))
