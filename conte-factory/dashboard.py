"""Dashboard video ia — démarre Wan automatiquement, pilote le pipeline, suit YouTube.

Lancer (tout-en-un via l'icône Bureau « video ia ») :
  scripts\\DEMARRER-VIDEO-IA.bat
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
    AUTO_START_WAN,
    CHANNEL_NAME,
    EXPORTS_DIR,
    FAL_KEY,
    PINOKIO_WAN_URL,
    TARGET_DURATION_MIN,
    TTS_VOICE,
    VIDEO_PROVIDER,
    WAN_START_TIMEOUT_SEC,
    ensure_dirs,
    estimate_ai_clips,
)
from db.database import init_db, is_paused, list_videos, set_paused, stats
from main import run_pipeline
from modules.publish import publish_youtube
from modules.video_ai import pinokio_wan_health
from modules.wan_service import start_wan, stop_wan, wan_status

ensure_dirs()
init_db()

st.set_page_config(
    page_title="video ia",
    page_icon=str(ROOT / "assets" / "video-ia-icon.png"),
    layout="wide",
)

try:
    from streamlit_autorefresh import st_autorefresh as _ar

    _ar(interval=5000, key="wan_live_refresh")
except Exception:
    pass

st.title(f"🎬 video ia — {CHANNEL_NAME}")
st.caption(
    "Un seul clic Bureau → Wan + dashboard + pipeline automatique jusqu'à YouTube"
)

provider = VIDEO_PROVIDER.lower().strip()
uses_wan = provider.startswith(("pinokio", "wan"))

# --- Démarrage auto Wan au chargement ---
if uses_wan and AUTO_START_WAN and "wan_boot_done" not in st.session_state:
    with st.spinner("Démarrage automatique de Wan (GPU NVIDIA)…"):
        boot = start_wan(wait_seconds=WAN_START_TIMEOUT_SEC)
        st.session_state["wan_boot_done"] = True
        st.session_state["wan_boot_result"] = boot

if st.session_state.get("wan_boot_result"):
    boot = st.session_state["wan_boot_result"]
    if boot.get("ok"):
        if boot.get("started"):
            st.success("Wan démarré automatiquement — plus besoin de LANCER-WAN-NVIDIA.bat")
        elif boot.get("already_running"):
            st.info("Wan était déjà en ligne")
    else:
        st.error(
            f"Wan n'a pas pu démarrer : {boot.get('error', 'erreur inconnue')}. "
            f"Voir `{boot.get('log_file', 'data/wan_server.log')}`"
        )

health = wan_status()
s = stats()
wan_ok = bool(health.get("gradio_up"))

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
        + (f" (PID {health.get('pid')})" if health.get("pid") else "")
    )
else:
    st.warning(
        "Wan n'est pas encore prêt. Utilise le bouton **Démarrer Wan** ci-dessous "
        "ou relance l'icône Bureau **video ia**."
    )
    if health.get("gradio_error"):
        st.caption(health["gradio_error"])

wan_ctrl1, wan_ctrl2, wan_ctrl3, wan_ctrl4 = st.columns(4)
with wan_ctrl1:
    if st.button("▶ Démarrer Wan", use_container_width=True, disabled=wan_ok):
        with st.spinner("Démarrage Wan…"):
            result = start_wan(wait_seconds=WAN_START_TIMEOUT_SEC)
            st.session_state["wan_boot_result"] = result
            st.rerun()
with wan_ctrl2:
    if st.button("⏹ Arrêter Wan", use_container_width=True, disabled=not health.get("managed")):
        stop_wan()
        st.session_state.pop("wan_boot_done", None)
        st.session_state.pop("wan_boot_result", None)
        st.rerun()
with wan_ctrl3:
    if st.button("🔄 Rafraîchir", use_container_width=True):
        st.rerun()
with wan_ctrl4:
    st.link_button("Ouvrir Wan (7860)", PINOKIO_WAN_URL, use_container_width=True)

with st.expander("Détails connexion Wan (live)", expanded=not wan_ok):
    st.json(
        {
            "gradio_up": health.get("gradio_up"),
            "gradio_url": health.get("gradio_url"),
            "gradio_title": health.get("gradio_title"),
            "pid": health.get("pid"),
            "process_alive": health.get("process_alive"),
            "managed": health.get("managed"),
            "log_file": health.get("log_file"),
            "engine": health.get("engine"),
            "ready_for_pipeline": health.get("ready_for_pipeline"),
            "provider": VIDEO_PROVIDER,
            "auto_start_wan": AUTO_START_WAN,
            "target_min": TARGET_DURATION_MIN,
            "clips_estimes": estimate_ai_clips(),
            "ai_clip_sec": AI_CLIP_SEC,
            "auto_publish": AUTO_PUBLISH,
            "voix": TTS_VOICE,
        }
    )
    if st.button("🔍 Check GPU profond", key="deep_health_btn"):
        st.session_state["deep_health"] = pinokio_wan_health(deep=True)
    if st.session_state.get("deep_health"):
        st.write(st.session_state["deep_health"])

st.divider()

tab_pilot, tab_wan, tab_exports, tab_auto = st.tabs(
    ["Piloter le pipeline", "Wan en direct (7860)", "Exports réels", "Automatisation 100%"]
)

with tab_wan:
    st.subheader("Interface Wan intégrée")
    if wan_ok:
        components.iframe(PINOKIO_WAN_URL, height=720, scrolling=True)
    else:
        st.warning("Clique **Démarrer Wan** — le moteur vidéo se lance tout seul.")

with tab_exports:
    st.subheader("Fichiers MP4 générés (disque)")
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    exports = sorted(EXPORTS_DIR.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not exports:
        st.info("Aucun export pour l'instant — lance une génération.")
    else:
        for mp4 in exports[:8]:
            st.write(f"**{mp4.name}** — {mp4.stat().st_size / 1e6:.1f} Mo")
            try:
                st.video(str(mp4))
            except Exception as exc:
                st.caption(f"Lecture impossible: {exc}")

with tab_auto:
    st.subheader("Automatisation complète (script → YouTube)")
    st.markdown(
        """
        **Architecture recommandée (PC NVIDIA, pas VPS sans GPU) :**

        | Composant | Où ça tourne | Rôle |
        |---|---|---|
        | Wan 2.1 | PC tour NVIDIA | Génère les clips vidéo IA |
        | Pipeline `main.py` | Même PC | Script → audio → montage → YouTube |
        | Dashboard **video ia** | Même PC (port 8501) | Suivi matinal + contrôle |

        > Un VPS OVH **sans carte graphique** ne peut pas faire tourner Wan.
        > Garde le moteur vidéo sur ton PC NVIDIA ; le dashboard et le pipeline y tournent aussi.
        > Pour un accès distant au dashboard : tunnel Cloudflare/ngrok (optionnel).
        """
    )
    st.code(
        r"""# Installation automatisation Windows (une fois)
