"""Helpers UI partagés — Tableau de bord & Technique."""

from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import (
    AUTO_START_WAN,
    CHANNEL_NAME,
    VIDEO_PROVIDER,
    WAN_START_TIMEOUT_SEC,
    ensure_dirs,
)
from db.database import init_db, video_title
from modules.wan_service import start_wan, stop_wan, wan_status

try:
    from db.database import STATUT_LABELS
except ImportError:
    STATUT_LABELS = {
        "nouveau": "Nouveau",
        "script_ok": "Script pret",
        "storyboard_ok": "Storyboard pret",
        "audio_ok": "Audio pret",
        "images_ok": "Clips IA prets",
        "montage_ok": "Montage OK",
        "pret": "Pret a publier",
        "publie": "Publie YouTube",
        "erreur": "Erreur",
        "pause": "Pause",
    }

# statut → prochaine etape main.py
RESUME_STEP = {
    "nouveau": "storyboard",
    "script_ok": "storyboard",
    "storyboard_ok": "audio",
    "audio_ok": "video_ai",
    "images_ok": "montage",
    "montage_ok": "publish",
    "pret": "publish",
    "video_prete": "publish",
}


def fmt_min(sec: float | None) -> str:
    if sec is None:
        return "—"
    if sec < 60:
        return f"{sec:.0f} s"
    return f"{sec / 60:.1f} min"


def statut_badge(statut: str | None) -> str:
    s = str(statut or "?")
    label = STATUT_LABELS.get(s, s)
    if s == "publie":
        return f"🟢 {label}"
    if s == "erreur":
        return f"🔴 {label}"
    if s in {"pret", "montage_ok", "video_prete"}:
        return f"🟡 {label}"
    return f"🔵 {label}"


def next_step_for(statut: str | None) -> str | None:
    return RESUME_STEP.get(str(statut or ""))


def boot_app() -> dict:
    ensure_dirs()
    init_db()
    st.set_page_config(
        page_title="video ia",
        page_icon=str(ROOT / "assets" / "video-ia-icon.png"),
        layout="wide",
        initial_sidebar_state="expanded",
    )
    try:
        from streamlit_autorefresh import st_autorefresh as _ar

        _ar(interval=10000, key="ui_refresh")
    except Exception:
        pass

    provider = VIDEO_PROVIDER.lower().strip()
    uses_wan = provider.startswith(("pinokio", "wan"))
    if uses_wan and AUTO_START_WAN and "wan_boot_done" not in st.session_state:
        with st.spinner("Demarrage Wan…"):
            st.session_state["wan_boot_result"] = start_wan(
                wait_seconds=min(WAN_START_TIMEOUT_SEC, 90)
            )
            st.session_state["wan_boot_done"] = True

    health = wan_status()
    return {
        "health": health,
        "wan_ok": bool(health.get("gradio_up")),
        "uses_wan": uses_wan,
        "channel": CHANNEL_NAME,
        "root": ROOT,
    }


def render_sidebar(active: str) -> None:
    st.sidebar.title("video ia")
    st.sidebar.caption(CHANNEL_NAME)
    st.sidebar.markdown("---")
    st.sidebar.markdown("### Deux fenetres")
    st.sidebar.markdown(
        """
        Ouvre chaque page dans un **onglet navigateur separe** :

        - [Tableau de bord](/Tableau_de_bord) ← suivi & creation
        - [Technique](/Technique) ← historique & details
        """
    )
    st.sidebar.markdown("---")
    st.sidebar.info(f"Page actuelle : **{active}**")


def render_wan_bar(ctx: dict) -> None:
    health = ctx["health"]
    wan_ok = ctx["wan_ok"]
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Wan", "EN LIGNE" if wan_ok else "HORS LIGNE")
    with c2:
        if st.button("Demarrer Wan", disabled=wan_ok, key=f"wan_start_{id(ctx)}"):
            st.session_state["wan_boot_result"] = start_wan(wait_seconds=WAN_START_TIMEOUT_SEC)
            st.rerun()
    with c3:
        if st.button("Arreter Wan", disabled=not health.get("managed"), key=f"wan_stop_{id(ctx)}"):
            stop_wan()
            st.session_state.pop("wan_boot_done", None)
            st.rerun()
    with c4:
        st.link_button("Wan 7860", "http://127.0.0.1:7860")


def audio_preview_path(video: dict) -> Path | None:
    projet = Path(str(video.get("chemin_projet") or ""))
    narration = projet / "audio" / "narration.mp3"
    if narration.exists():
        return narration
    # Qwen layout
    for p in projet.glob("**/scene_*.mp3"):
        return p
    return None


def mp4_path(video: dict) -> Path | None:
    chemin = video.get("chemin_video")
    if chemin and Path(str(chemin)).exists():
        return Path(str(chemin))
    return None


__all__ = [
    "ROOT",
    "STATUT_LABELS",
    "audio_preview_path",
    "boot_app",
    "fmt_min",
    "mp4_path",
    "next_step_for",
    "render_sidebar",
    "render_wan_bar",
    "statut_badge",
    "video_title",
]
