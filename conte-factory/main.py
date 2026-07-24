#!/usr/bin/env python3
"""Orchestrateur — trame d'origine.

1 Script & dédup → 2 Storyboard → 3 Audio + Vidéo IA → 4 Montage → Publication auto → 5 Dashboard
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import (
    AI_CLIP_SEC,
    AUTO_PUBLISH,
    AUTO_START_WAN,
    FAL_CONCURRENCY,
    PAUSE_PIPELINE,
    TARGET_DURATION_MIN,
    VIDEO_PROVIDER,
    WAN_START_TIMEOUT_SEC,
    ensure_dirs,
    estimate_ai_clips,
)
from db.database import get_video, init_db, is_paused, log_event, set_paused, update_video
from modules.audio import generate_audio
from modules.montage import assemble_video
from modules.progress import set_progress
from modules.publish import publish_youtube
from modules.sourcing import source_new_video
from modules.storyboard import build_storyboard
from modules.video_ai import generate_scene_videos
from modules.wan_service import ensure_wan_running

STEPS = ("sourcing", "storyboard", "audio", "video_ai", "montage", "publish")


def _run_from(
    video_id: int,
    start_step: str,
    publish: bool,
    *,
    voice: str | None = None,
    subtitles: bool = False,
) -> dict:
    video = get_video(video_id)
    if not video:
        raise ValueError(f"Vidéo {video_id} introuvable")

    start_idx = STEPS.index(start_step)
    result: dict = {"video_id": video_id, "steps": {}}

    try:
        if start_idx <= STEPS.index("storyboard"):
            set_progress(
                step="storyboard",
                video_id=video_id,
                message="Decoupage des scenes…",
            )
            result["steps"]["storyboard"] = build_storyboard(video_id)
        if start_idx <= STEPS.index("audio"):
            set_progress(
                step="audio",
                video_id=video_id,
                message="Generation de la voix…",
            )
            result["steps"]["audio"] = generate_audio(video_id, voice=voice)
        if start_idx <= STEPS.index("video_ai"):
            n_clips = max(1, estimate_ai_clips())
            try:
                projet = Path(video["chemin_projet"])
                board_path = projet / "storyboard.json"
                if board_path.exists():
                    board = json.loads(board_path.read_text(encoding="utf-8"))
                    n_clips = max(1, int(board.get("scene_count") or len(board.get("scenes") or [])))
            except Exception:
                pass
            set_progress(
                step="video_ai",
                video_id=video_id,
                message="Generation des clips video…",
                clips_done=0,
                clips_total=n_clips,
            )
            result["steps"]["video_ai"] = generate_scene_videos(video_id)
        if start_idx <= STEPS.index("montage"):
            set_progress(
                step="montage",
                video_id=video_id,
                message="Assemblage du film…",
            )
            result["steps"]["montage"] = assemble_video(
                video_id, with_subtitles=subtitles
            )
        publish_note = ""
        if publish or AUTO_PUBLISH or start_step == "publish":
            set_progress(
                step="publish",
                video_id=video_id,
                message="Publication YouTube…",
            )
            pub = publish_youtube(video_id, force=True)
            result["steps"]["publish"] = pub
            if pub.get("skipped"):
                publish_note = str(pub.get("reason") or "Publication ignoree")
        else:
            from modules.publish import prepare_publish_package

            result["steps"]["publish"] = prepare_publish_package(video_id)

        set_progress(
            step="done",
            video_id=video_id,
            message="Video prete",
            detail=publish_note
            or "Tu peux la visionner dans le Tableau de bord",
        )
    except Exception as exc:
        update_video(video_id, statut="erreur", erreur=str(exc))
        log_event(video_id, "error", str(exc))
        set_progress(
            step="error",
            video_id=video_id,
            message="Erreur pendant la generation",
            error=str(exc)[:500],
        )
        raise

    return result


def run_pipeline(
    theme: str | None = None,
    only: str | None = None,
    resume_id: int | None = None,
    publish: bool | None = None,
    short: bool = False,
    micro: bool = False,
    duration_min: float | None = None,
    voice: str | None = None,
    subtitles: bool = False,
    age_group: str = "1-9",
    style_key: str = "aquarelle",
    aspect: str = "16:9",
    music: str = "berceuse",
) -> dict:
    ensure_dirs()
    init_db()

    if PAUSE_PIPELINE or is_paused():
        return {"ok": False, "reason": "pipeline_en_pause", "hint": "Relancez depuis le dashboard."}

    provider = VIDEO_PROVIDER.lower().strip()
    if AUTO_START_WAN and provider.startswith(("pinokio", "wan")):
        set_progress(
            step="start",
            pct=1,
            message="Demarrage du moteur video…",
            detail="Premier demarrage = chargement modele (peut prendre plusieurs minutes)",
        )
        wan = ensure_wan_running(wait_seconds=WAN_START_TIMEOUT_SEC)
        if not wan.get("ok"):
            set_progress(
                step="error",
                message="Moteur video indisponible",
                error=str(wan.get("error") or wan),
            )
            return {
                "ok": False,
                "reason": "wan_indisponible",
                "hint": "Relance video ia puis reessaie",
                "wan": wan,
            }

    do_publish = AUTO_PUBLISH if publish is None else publish

    import config as cfg
    from config import scene_sec_for_audience

    if duration_min is not None:
        cfg.TARGET_DURATION_MIN = max(1.0, min(60.0, float(duration_min)))
        cfg.SCENE_TARGET_SEC = scene_sec_for_audience(age_group)
    elif short or micro:
        if micro:
            cfg.TARGET_DURATION_MIN = 1.2
            cfg.SCENE_TARGET_SEC = 40
        else:
            cfg.TARGET_DURATION_MIN = 3
            cfg.SCENE_TARGET_SEC = 45

    if only and only not in STEPS:
        raise ValueError(f"--only doit être parmi {STEPS}")

    if resume_id:
        start = only or "storyboard"
        return {
            "ok": True,
            **_run_from(
                resume_id, start, do_publish, voice=voice, subtitles=subtitles
            ),
        }

    if only and only != "sourcing":
        raise ValueError("Pour une étape seule hors sourcing, utilisez --resume ID")

    set_progress(step="sourcing", message="Ecriture de l'histoire…")
    sourced = source_new_video(
        theme,
        age_group=age_group,
        duration_min=cfg.TARGET_DURATION_MIN,
        style_key=style_key,
        aspect=aspect,
        music=music,
    )
    if not sourced.get("ok"):
        set_progress(
            step="error",
            message="Impossible de creer l'histoire",
            error=str(sourced),
        )
        return sourced

    video_id = int(sourced["video_id"])
    set_progress(step="sourcing", video_id=video_id, message="Histoire prete", pct=8)
    if only == "sourcing":
        return sourced

    return {
        "ok": True,
        "story": sourced.get("story"),
        **_run_from(
            video_id, "storyboard", do_publish, voice=voice, subtitles=subtitles
        ),
    }


def print_estimate() -> None:
    clips = estimate_ai_clips()
    from config import estimate_render_minutes

    low, high = estimate_render_minutes()
    print(
        f"Cible: {TARGET_DURATION_MIN} min | scenes/clips Wan ~{clips} "
        f"(1 clip/scene, boucle audio) | provider={VIDEO_PROVIDER}"
    )
    print(f"Rendu estime GPU: {low}–{high} min")


def main() -> int:
    parser = argparse.ArgumentParser(description="Conte Factory — pipeline vidéo IA longue")
    parser.add_argument("--theme", type=str, default=None)
    parser.add_argument("--only", type=str, default=None)
    parser.add_argument("--resume", type=int, default=None)
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--no-publish", action="store_true")
    parser.add_argument("--short", action="store_true")
    parser.add_argument("--micro", action="store_true")
    parser.add_argument("--duration", type=float, default=None, help="Duree cible en minutes (1-60)")
    parser.add_argument("--voice", type=str, default=None, help="Edge-TTS voice id")
    parser.add_argument("--subtitles", action="store_true")
    parser.add_argument(
        "--age",
        type=str,
        default="1-9",
        choices=["1-3", "4-6", "7-9", "1-9"],
        help="Public cible enfants (rythme des scenes)",
    )
    parser.add_argument(
        "--style",
        type=str,
        default="aquarelle",
        choices=["aquarelle", "anime_doux", "3d_mignon", "conte_classique", "papier_decoupe"],
    )
    parser.add_argument(
        "--aspect",
        type=str,
        default="16:9",
        choices=["16:9", "9:16", "1:1"],
    )
    parser.add_argument(
        "--music",
        type=str,
        default="berceuse",
        choices=["aucune", "berceuse", "fichier"],
    )
    parser.add_argument("--pause", action="store_true")
    parser.add_argument("--resume-pipeline", action="store_true")
    parser.add_argument("--estimate", action="store_true")
    args = parser.parse_args()

    ensure_dirs()
    init_db()

    if args.estimate:
        print_estimate()
        return 0
    if args.pause:
        set_paused(True)
        print("Pipeline en pause.")
        return 0
    if args.resume_pipeline:
        set_paused(False)
        print("Pipeline réactivé.")
        return 0

    publish: bool | None
    if args.no_publish:
        publish = False
    elif args.publish:
        publish = True
    else:
        publish = None

    try:
        result = run_pipeline(
            theme=args.theme,
            only=args.only,
            resume_id=args.resume,
            publish=publish,
            short=args.short or args.micro,
            micro=args.micro,
            duration_min=args.duration,
            voice=args.voice,
            subtitles=args.subtitles,
            age_group=args.age,
            style_key=args.style,
            aspect=args.aspect,
            music=args.music,
        )
    except Exception:
        traceback.print_exc()
        return 1

    print(result)
    return 0 if result.get("ok", True) else 2


if __name__ == "__main__":
    raise SystemExit(main())
