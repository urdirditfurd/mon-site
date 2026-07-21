#!/usr/bin/env python3
"""Orchestrateur — trame d'origine.

1 Script & dédup → 2 Storyboard → 3 Audio + Vidéo IA → 4 Montage → Publication auto → 5 Dashboard

Usage :
  python main.py --theme "lapin"
  python main.py --resume 3
  python main.py --estimate
"""

from __future__ import annotations

import argparse
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import (
    AI_CLIP_SEC,
    AUTO_PUBLISH,
    FAL_CONCURRENCY,
    PAUSE_PIPELINE,
    TARGET_DURATION_MIN,
    VIDEO_PROVIDER,
    ensure_dirs,
    estimate_ai_clips,
)
from db.database import get_video, init_db, is_paused, log_event, set_paused, update_video
from modules.audio import generate_audio
from modules.montage import assemble_video
from modules.publish import publish_youtube
from modules.sourcing import source_new_video
from modules.storyboard import build_storyboard
from modules.video_ai import generate_scene_videos

STEPS = ("sourcing", "storyboard", "audio", "video_ai", "montage", "publish")


def _run_from(video_id: int, start_step: str, publish: bool) -> dict:
    video = get_video(video_id)
    if not video:
        raise ValueError(f"Vidéo {video_id} introuvable")

    start_idx = STEPS.index(start_step)
    result: dict = {"video_id": video_id, "steps": {}}

    try:
        if start_idx <= STEPS.index("storyboard"):
            result["steps"]["storyboard"] = build_storyboard(video_id)
        if start_idx <= STEPS.index("audio"):
            result["steps"]["audio"] = generate_audio(video_id)
        if start_idx <= STEPS.index("video_ai"):
            result["steps"]["video_ai"] = generate_scene_videos(video_id)
        if start_idx <= STEPS.index("montage"):
            result["steps"]["montage"] = assemble_video(video_id)
        # Publication automatique dès que le montage est terminé
        if publish or AUTO_PUBLISH or start_step == "publish":
            result["steps"]["publish"] = publish_youtube(video_id, force=True)
        else:
            from modules.publish import prepare_publish_package

            result["steps"]["publish"] = prepare_publish_package(video_id)
    except Exception as exc:
        update_video(video_id, statut="erreur", erreur=str(exc))
        log_event(video_id, "error", str(exc))
        raise

    return result


def run_pipeline(
    theme: str | None = None,
    only: str | None = None,
    resume_id: int | None = None,
    publish: bool | None = None,
    short: bool = False,
    micro: bool = False,
) -> dict:
    ensure_dirs()
    init_db()

    if PAUSE_PIPELINE or is_paused():
        return {"ok": False, "reason": "pipeline_en_pause", "hint": "Relancez depuis le dashboard."}

    do_publish = AUTO_PUBLISH if publish is None else publish

    if short or micro:
        import config as cfg

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
        return {"ok": True, **_run_from(resume_id, start, do_publish)}

    if only and only != "sourcing":
        raise ValueError("Pour une étape seule hors sourcing, utilisez --resume ID")

    sourced = source_new_video(theme)
    if not sourced.get("ok"):
        return sourced

    video_id = int(sourced["video_id"])
    if only == "sourcing":
        return sourced

    return {
        "ok": True,
        "story": sourced.get("story"),
        **_run_from(video_id, "storyboard", do_publish),
    }


def print_estimate() -> None:
    clips = estimate_ai_clips()
    # Hypothèse rough : ~1–2 min wall-clock par clip avec file + concurrence limitée
    minutes_low = (clips / max(1, FAL_CONCURRENCY)) * 1.0
    minutes_high = (clips / max(1, FAL_CONCURRENCY)) * 2.5
    print(
        f"Cible: {TARGET_DURATION_MIN} min | clips IA ~{clips} × {AI_CLIP_SEC}s | "
        f"provider={VIDEO_PROVIDER} | concurrence={FAL_CONCURRENCY}"
    )
    print(
        f"Rendu estimé (ordre de grandeur): {minutes_low/60:.1f}–{minutes_high/60:.1f} h "
        f"une fois le code prêt + crédits API OK"
    )
    print(
        f"Coût API (ordre de grandeur, Kling via FAL): "
        f"souvent ~3× une vidéo 10 min → budget à prévoir pour {TARGET_DURATION_MIN} min"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Conte Factory — pipeline vidéo IA longue")
    parser.add_argument("--theme", type=str, default=None)
    parser.add_argument("--only", type=str, default=None)
    parser.add_argument("--resume", type=int, default=None)
    parser.add_argument("--publish", action="store_true", help="Forcer publish YouTube")
    parser.add_argument("--no-publish", action="store_true", help="Désactiver publish pour ce run")
    parser.add_argument("--short", action="store_true")
    parser.add_argument("--micro", action="store_true")
    parser.add_argument("--pause", action="store_true")
    parser.add_argument("--resume-pipeline", action="store_true")
    parser.add_argument("--estimate", action="store_true", help="Estimer clips / durée de rendu")
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
        publish = None  # suit AUTO_PUBLISH

    try:
        result = run_pipeline(
            theme=args.theme,
            only=args.only,
            resume_id=args.resume,
            publish=publish,
            short=args.short or args.micro,
            micro=args.micro,
        )
    except Exception:
        traceback.print_exc()
        return 1

    print(result)
    return 0 if result.get("ok", True) else 2


if __name__ == "__main__":
    raise SystemExit(main())
