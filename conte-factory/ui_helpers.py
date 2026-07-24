"""Helpers UI — mood #d0bdff / gris clair + navigation sans page_link."""

from __future__ import annotations

import sys
import threading
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

# Reference couleur utilisateur : #d0bdff
THEME_CSS = """
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Fraunces:opsz,wght@9..144,600;9..144,700&display=swap');

:root {
  --lilac: #d0bdff;
  --lilac-deep: #8B6FD4;
  --lilac-ink: #3D2E6B;
  --grey-bg: #F5F4F8;
  --grey-card: #FFFFFF;
  --grey-line: #E2DFEA;
  --grey-text: #6A6478;
  --ink: #2A2438;
}

html, body, [class*="css"]  {
  font-family: 'DM Sans', sans-serif;
  color: var(--ink);
}

.stApp {
  background:
    radial-gradient(1000px 420px at 8% -8%, #d0bdff 0%, transparent 55%),
    radial-gradient(800px 360px at 100% 0%, #EDE6FF 0%, transparent 50%),
    linear-gradient(180deg, #FAF9FC 0%, #F3F1F7 100%);
}

[data-testid="stSidebar"] {
  background: linear-gradient(180deg, #3D2E6B 0%, #5A458C 100%);
  border-right: 1px solid #6E5A9E;
}
[data-testid="stSidebar"] * { color: #F7F5FB !important; }
[data-testid="stSidebar"] a { color: #d0bdff !important; font-weight: 700; }

h1, h2, h3 {
  font-family: 'Fraunces', Georgia, serif !important;
  color: var(--lilac-ink) !important;
}

div[data-testid="stMetric"] {
  background: var(--grey-card);
  border: 1px solid var(--grey-line);
  border-radius: 16px;
  padding: 12px 14px;
  box-shadow: 0 8px 22px rgba(61, 46, 107, 0.05);
}
div[data-testid="stMetric"] [data-testid="stMetricValue"] {
  color: var(--lilac-ink) !important;
  font-weight: 700;
}

.stButton > button[kind="primary"], .stButton > button {
  background: linear-gradient(135deg, #d0bdff 0%, #8B6FD4 100%) !important;
  color: #2A2438 !important;
  border: none !important;
  border-radius: 14px !important;
  font-weight: 700 !important;
  box-shadow: 0 8px 18px rgba(139, 111, 212, 0.28);
}
.stButton > button:disabled {
  background: #E5E1EE !important;
  color: #8A8499 !important;
  box-shadow: none !important;
}

.hero-card {
  background: linear-gradient(135deg, #FFFFFF 0%, #F4EFFC 100%);
  border: 1px solid var(--grey-line);
  border-radius: 20px;
  padding: 22px 24px;
  box-shadow: 0 12px 28px rgba(61, 46, 107, 0.06);
  margin-bottom: 1rem;
}
.section-label {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.72rem;
  color: var(--lilac-deep);
  font-weight: 700;
}
.nav-pill {
  display: inline-block;
  background: #d0bdff;
  color: #2A2438 !important;
  border-radius: 999px;
  padding: 10px 16px;
  font-weight: 700;
  text-decoration: none !important;
  margin: 4px 6px 4px 0;
}
.badge-soft {
  display: inline-block;
  background: #d0bdff;
  color: #2A2438;
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 0.85rem;
  font-weight: 700;
}
.progress-box {
  background: #fff;
  border: 1px solid var(--grey-line);
  border-radius: 16px;
  padding: 16px 18px;
  margin: 12px 0;
}
</style>
"""


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


def apply_theme() -> None:
    st.markdown(THEME_CSS, unsafe_allow_html=True)


def go_page(path: str) -> None:
    try:
        st.switch_page(path)
    except Exception:
        name = Path(path).stem
        slug = name.split("_", 1)[-1] if name[:1].isdigit() else name
        st.markdown(f"[Ouvrir {slug}](/{slug})")


def nav_buttons(current: str) -> None:
    c1, c2, c3 = st.columns(3)
    with c1:
        if st.button("Accueil", use_container_width=True, disabled=current == "Accueil"):
            go_page("dashboard.py")
    with c2:
        if st.button(
            "Suivi",
            use_container_width=True,
            disabled=current == "Suivi",
        ):
            go_page("pages/1_Tableau_de_bord.py")
    with c3:
        if st.button(
            "Creation",
            use_container_width=True,
            disabled=current == "Creation",
            type="primary",
        ):
            go_page("pages/2_Creation.py")