powershell -ExecutionPolicy Bypass -File scripts\install-windows-autostart.ps1

# Ce que ça configure :
# - Au démarrage Windows : Wan + dashboard video ia
# - Chaque nuit 02:00 : pipeline complet jusqu'à YouTube""",
        language="powershell",
    )
    st.markdown(
        f"- Publication auto : **{'activée' if AUTO_PUBLISH else 'désactivée'}** (`CONTE_AUTO_PUBLISH`)\n"
        f"- Démarrage auto Wan : **{'activé' if AUTO_START_WAN else 'désactivé'}** (`CONTE_AUTO_START_WAN`)\n"
        f"- Guide détaillé : `PLAN-1-JOUR-COMPLET.md`"
    )

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
    mode_short = st.checkbox("Test court (recommandé d'abord)", value=True)
    no_publish = st.checkbox("Ne pas publier sur ce run", value=not AUTO_PUBLISH)

    pipeline_disabled = uses_wan and not wan_ok
    if st.button(
        "✨ Lancer pipeline complet (Wan → montage → YouTube)",
        type="primary",
        use_container_width=True,
        disabled=pipeline_disabled,
    ):
        if is_paused():
            st.error("Pipeline en pause.")
        elif VIDEO_PROVIDER == "fal" and not FAL_KEY:
            st.error("Ajoute FAL_KEY dans .env.")
        elif pipeline_disabled:
            st.error("Wan hors ligne — clique Démarrer Wan")
        else:
            progress = st.progress(0, text="Démarrage…")
            try:
                progress.progress(10, text="Script + storyboard + audio + clips Wan…")
                result = run_pipeline(
                    theme=theme or None,
                    short=mode_short,
                    publish=False if no_publish else None,
                )
                progress.progress(100, text="Terminé")
                if result.get("ok"):
                    st.success("Pipeline terminé.")
                else:
                    st.warning(str(result))
                st.json(result)
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
