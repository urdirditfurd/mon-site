#!/usr/bin/env python3
"""Orchestrateur — lance le pipeline scène par scène, sans bloquer inutilement.

Usage :
  python main.py                # une vidéo complète (mode demo)
  python main.py --theme "lapin"
  python main.py --only sourcing
  python main.py --resume 3
  python main.py --short        # test rapide ~3 min
"""

from __future__ import annotations

import argparse
import sys
import traceback
from pathlib import Path

# Permet d'importer config / db / modules depuis ce dossier
ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import IMAGE_MODE, PAUSE_PIPELINE, TARGET_DURATION_MIN, ensure_dirs
from db.database import get_video, init_db, is_paused, log_event, set_paused, update_video
from modules.audio import generate_audio
from modules.images import generate_images
from modules.montage import assemble_video
from modules.publish import prepare_publish_package, publish_youtube
from modules.sourcing import source_new_video
from modules.storyboard import build_storyboard


STEPS = ("sourcing", "storyboard", "audio", "images", "montage", "publish")


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
        if start_idx <= STEPS.index("images"):
            result["steps"]["images"] = generate_images(video_id)
        if start_idx <= STEPS.index("montage"):
            result["steps"]["montage"] = assemble_video(video_id)
        if publish or start_step == "publish":
            result["steps"]["publish"] = publish_youtube(video_id, force=publish)
        else:
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
    publish: bool = False,
    short: bool = False,
    micro: bool = False,
) -> dict:
    ensure_dirs()
    init_db()

    if PAUSE_PIPELINE or is_paused():
        return {"ok": False, "reason": "pipeline_en_pause", "hint": "Relancez depuis le dashboard."}

    if short or micro:
        # Surcharge légère pour un essai rapide
        import config as cfg

        if micro:
            cfg.TARGET_DURATION_MIN = 1.2
            cfg.SCENE_TARGET_SEC = 40
            cfg.VIDEO_WIDTH = 1280
            cfg.VIDEO_HEIGHT = 720
            cfg.VIDEO_FPS = 24
        else:
            cfg.TARGET_DURATION_MIN = 3
            cfg.SCENE_TARGET_SEC = 45

    if only and only not in STEPS:
        raise ValueError(f"--only doit être parmi {STEPS}")

    if resume_id:
        start = only or "storyboard"
        return {"ok": True, **_run_from(resume_id, start, publish)}

    if only and only != "sourcing":
        raise ValueError("Pour une étape seule hors sourcing, utilisez --resume ID")

    sourced = source_new_video(theme)
    if not sourced.get("ok"):
        return sourced

    video_id = int(sourced["video_id"])
    if only == "sourcing":
        return sourced

    return {"ok": True, "story": sourced.get("story"), **_run_from(video_id, "storyboard", publish)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Conte Factory — pipeline vidéo longue")
    parser.add_argument("--theme", type=str, default=None, help="Thème du conte")
    parser.add_argument("--only", type=str, default=None, help=f"Une seule étape: {', '.join(STEPS)}")
    parser.add_argument("--resume", type=int, default=None, help="Reprendre un projet (id)")
    parser.add_argument("--publish", action="store_true", help="Forcer l'upload YouTube")
    parser.add_argument("--short", action="store_true", help="Test rapide (~3 min)")
    parser.add_argument("--micro", action="store_true", help="Mini test (~2 scènes, HD légère)")
    parser.add_argument("--pause", action="store_true", help="Mettre le pipeline en pause")
    parser.add_argument("--resume-pipeline", action="store_true", help="Enlever la pause")
    args = parser.parse_args()

    ensure_dirs()
    init_db()

    if args.pause:
        set_paused(True)
        print("Pipeline en pause.")
        return 0
    if args.resume_pipeline:
        set_paused(False)
        print("Pipeline réactivé.")
        return 0

    try:
        result = run_pipeline(
            theme=args.theme,
            only=args.only,
            resume_id=args.resume,
            publish=args.publish,
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
