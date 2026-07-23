"""Fenetre 1 — Tableau de bord (suivi + creation + YouTube)."""

from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import AUTO_PUBLISH, FAL_KEY, TARGET_DURATION_MIN, TTS_VOICE, VIDEO_PROVIDER
from db.database import is_paused, list_videos, set_paused, stats
from main import run_pipeline
from modules.publish import publish_youtube
from ui_helpers import (
    audio_preview_path,
    boot_app,
    fmt_min,
    mp4_path,
    next_step_for,
    render_sidebar,
    render_wan_bar,
    statut_badge,
    video_title,
)

ctx = boot_app()
render_sidebar("Tableau de bord")

st.title("1. Tableau de bord")
st.caption("Suivi chaine · creation · publication YouTube")
render_wan_bar(ctx)

s = stats()
m1, m2, m3, m4, m5 = st.columns(5)
m1.metric("Creees", s["total"])
m2.metric("Pretes", s.get("pretes", 0))
m3.metric("Publiees YT", s["publiees"])
m4.metric("En cours", s.get("en_cours", 0))
m5.metric("Erreurs", s["erreurs"])

st.page_link("pages/2_Technique.py", label="Ouvrir la fenetre Technique →", icon="🔧")

left, right = st.columns([1.3, 1])
with left:
    st.subheader("Derniere video")
    derniere = s.get("derniere")
    if not derniere:
        st.info("Aucune video. Lance une creation ci-dessous.")
    else:
        st.write(f"**Titre :** {video_title(derniere)}")
        st.write(f"**Statut :** {statut_badge(derniere.get('statut'))}")
        st.write(f"**Theme :** {derniere.get('theme') or '—'}")
        st.write(f"**Duree audio/video :** {fmt_min(derniere.get('duree_sec'))}")

        mp4 = mp4_path(derniere)
        audio = audio_preview_path(derniere)
        if mp4:
            st.success("MP4 pret — tu peux visionner ici :")
            st.video(str(mp4))
        elif audio:
            st.warning(
                "Pas encore de film MP4. L'audio est pret — "
                "il manque encore les **clips Wan** + **montage**."
            )
            st.audio(str(audio))
            step = next_step_for(derniere.get("statut"))
            if step and st.button(
                f"Continuer cette video (etape: {step})",
                type="primary",
                key="resume_last",
            ):
                if not ctx["wan_ok"] and step == "video_ai":
                    st.error("Wan hors ligne — demarre Wan d'abord.")
                else:
                    with st.spinner(f"Reprise depuis {step}…"):
                        try:
                            result = run_pipeline(
                                resume_id=int(derniere["id"]),
                                only=step,
                                publish=False,
                            )
                            st.success("Reprise terminee.")
                            st.json(result)
                            st.rerun()
                        except Exception as exc:
                            st.exception(exc)
        else:
            st.info("Aucun apercu audio/video pour l'instant.")

        if derniere.get("youtube_id"):
            yt = f"https://youtu.be/{derniere['youtube_id']}"
            st.write(f"**YouTube :** [{yt}]({yt})")
        if derniere.get("erreur"):
            st.error(derniere["erreur"])

with right:
    st.subheader("Indicateurs")
    st.write(f"- Duree moyenne de creation : **{fmt_min(s.get('duree_creation_moyenne_sec'))}**")
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
pa, pb = st.columns(2)
with pa:
    if st.button("Mettre en pause", use_container_width=True):
        set_paused(True)
        st.rerun()
with pb:
    if st.button("Reprendre le pipeline", use_container_width=True):
        set_paused(False)
        st.rerun()

theme = st.text_input("Theme du conte", placeholder="ex: un dragon timide")
mode = st.radio(
    "Mode",
    ["Test court (recommandé)", "Video complete (30 min)"],
    horizontal=True,
)
no_publish = st.checkbox("Ne pas publier sur YouTube", value=True)
short = mode.startswith("Test")
disabled = ctx["uses_wan"] and not ctx["wan_ok"]

if st.button(
    "Lancer creation complete",
    type="primary",
    use_container_width=True,
    disabled=disabled,
):
    if is_paused():
        st.error("Pipeline en pause.")
    elif VIDEO_PROVIDER == "fal" and not FAL_KEY:
        st.error("FAL_KEY manquant.")
    elif disabled:
        st.error("Wan hors ligne.")
    else:
        bar = st.progress(0, text="Demarrage…")
        try:
            bar.progress(20, text="Histoire → audio → Wan → montage…")
            result = run_pipeline(
                theme=theme or None,
                short=short,
                publish=False if no_publish else None,
            )
            bar.progress(100, text="Termine")
            if result.get("ok"):
                st.success("Creation terminee — le MP4 apparaitra ici si le montage a reussi.")
            else:
                st.warning(result)
            st.json(result)
            st.rerun()
        except Exception as exc:
            st.exception(exc)

st.divider()
st.subheader("Videos a reprendre / publier")
videos = list_videos(30)
if not videos:
    st.caption("Aucune video.")
else:
    for v in videos:
        if not v:
            continue
        cols = st.columns([3, 1.4, 1.2, 1.6])
        cols[0].write(f"**#{v['id']}** {video_title(v)}")
        cols[1].write(statut_badge(v.get("statut")))
        cols[2].write(fmt_min(v.get("duree_sec")))
        with cols[3]:
            mp4 = mp4_path(v)
            step = next_step_for(v.get("statut"))
            if mp4:
                if v.get("youtube_id"):
                    st.link_button("YT", f"https://youtu.be/{v['youtube_id']}")
                elif v.get("statut") in {"pret", "montage_ok", "video_prete"}:
                    if st.button("Publier", key=f"pub_{v['id']}"):
                        try:
                            st.success(publish_youtube(int(v["id"]), force=True))
                            st.rerun()
                        except Exception as exc:
                            st.error(str(exc))
            elif step and step != "publish":
                if st.button("Continuer", key=f"cont_{v['id']}"):
                    try:
                        with st.spinner(f"Reprise #{v['id']} ({step})…"):
                            run_pipeline(resume_id=int(v["id"]), only=step, publish=False)
                        st.rerun()
                    except Exception as exc:
                        st.error(str(exc))
