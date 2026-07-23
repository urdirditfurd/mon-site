"""Helpers UI — theme violet / gris clair + navigation compatible toutes versions Streamlit."""

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

THEME_CSS = """
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Fraunces:opsz,wght@9..144,600;9..144,700&display=swap');

:root {
  --violet: #6B4EFF;
  --violet-deep: #4A35C8;
  --violet-soft: #EDE9FE;
  --violet-mid: #A78BFA;
  --grey-bg: #F3F1F7;
  --grey-card: #FFFFFF;
  --grey-line: #D8D4E4;
  --grey-text: #5C5670;
  --ink: #1F1833;
}

html, body, [class*="css"] {
  font-family: 'DM Sans', sans-serif;
  color: var(--ink);
}

.stApp {
  background:
    radial-gradient(1200px 500px at 10% -10%, #EDE9FE 0%, transparent 55%),
    radial-gradient(900px 400px at 100% 0%, #E8E4F5 0%, transparent 45%),
    linear-gradient(180deg, #F7F5FB 0%, #F0EEF5 100%);
}

[data-testid="stSidebar"] {
  background: linear-gradient(180deg, #2B2148 0%, #3D2E6B 55%, #4A3A7A 100%);
  border-right: 1px solid #5B4A8A;
}
[data-testid="stSidebar"] * {
  color: #F3F1F7 !important;
}
[data-testid="stSidebar"] a {
  color: #D6C9FF !important;
  text-decoration: none;
  font-weight: 600;
}
[data-testid="stSidebar"] .stMarkdown p {
  color: #C9C2DC !important;
}

h1, h2, h3 {
  font-family: 'Fraunces', Georgia, serif !important;
  color: var(--ink) !important;
  letter-spacing: -0.02em;
}

div[data-testid="stMetric"] {
  background: var(--grey-card);
  border: 1px solid var(--grey-line);
  border-radius: 16px;
  padding: 12px 14px;
  box-shadow: 0 8px 24px rgba(75, 53, 160, 0.06);
}
div[data-testid="stMetric"] label {
  color: var(--grey-text) !important;
}
div[data-testid="stMetric"] [data-testid="stMetricValue"] {
  color: var(--violet-deep) !important;
  font-weight: 700;
}

.stButton > button {
  background: linear-gradient(135deg, var(--violet) 0%, var(--violet-deep) 100%) !important;
  color: white !important;
  border: none !important;
  border-radius: 12px !important;
  font-weight: 600 !important;
  box-shadow: 0 8px 20px rgba(107, 78, 255, 0.25);
}
.stButton > button:hover {
  filter: brightness(1.05);
  box-shadow: 0 10px 24px rgba(107, 78, 255, 0.35);
}
.stButton > button:disabled {
  background: #C9C2DC !important;
  color: #6B657F !important;
  box-shadow: none !important;
}

.hero-card {
  background: linear-gradient(135deg, #FFFFFF 0%, #F4F1FC 100%);
  border: 1px solid var(--grey-line);
  border-radius: 20px;
  padding: 22px 24px;
  box-shadow: 0 12px 32px rgba(47, 30, 110, 0.07);
  margin-bottom: 1rem;
}
.hero-card h3 {
  margin: 0 0 8px 0;
  color: var(--violet-deep) !important;
}
.hero-card p {
  color: var(--grey-text);
  margin: 0 0 14px 0;
}
.nav-pill {
  display: inline-block;
  background: var(--violet-soft);
  color: var(--violet-deep) !important;
  border: 1px solid #D4CCF5;
  border-radius: 999px;
  padding: 10px 18px;
  font-weight: 700;
  text-decoration: none !important;
  margin-right: 8px;
  margin-bottom: 8px;
}
.nav-pill:hover {
  background: #DDD6FE;
}
.badge-soft {
  display: inline-block;
  background: var(--violet-soft);
  color: var(--violet-deep);
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 0.85rem;
  font-weight: 600;
}
.section-label {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.75rem;
  color: var(--violet-mid);
  font-weight: 700;
  margin-bottom: 6px;
}
hr {
  border: none;
  border-top: 1px solid var(--grey-line);
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
    """Navigation compatible — evite st.page_link (bug url_pathname)."""
    try:
        st.switch_page(path)
    except Exception:
        # Fallback markdown (multipage Streamlit)
        name = Path(path).stem
        # 1_Tableau_de_bord → Tableau_de_bord
        slug = name.split("_", 1)[-1] if name[:1].isdigit() else name
        st.markdown(f"[Ouvrir {slug}](/{slug})")


def nav_buttons(current: str) -> None:
    c1, c2, c3 = st.columns(3)
    with c1:
        if st.button("Accueil", use_container_width=True, disabled=current == "Accueil"):
            go_page("dashboard.py")
    with c2:
        if st.button(
            "1 · Tableau de bord",
            use_container_width=True,
            disabled=current == "Tableau",
            type="primary" if current != "Tableau" else "secondary",
        ):
            go_page("pages/1_Tableau_de_bord.py")
    with c3:
        if st.button(
            "2 · Technique",
            use_container_width=True,
            disabled=current == "Technique",
            type="primary" if current != "Technique" else "secondary",
        ):
            go_page("pages/2_Technique.py")


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
    try:
        from streamlit_autorefresh import st_autorefresh as _ar

        _ar(interval=12000, key="ui_refresh")
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
    st.sidebar.markdown("## video ia")
    st.sidebar.caption(CHANNEL_NAME)
    st.sidebar.markdown("---")
    st.sidebar.markdown("### Deux fenetres")
    st.sidebar.markdown(
        """
Ouvre chaque page dans un **onglet separe** (clic droit → nouvel onglet) :

<a class="nav-pill" href="/Tableau_de_bord" target="_blank">📊 Tableau de bord</a><br/>
<a class="nav-pill" href="/Technique" target="_blank">🔧 Technique</a>
""",
        unsafe_allow_html=True,
    )
    st.sidebar.markdown("---")
    st.sidebar.markdown(f"**Page :** {active}")


def render_wan_bar(ctx: dict, key_prefix: str = "wan") -> None:
    health = ctx["health"]
    wan_ok = ctx["wan_ok"]
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Wan", "EN LIGNE" if wan_ok else "HORS LIGNE")
    with c2:
        if st.button("Demarrer Wan", disabled=wan_ok, key=f"{key_prefix}_start"):
            st.session_state["wan_boot_result"] = start_wan(wait_seconds=WAN_START_TIMEOUT_SEC)
            st.rerun()
    with c3:
        if st.button(
            "Arreter Wan",
            disabled=not health.get("managed"),
            key=f"{key_prefix}_stop",
        ):
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
    for p in projet.glob("**/scene_*.mp3"):
        return p
    return None


def mp4_path(video: dict) -> Path | None:
    chemin = video.get("chemin_video")
    if chemin and Path(str(chemin)).exists():
        return Path(str(chemin))
    return None
