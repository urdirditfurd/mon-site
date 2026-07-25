"""Page Creation — formulaire + gros % d'avancement (optimise 30 min)."""

from __future__ import annotations

import importlib
import inspect
import sys
import time
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import VIDEO_PROVIDER, estimate_ai_clips, estimate_render_minutes
from modules.creative_options import MUSIC_OPTIONS
from modules import job_runner as job_runner_mod
from modules.progress import get_progress
from modules.youth_spec import youth_profile
from ui_helpers import boot_app, go_page, nav_buttons, render_engine_status, render_sidebar

# Recharge le module a chaque run Streamlit (evite TypeError style_key apres git pull)
job_runner_mod = importlib.reload(job_runner_mod)
start_generation_job = job_runner_mod.start_generation_job
refresh_job_status = job_runner_mod.refresh_job_status
stop_generation_job = job_runner_mod.stop_generation_job
JOB_RUNNER_API = int(getattr(job_runner_mod, "JOB_RUNNER_API", 1))

ctx = boot_app("video ia — Creation")
render_sidebar("Creation")
nav_buttons("Creation")

st.markdown(
    """
<div class="hero-card">
  <div class="section-label">Creation</div>
  <h2 style="margin:0;">Creer une video</h2>
  <p>Choisis ton theme et tes options — video ia s'occupe du reste.</p>
</div>
""",
    unsafe_allow_html=True,
)

render_engine_status(ctx, "crea")

status = refresh_job_status()
progress = status.get("progress") or get_progress()
job = status.get("job") or {}
running = bool(job.get("running") and status.get("alive"))

# --- Formulaire ---
with st.form("create_form", clear_on_submit=False):
    theme = st.text_input(
        "Theme ou prompt",
        value=st.session_state.get("last_theme", ""),
        placeholder="ex: un dragon violet fonce qui vole et chante dans les nuages",
        help="Decris EXACTEMENT le heros / l'action. L'histoire parlera de ca.",
    )
    duration = st.slider(
        "Duree de la video (minutes)", min_value=1, max_value=60, value=5
    )
    c1, c2 = st.columns(2)
    with c1:
        style_label = st.selectbox(
            "Style visuel",
            options=[
                "Aquarelle conte",
                "Anime doux",
                "3D mignon",
                "Conte classique",
                "Papier decoupe",
            ],
            index=0,
        )
        style_map = {
            "Aquarelle conte": "aquarelle",
            "Anime doux": "anime_doux",
            "3D mignon": "3d_mignon",
            "Conte classique": "conte_classique",
            "Papier decoupe": "papier_decoupe",
        }
        style_key = style_map[style_label]
    with c2:
        aspect = st.selectbox(
            "Format",
            options=["16:9 (YouTube)", "9:16 (Shorts/TikTok)", "1:1 (carre)"],
            index=0,
        )
        aspect_map = {
            "16:9 (YouTube)": "16:9",
            "9:16 (Shorts/TikTok)": "9:16",
            "1:1 (carre)": "1:1",
        }
        aspect_key = aspect_map[aspect]

    voice = st.radio(
        "Voix du heros (l'ami a l'autre voix)",
        options=["femme", "homme", "auto"],
        index=0,
        horizontal=True,
        help="Les personnages parlent directement (plus de narrateur unique).",
    )
    age_label = st.selectbox(
        "Public (age) — spec jeunesse obligatoire",
        options=[
            "1-10 ans (tous — rythme doux)",
            "1-3 ans (plans longs, couleurs primaires)",
            "4-6 ans (rythme moyen, palette riche)",
            "7-10 ans (rythme cinema narratif)",
        ],
        index=3,
        help="FPS 24, mix voix prioritaire, couleurs et rythme adaptes a l'age.",
    )
    age_map = {
        "1-10 ans (tous — rythme doux)": "1-10",
        "1-3 ans (plans longs, couleurs primaires)": "1-3",
        "4-6 ans (rythme moyen, palette riche)": "4-6",
        "7-10 ans (rythme cinema narratif)": "7-10",
    }
    age_group = age_map[age_label]

    music_label = st.selectbox(
        "Musique",
        options=[
            "Berceuse douce (generee, libre)",
            "Fichier libre de droit (assets/music)",
            "Aucune",
        ],
        index=0,
        help="Si 'fichier' sans MP3 dans assets/music, berceuse generee automatiquement.",
    )
    music_map = {
        "Berceuse douce (generee, libre)": "berceuse",
        "Fichier libre de droit (assets/music)": "fichier",
        "Aucune": "aucune",
    }
    music = music_map[music_label]

    subtitles = st.checkbox("Sous-titres", value=False)
    publish = st.checkbox("Publier sur YouTube a la fin", value=False)

    scenes = estimate_ai_clips(float(duration), age_group=age_group)
    est_low, est_high = estimate_render_minutes(float(duration), age_group=age_group)
    provider = VIDEO_PROVIDER.lower().strip()
    yp = youth_profile(age_group)
    if provider in {"i2v", "wan_i2v", "image2video", "img2vid"}:
        mode_txt = (
            f"**Pipeline I2V face-safe** : LTX/Wan · CFG 3.5 · motion 0.3 · "
            f"848×480 · scheduler natif (~{scenes} scènes)"
        )
    elif provider in {"talking", "lipsync", "talk"}:
        mode_txt = (
            f"**Pipeline talking (legacy)** : TTS → portrait → lip-sync (~{scenes} repliques)"
        )
    elif provider.startswith(("pinokio", "wan")):
        mode_txt = f"**Wan T2V brut** : ~{scenes} clips (sans image de depart)"
    else:
        mode_txt = f"**Mode images** : {scenes} illustrations"
    st.markdown(
        f"""
{mode_txt}  
**Spec jeunesse :** {yp['label']} · **{yp['fps']} FPS** · **{yp['resolution_label']}** · plans {yp['shot_sec_min']:.0f}-{yp['shot_sec_max']:.0f}s · musique -14 dB  
**Temps de creation estime :** environ **{est_low}–{est_high} minutes**  
**Style :** {style_label} · **Format :** {aspect_key} · **Musique :** {MUSIC_OPTIONS.get(music, music)}

Vraie animation : personnage qui bouge, camera, decor vivant (Wan I2V) — pas un diaporama.
"""
    )

    submitted = st.form_submit_button(
        "Generer la video",
        type="primary",
        use_container_width=True,
        disabled=running or (ctx["uses_wan"] and not ctx["wan_ok"]),
    )

