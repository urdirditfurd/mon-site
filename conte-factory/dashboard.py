"""Dashboard video ia — 2 parties claires :

1) Tableau de bord : suivi, YouTube, creation
2) Technique : historique, process, timings, fichiers

Lancer : scripts\\DEMARRER-VIDEO-IA.bat
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
)
from db.database import (
    STATUT_LABELS,
    init_db,
    is_paused,
    list_videos,
    set_paused,
    stats,
    video_process_detail,
    video_title,
)
from main import run_pipeline
from modules.publish import publish_youtube
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

    _ar(interval=8000, key="wan_live_refresh")
except Exception:
    pass


def _fmt_min(sec: float | None) -> str:
    if sec is None:
        return "—"
    if sec < 60:
        return f"{sec:.0f} s"
    return f"{sec / 60:.1f} min"


def _statut_badge(statut: str | None) -> str:
    s = str(statut or "?")
    label = STATUT_LABELS.get(s, s)
    if s == "publie":
        return f"🟢 {label}"
    if s == "erreur":
        return f"🔴 {label}"
    if s in {"pret", "montage_ok", "video_prete"}:
        return f"🟡 {label}"
    return f"🔵 {label}"


# ---------------------------------------------------------------------------
# En-tete + Wan
# ---------------------------------------------------------------------------
st.title(f"video ia — {CHANNEL_NAME}")
st.caption("Creation automatique : histoire → Wan → montage → YouTube")

provider = VIDEO_PROVIDER.lower().strip()
uses_wan = provider.startswith(("pinokio", "wan"))

if uses_wan and AUTO_START_WAN and "wan_boot_done" not in st.session_state:
    with st.spinner("Demarrage automatique de Wan (GPU)…"):
        boot = start_wan(wait_seconds=min(WAN_START_TIMEOUT_SEC, 120))
        st.session_state["wan_boot_done"] = True
        st.session_state["wan_boot_result"] = boot

health = wan_status()
s = stats()
wan_ok = bool(health.get("gradio_up"))

m1, m2, m3, m4, m5, m6 = st.columns(6)
m1.metric("Wan", "EN LIGNE" if wan_ok else "HORS LIGNE")
m2.metric("Creees", s["total"])
m3.metric("Pretes", s.get("pretes", 0))
m4.metric("Publiees YT", s["publiees"])
m5.metric("Erreurs", s["erreurs"])
m6.metric("Pipeline", "Pause" if s["pause"] else "Actif")

c1, c2, c3, c4 = st.columns(4)
with c1:
    if st.button("Demarrer Wan", use_container_width=True, disabled=wan_ok):
        with st.spinner("Demarrage Wan…"):
            st.session_state["wan_boot_result"] = start_wan(wait_seconds=WAN_START_TIMEOUT_SEC)
            st.rerun()
with c2:
    if st.button("Arreter Wan", use_container_width=True, disabled=not health.get("managed")):
        stop_wan()
        st.session_state.pop("wan_boot_done", None)
        st.rerun()
with c3:
    if st.button("Rafraichir", use_container_width=True):
        st.rerun()
with c4:
    st.link_button("Ouvrir Wan 7860", PINOKIO_WAN_URL, use_container_width=True)

if not wan_ok and uses_wan:
    st.warning("Wan hors ligne — demarre-le avant de creer une video.")
    boot = st.session_state.get("wan_boot_result") or {}
    if boot.get("log_tail"):
        with st.expander("Log Wan"):
            st.code(boot["log_tail"])

# ---------------------------------------------------------------------------
# 2 PARTIES
# ---------------------------------------------------------------------------
tab_dash, tab_tech = st.tabs(
    [
        "1. Tableau de bord",
        "2. Technique & historique",
    ]
)

# ========================= PARTIE 1 : TABLEAU DE BORD =========================
with tab_dash:
    st.subheader("Vue d'ensemble")
    left, right = st.columns([1.2, 1])

    with left:
        st.markdown("#### Derniere video")
        derniere = s.get("derniere")
        if not derniere:
            st.info("Aucune video en base. Lance une creation ci-dessous.")
        else:
            titre = video_title(derniere)
            duree = derniere.get("duree_sec") or 0
            st.write(f"**Titre :** {titre}")
            st.write(f"**Statut :** {_statut_badge(derniere.get('statut'))}")
            st.write(f"**Theme :** {derniere.get('theme') or '—'}")
            st.write(f"**Duree video :** {_fmt_min(duree) if duree else '—'}")
            if derniere.get("chemin_video") and Path(str(derniere["chemin_video"])).exists():
                st.video(str(derniere["chemin_video"]))
            if derniere.get("youtube_id"):
                yt = f"https://youtu.be/{derniere['youtube_id']}"
                st.write(f"**YouTube :** [{yt}]({yt})")
                st.caption("Les vues detaillees necessitent YouTube Analytics (a brancher plus tard).")
            if derniere.get("erreur"):
                st.error(derniere["erreur"])

    with right:
        st.markdown("#### Indicateurs chaine")
        st.write(f"- Videos creees : **{s['total']}**")
        st.write(f"- Pretes a publier : **{s.get('pretes', 0)}**")
        st.write(f"- Publiees YouTube : **{s['publiees']}**")
        st.write(f"- En cours : **{s.get('en_cours', 0)}**")
        st.write(f"- Erreurs : **{s['erreurs']}**")
        st.write(
            f"- Duree moyenne de creation : "
            f"**{_fmt_min(s.get('duree_creation_moyenne_sec'))}**"
        )
        st.write(f"- Voix : `{TTS_VOICE}`")
        st.write(f"- Duree cible : **{TARGET_DURATION_MIN} min**")
        st.write(f"- Publication auto : **{'oui' if AUTO_PUBLISH else 'non'}**")

        st.markdown("#### Alertes")
        if not s.get("alertes"):
            st.success("Rien a signaler.")
        else:
            for a in s["alertes"]:
                st.warning(f"#{a.get('video_id')} — {a.get('message')}")

    st.divider()
    st.subheader("Creer une video")
    col_a, col_b = st.columns(2)
    with col_a:
        if st.button("Mettre en pause", use_container_width=True):
            set_paused(True)
            st.rerun()
    with col_b:
        if st.button("Reprendre", use_container_width=True):
            set_paused(False)
            st.rerun()

    theme = st.text_input(
        "Theme du conte",
        placeholder="ex: un dragon timide qui crache des bulles",
        help="Laisse vide pour un theme aleatoire.",
    )
    mode = st.radio(
        "Mode",
        options=["Test court (3-5 min)", "Video complete (30 min)"],
        index=0,
        horizontal=True,
    )
    no_publish = st.checkbox(
        "Ne pas publier sur YouTube pour ce lancement",
        value=True,
        help="Decoche seulement quand client_secrets.json est pret.",
    )

    short = mode.startswith("Test")
    disabled = uses_wan and not wan_ok
    if st.button(
        "Lancer la creation (script → Wan → montage → YouTube)",
        type="primary",
        use_container_width=True,
        disabled=disabled,
    ):
        if is_paused():
            st.error("Pipeline en pause — clique Reprendre.")
        elif VIDEO_PROVIDER == "fal" and not FAL_KEY:
            st.error("FAL_KEY manquant dans .env")
        elif disabled:
            st.error("Wan hors ligne.")
        else:
            bar = st.progress(0, text="Demarrage…")
            try:
                bar.progress(15, text="Histoire + storyboard + audio…")
                result = run_pipeline(
                    theme=theme or None,
                    short=short,
                    publish=False if no_publish else None,
                )
                bar.progress(100, text="Termine")
                if result.get("ok"):
                    st.success("Creation terminee.")
                else:
                    st.warning(result)
                with st.expander("Resultat brut"):
                    st.json(result)
                st.rerun()
            except Exception as exc:
                bar.progress(100, text="Erreur")
                st.exception(exc)

    st.divider()
    st.subheader("Publications YouTube")
    ready = [
        v
        for v in list_videos(40)
        if v and v.get("statut") in {"pret", "montage_ok", "video_prete", "publie"}
    ]
    if not ready:
        st.info("Aucune video prete. Lance d'abord un Test court.")
    else:
        for v in ready[:12]:
            cols = st.columns([3, 1.2, 1.2, 1.5])
            cols[0].write(f"**#{v['id']}** — {video_title(v)}")
            cols[1].write(_statut_badge(v.get("statut")))
            cols[2].write(_fmt_min(v.get("duree_sec")))
            with cols[3]:
                if v.get("youtube_id"):
                    st.link_button("Voir YT", f"https://youtu.be/{v['youtube_id']}")
                elif v.get("statut") != "publie" and st.button(
                    "Publier", key=f"pub_{v['id']}"
                ):
                    try:
                        out = publish_youtube(int(v["id"]), force=True)
                        st.success(out)
                        st.rerun()
                    except Exception as exc:
                        st.error(str(exc))

# ========================= PARTIE 2 : TECHNIQUE =========================
with tab_tech:
    st.subheader("Historique & process de creation")
    st.caption(
        "Script, audio, clips Wan, montage, durees. Sous-titres : desactives (audio suffit)."
    )

    videos = list_videos(50)
    if not videos:
        st.info("Aucune video — rien a afficher.")
    else:
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
        k4.metric("Duree video", _fmt_min(v.get("duree_sec")))
        k5.metric("Temps creation", _fmt_min(detail.get("duree_creation_sec")))

        st.markdown("#### Criteres de fabrication")
        c_a, c_b, c_c, c_d = st.columns(4)
        c_a.write(f"Storyboard : {'OK' if detail.get('storyboard') else 'non'}")
        c_b.write(f"Audio TTS : {'OK' if detail.get('audio') else 'non'}")
        c_c.write(f"Montage MP4 : {'OK' if detail.get('montage') else 'non'}")
        c_d.write(f"Sous-titres : non (choix projet)")

        st.markdown("#### Theme & identifiants")
        st.write(f"- **Theme :** {v.get('theme') or '—'}")
        st.write(f"- **Titre :** {video_title(v)}")
        st.write(f"- **Hash anti-doublon :** `{str(v.get('hash_script') or '')[:16]}…`")
        st.write(f"- **Projet :** `{v.get('chemin_projet') or '—'}`")
        if v.get("youtube_id"):
            st.write(f"- **YouTube ID :** `{v['youtube_id']}`")
        if v.get("erreur"):
            st.error(v["erreur"])

        st.markdown("#### Script (apercu)")
        if detail.get("script_apercu"):
            st.text(detail["script_apercu"])
        else:
            st.caption("Pas de script.json trouve pour ce projet.")

        st.markdown("#### Journal d'evenements")
        events = detail.get("events") or []
        if not events:
            st.caption("Aucun evenement enregistre.")
        else:
            for e in events[-20:]:
                st.write(
                    f"`{str(e.get('created_at') or '')[11:19]}` "
                    f"**{e.get('niveau')}** — {e.get('message')}"
                )

        chemin = v.get("chemin_video")
        if chemin and Path(str(chemin)).exists():
            st.markdown("#### Lecture")
            st.video(str(chemin))
            if v.get("statut") in {"pret", "montage_ok", "video_prete"}:
                if st.button("Uploader cette video sur YouTube", key=f"yt_tech_{vid}"):
                    try:
                        st.success(publish_youtube(vid, force=True))
                        st.rerun()
                    except Exception as exc:
                        st.error(str(exc))

    st.divider()
    st.subheader("Exports MP4 sur disque")
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    exports = sorted(EXPORTS_DIR.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not exports:
        st.caption("Aucun fichier dans data/exports.")
    else:
        for mp4 in exports[:6]:
            st.write(f"**{mp4.name}** — {mp4.stat().st_size / 1e6:.1f} Mo")
            try:
                st.video(str(mp4))
            except Exception as exc:
                st.caption(str(exc))

    with st.expander("Wan en direct + automatisation"):
        if wan_ok:
            components.iframe(PINOKIO_WAN_URL, height=480, scrolling=True)
        else:
            st.warning("Wan hors ligne.")
        st.markdown(
            """
            **Automatisation nuit :**
            ```powershell
            powershell -ExecutionPolicy Bypass -File scripts\\install-windows-autostart.ps1
            ```
            - Login Windows → Wan + dashboard
            - 02:00 → pipeline complet jusqu'a YouTube
            """
        )