def boot_app(page_title: str = "video ia") -> dict:
    ensure_dirs()
    init_db()
    st.set_page_config(
        page_title=page_title,
        page_icon=str(ROOT / "assets" / "video-ia-icon.png"),
        layout="wide",
        initial_sidebar_state="expanded",
    )
    apply_theme()
    # Autorefresh uniquement sur Creation (progres), pas partout — accelere l'ouverture
    try:
        from streamlit_autorefresh import st_autorefresh as _ar

        if "Creation" in page_title or "creation" in page_title.lower():
            _ar(interval=4000, key="ui_refresh")
    except Exception:
        pass

    provider = VIDEO_PROVIDER.lower().strip()
    uses_wan = provider.startswith(("pinokio", "wan")) and provider not in {
        "wan_i2v",
    }
    uses_i2v = provider in {"i2v", "wan_i2v", "image2video", "img2vid"}
    uses_talking = provider in {"talking", "lipsync", "talk", "multitalk", "infinitetalk"}
    uses_images = provider in {"images", "image", "still", "stills", "invideo"}

    # Ne JAMAIS bloquer l'UI sur Wan/I2V au boot
    health = {"gradio_up": False}
    if uses_i2v:
        try:
            from modules.i2v_ai import i2v_health

            health = i2v_health()
            health["gradio_up"] = bool(health.get("gradio_up") or health.get("ready"))
        except Exception:
            health = {"gradio_up": False, "ready": False}
        if "i2v_boot_done" not in st.session_state:
            st.session_state["i2v_boot_done"] = True
            try:
                from config import AUTO_START_I2V, I2V_START_TIMEOUT_SEC
                from modules.i2v_service import ensure_i2v_running

                if AUTO_START_I2V:
                    threading.Thread(
                        target=lambda: ensure_i2v_running(
                            wait_seconds=min(I2V_START_TIMEOUT_SEC, 180)
                        ),
                        daemon=True,
                    ).start()
            except Exception:
                pass
    elif uses_wan:
        try:
            health = wan_status()
        except Exception:
            health = {"gradio_up": False}
        if AUTO_START_WAN and "wan_boot_done" not in st.session_state:
            st.session_state["wan_boot_done"] = True
            try:
                threading.Thread(
                    target=lambda: start_wan(wait_seconds=min(WAN_START_TIMEOUT_SEC, 120)),
                    daemon=True,
                ).start()
            except Exception:
                pass

    return {
        "health": health,
        "wan_ok": True
        if (uses_images or uses_talking or uses_i2v)
        else bool(health.get("gradio_up")),
        "uses_wan": uses_wan,
        "uses_i2v": uses_i2v,
        "uses_talking": uses_talking,
        "uses_images": uses_images,
        "channel": CHANNEL_NAME,
        "root": ROOT,
    }


def render_sidebar(active: str) -> None:
    st.sidebar.markdown("## video ia")
    st.sidebar.caption(CHANNEL_NAME)
    st.sidebar.markdown("---")
    st.sidebar.markdown("### Navigation")
    st.sidebar.markdown(
        """
<a class="nav-pill" href="/Tableau_de_bord" target="_blank">Suivi</a><br/>
<a class="nav-pill" href="/Creation" target="_blank">Creation</a>
""",
        unsafe_allow_html=True,
    )
    st.sidebar.markdown("---")
    st.sidebar.markdown(f"**Page :** {active}")


def render_engine_status(ctx: dict, key_prefix: str = "eng") -> None:
    """Statut moteur simplifie."""
    if ctx.get("uses_i2v"):
        st.metric("Moteur video", "Wan I2V (vraie animation)")
        st.caption(
            "TTS → image scene Pixar → Wan Image-to-Video → montage. "
            "Port 7861 si LANCER-I2V tourne."
        )
        return
    if ctx.get("uses_talking"):
        st.metric("Moteur video", "Talking (legacy lip-sync)")
        st.caption("Mode legacy. Prefere SWITCH-TO-I2V pour une vraie animation.")
        return
    if ctx.get("uses_images"):
        st.metric("Moteur video", "Images IA + montage (rapide)")
        st.caption("Mode rapide : 1 illustration / scene, zoom doux, assemblee sur la voix.")
        return
    wan_ok = ctx["wan_ok"]
    c1, c2 = st.columns([2, 1])
    c1.metric("Moteur video", "Pret" if wan_ok else "En preparation…")
    with c2:
        if not wan_ok and st.button("Relancer moteur", key=f"{key_prefix}_start"):
            st.session_state["wan_boot_result"] = start_wan(wait_seconds=WAN_START_TIMEOUT_SEC)
            st.session_state["wan_boot_done"] = True
            st.rerun()


def audio_preview_path(video: dict) -> Path | None:
    projet = Path(str(video.get("chemin_projet") or ""))
    narration = projet / "audio" / "narration.mp3"
    if narration.exists():
        return narration
    for p in projet.glob("**/scene_*.mp3"):
        return p
    return None


def mp4_path(video: dict) -> Path | None:
    chemin = video.get("chemin_video")
    if chemin and Path(str(chemin)).exists():
        return Path(str(chemin))
    return None