if submitted:
    if not theme.strip():
        st.error("Indique un theme.")
    elif ctx["uses_wan"] and not ctx["wan_ok"]:
        st.error("Moteur video pas encore pret — attends puis reessaie.")
    else:
        st.session_state["last_theme"] = theme.strip()
        payload = {
            "theme": theme.strip(),
            "duration_min": float(duration),
            "voice": voice,
            "subtitles": subtitles,
            "publish": publish,
            "age_group": age_group,
            "style_key": style_key,
            "aspect": aspect_key,
            "music": music,
        }
        params = inspect.signature(start_generation_job).parameters
        has_var_kw = any(
            p.kind == inspect.Parameter.VAR_KEYWORD for p in params.values()
        )
        if has_var_kw or "style_key" in params:
            filtered = payload if has_var_kw else {
                k: v for k, v in payload.items() if k in params
            }
        else:
            st.warning(
                "Ancien job_runner detecte (sans style/format/musique). "
                "Fais git pull puis arrete/relance video ia."
            )
            filtered = {k: v for k, v in payload.items() if k in params}
        result = start_generation_job(**filtered)
        if result.get("ok"):
            st.success("Generation lancee — regarde le % ci-dessous.")
            st.rerun()
        else:
            st.warning(result.get("error") or result)

# --- Gros pourcentage (relu depuis le fichier a chaque affichage) ---
st.markdown("### Avancement de la creation")
progress = get_progress()
pct = float(progress.get("pct") or 0)
label = progress.get("label") or progress.get("message") or "En attente"
updated = progress.get("updated_at") or ""
step = str(progress.get("step") or "idle")

if step in {"idle", ""} and not running:
    st.info(
        "Remplis le formulaire puis clique **Generer la video**. "
        "Le pourcentage se met a jour ici (Histoire → Voix → Lip-sync → Montage)."
    )
elif running and step in {"start", "idle"}:
    st.info("Demarrage du pipeline… le % va bouger dans quelques secondes.")

st.markdown(
    f"""
<div class="progress-box" style="text-align:center;">
  <div style="font-size:3.6rem;font-weight:800;color:#3D2E6B;line-height:1;">{pct:.0f}%</div>
  <div style="margin-top:8px;font-size:1.15rem;font-weight:700;color:#5A458C;">{label}</div>
  <div style="margin-top:6px;color:#6A6478;">{progress.get('message') or ''}</div>
  <div style="margin-top:4px;color:#8A8499;font-size:0.9rem;">{progress.get('detail') or ''}</div>
  <div style="margin-top:4px;color:#A09AAC;font-size:0.8rem;">Maj: {updated}</div>
</div>
""",
    unsafe_allow_html=True,
)
st.progress(min(1.0, pct / 100.0))

cols = st.columns(3)
if progress.get("clips_total"):
    cols[0].metric(
        "Repliques",
        f"{progress.get('clips_done') or 0}/{progress.get('clips_total')}",
    )
if progress.get("video_id"):
    cols[1].metric("Projet", f"#{progress['video_id']}")
cols[2].metric("Etape", str(progress.get("step") or "—"))

steps_ui = [
    ("sourcing", "Histoire"),
    ("storyboard", "Scenes"),
    ("audio", "Voix"),
    ("video_ai", "Animation I2V"),
    ("montage", "Montage"),
    ("done", "Termine"),
]
cur = str(progress.get("step") or "idle")
order = [s for s, _ in steps_ui]
try:
    cur_i = order.index(cur) if cur in order else (
        order.index("done") if cur == "publish" else -1
    )
except ValueError:
    cur_i = -1
chips = []
for i, (key, name) in enumerate(steps_ui):
    if cur == "error":
        mark = "○"
    elif cur_i > i or cur == "done":
        mark = "✓"
    elif cur_i == i or (cur == "start" and i == 0):
        mark = "●"
    else:
        mark = "○"
    chips.append(f"{mark} {name}")
st.caption(" → ".join(chips))

if progress.get("error"):
    st.error(progress["error"])
    log_path = ROOT / "data" / "job.log"
    if log_path.exists():
        try:
            tail = log_path.read_text(encoding="utf-8", errors="replace")[-2500:]
            with st.expander("Journal technique (fin du log)"):
                st.code(tail or "(vide)")
        except Exception:
            pass

ref_cols = st.columns(2)
with ref_cols[0]:
    if st.button("Actualiser le %", use_container_width=True):
        st.rerun()

if running:
    st.info("Generation en cours — rafraichissement auto toutes les 3 s.")
    with ref_cols[1]:
        if st.button("Annuler la generation", use_container_width=True):
            stop_generation_job()
            st.rerun()
    time.sleep(3)
    st.rerun()
elif progress.get("step") == "done":
    st.success("Video terminee — retrouve-la dans Suivi pour la visionner.")
    if st.button("Voir dans Suivi"):
        go_page("pages/1_Tableau_de_bord.py")
