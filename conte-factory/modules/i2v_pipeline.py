"""Pipeline Image-to-Video — clips courts anti-boucle (3-5 s par plan).

Workflow :
  Input → decoupage clip_plans → image ref par clip → I2V batch → trim loops → export montage

Jamais de video longue en un seul prompt : 1 action + 1 camera par clip.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any

from PIL import Image

from config import PINOKIO_I2V_HEIGHT, PINOKIO_I2V_WIDTH
from db.database import get_video, log_event, update_video
from modules.character_lock import ensure_hero_reference
from modules.clip_postprocess import trim_loop_tail
from modules.clip_prompts import (
    build_clip_plans_for_board,
    enhance_image_prompt,
    enhance_motion_prompt,
    flatten_clip_jobs,
)
from modules.i2v_ai import animate_scene_i2v, animate_scenes_i2v_batch, i2v_health
from modules.image_ai import generate_scene_image, set_image_output_size
from modules.progress import set_progress
from modules.storyboard import enrich_board_visual_prompts
from modules.youth_spec import normalize_age, youth_profile


def _clip_stem(scene_idx: int, clip_idx: int) -> str:
    return f"scene_{scene_idx:03d}_clip_{clip_idx:02d}"


def _clip_paths(
    clips_dir: Path,
    stills_dir: Path,
    raw_dir: Path,
    scene_idx: int,
    clip_idx: int,
) -> dict[str, Path]:
    # 1 image de reference par scene narrative (pas par micro-clip)
    return {
        "still": stills_dir / f"scene_{scene_idx:03d}.png",
        "raw": raw_dir / f"scene_{scene_idx:03d}_clip_{clip_idx:02d}.mp4",
        "part": clips_dir / f"scene_{scene_idx:03d}_part{clip_idx:02d}.mp4",
    }


def _still_ok(still: Path, img_w: int, img_h: int) -> bool:
    if not still.exists() or still.stat().st_size < 1000:
        return False
    try:
        with Image.open(still) as im:
            return im.size == (img_w, img_h)
    except Exception:
        return False


def _part_ok(part: Path) -> bool:
    return part.exists() and part.stat().st_size > 5000


def _sync_scene_clip_files(
    scene: dict[str, Any],
    clips_dir: Path,
    plans: list[dict[str, Any]],
    scene_idx: int,
) -> list[str]:
    names: list[str] = []
    for ci in range(len(plans)):
        part = clips_dir / f"scene_{scene_idx:03d}_part{ci:02d}.mp4"
        if _part_ok(part):
            names.append(part.name)
    scene["ai_clip_files"] = names
    scene["ai_clips_planned"] = len(plans)
    return names


def generate_i2v_videos(video_id: int) -> dict[str, Any]:
    """Etapes : clip_plans → image ref → I2V batch → trim anti-loop → export."""
    video = get_video(video_id)
    if not video:
        raise ValueError(f"Video introuvable: {video_id}")

    projet = Path(video["chemin_projet"])
    board_path = projet / "storyboard.json"
    board = json.loads(board_path.read_text(encoding="utf-8"))
    clips_dir = projet / "ai_clips"
    stills_dir = clips_dir / "stills"
    raw_dir = clips_dir / "i2v_raw"
    clips_dir.mkdir(parents=True, exist_ok=True)
    stills_dir.mkdir(parents=True, exist_ok=True)
    raw_dir.mkdir(parents=True, exist_ok=True)

    age = normalize_age(str(board.get("age_group") or "1-10"))
    youth_profile(age)

    health = i2v_health()
    if not health.get("ready"):
        hint = health.get("hint") or (
            "powershell -ExecutionPolicy Bypass -File "
            r"C:\ConteFactory\pinokio\wan-i2v\INSTALL-I2V.ps1"
        )
        raise RuntimeError(
            f"Moteur Wan I2V indisponible (mode={health.get('mode')}). {hint}"
        )
    log_event(
        video_id,
        "info",
        f"Pipeline I2V clips courts : mode={health.get('mode')} url={health.get('url')}",
    )

    img_w = int(PINOKIO_I2V_WIDTH or 848)
    img_h = int(PINOKIO_I2V_HEIGHT or 480)
    set_image_output_size(img_w, img_h)

    n_enriched = enrich_board_visual_prompts(board, force=False)
    if n_enriched:
        log_event(
            video_id,
            "info",
            f"Prompts visuels EN enrichis : {n_enriched} scene(s).",
        )

    total_clips = build_clip_plans_for_board(board)
    jobs = flatten_clip_jobs(board)
    if not jobs:
        raise RuntimeError("Aucun clip planifie dans le storyboard")

    # P3 — image de reference heros (lock personnage)
    hero_ref = ensure_hero_reference(projet, board, width=img_w, height=img_h)
    board["character_ref_path"] = str(hero_ref)
    log_event(video_id, "info", f"Character lock: {hero_ref.name}")

    theme_key = str(board.get("theme") or board.get("hero") or "conte")
    base_seed = int(hashlib.md5(theme_key.encode("utf-8")).hexdigest()[:8], 16) % 1_000_000

    pending: list[dict[str, Any]] = []
    done_count = 0

    for job in jobs:
        scene_idx = int(job["scene_index"])
        clip_idx = int(job["clip_index"]) - 1
        clip_plan = job["clip_plan"]
        scene = job["scene"]
        paths = _clip_paths(clips_dir, stills_dir, raw_dir, scene_idx, clip_idx)

        if _part_ok(paths["part"]):
            done_count += 1
            clip_plan["init_frame"] = paths["still"].name if paths["still"].exists() else None
            clip_plan["output_file"] = paths["part"].name
            continue

        still_ok = _still_ok(paths["still"], img_w, img_h)
        raw_ok = paths["raw"].exists() and paths["raw"].stat().st_size > 5000

        if raw_ok and still_ok:
            pending.append(
                {
                    "job": job,
                    "paths": paths,
                    "need_still": False,
                    "need_i2v": False,
                    "need_trim": True,
                }
            )
            continue

        need_i2v = not raw_ok or not still_ok
        pending.append(
            {
                "job": job,
                "paths": paths,
                "need_still": not still_ok,
                "need_i2v": need_i2v,
                "need_trim": True,
                "prompt": enhance_motion_prompt(clip_plan, board=board),
                "image_prompt": enhance_image_prompt(clip_plan, board),
                "seed": (base_seed + scene_idx * 31 + clip_idx * 7) % 1_000_000,
            }
        )

    # --- Phase 1 : 1 image de reference (init_frame) PAR SCENE narrative ---
    scenes_needing_still: dict[int, dict[str, Any]] = {}
    for p in pending:
        if not p.get("need_still"):
            continue
        scene_idx = int(p["job"]["scene_index"])
        if scene_idx not in scenes_needing_still:
            scenes_needing_still[scene_idx] = p

    for i, (scene_idx, p) in enumerate(scenes_needing_still.items()):
        job = p["job"]
        paths = p["paths"]
        set_progress(
            step="video_ai",
            video_id=video_id,
            message=f"Image ref scene {scene_idx} ({i + 1}/{len(scenes_needing_still)})…",
            clips_done=done_count,
            clips_total=total_clips,
            detail="init_frame scene (reuse clips)",
        )
        generate_scene_image(
            str(p.get("image_prompt") or ""),
            paths["still"],
            seed=(base_seed + scene_idx * 17) % 1_000_000,
            width=img_w,
            height=img_h,
        )
        for q in pending:
            if int(q["job"]["scene_index"]) != scene_idx:
                continue
            q["need_still"] = False
            q["need_i2v"] = True
            q["paths"]["still"] = paths["still"]
            clip_plan = q["job"]["clip_plan"]
            clip_plan["init_frame"] = paths["still"].name
            clip_plan["reference_image"] = paths["still"].name
            raw = q["paths"]["raw"]
            if raw.exists():
                try:
                    raw.unlink(missing_ok=True)
                except OSError:
                    pass

    # --- Phase 2 : batch I2V (1 chargement modele) ---
    to_animate = [p for p in pending if p.get("need_i2v")]
    if to_animate:
        set_progress(
            step="video_ai",
            video_id=video_id,
            message=f"I2V batch {len(to_animate)} clip(s) courts…",
            clips_done=done_count,
            clips_total=total_clips,
            detail="clips 3-5 s · anti-loop · CFG 3.5",
        )
        log_event(video_id, "info", f"I2V batch: {len(to_animate)} clips (1 load modele)")
        batch_jobs = [
            {
                "image": p["paths"]["still"],
                "dest": p["paths"]["raw"],
                "prompt": str(p.get("prompt") or ""),
                "seed": p.get("seed"),
            }
            for p in to_animate
        ]
        try:
            batch_results = animate_scenes_i2v_batch(batch_jobs)
        except Exception as exc:
            log_event(video_id, "error", f"I2V batch echec, fallback unitaire: {exc}")
            batch_results = []
            for p in to_animate:
                try:
                    batch_results.append(
                        animate_scene_i2v(
                            p["paths"]["still"],
                            p["paths"]["raw"],
                            prompt=str(p.get("prompt") or ""),
                            seed=p.get("seed"),
                        )
                    )
                except Exception as exc2:
                    batch_results.append({"ok": False, "error": str(exc2)[:500]})

        for p, result in zip(to_animate, batch_results):
            if not result.get("ok"):
                job = p["job"]
                raise RuntimeError(
                    f"I2V scene {job['scene_index']} clip {job['clip_index']} echoue: "
                    f"{result.get('error') or result}"
                )
            p["i2v_mode"] = result.get("mode") or "cli_i2v_batch"
            p["need_i2v"] = False

    # --- Phase 3 : trim anti-loop + checkpoint ---
    for i, p in enumerate(pending):
        job = p["job"]
        scene_idx = int(job["scene_index"])
        clip_idx = int(job["clip_index"])
        clip_plan = job["clip_plan"]
        scene = job["scene"]
        paths = p["paths"]

        if not paths["raw"].exists() or paths["raw"].stat().st_size < 5000:
            raise RuntimeError(f"I2V raw manquant: {paths['raw']}")

        set_progress(
            step="video_ai",
            video_id=video_id,
            message=f"Nettoyage loop clip {done_count + 1}/{total_clips}…",
            clips_done=done_count,
            clips_total=total_clips,
            detail=f"scene {scene_idx} clip {clip_idx}",
        )
        trim_loop_tail(paths["raw"], paths["part"])
        clip_plan["output_file"] = paths["part"].name
        clip_plan["i2v_raw"] = paths["raw"].name
        scene["i2v_mode"] = p.get("i2v_mode") or "cli_i2v_clip_batch"
        done_count += 1

        plans = scene.get("clip_plans") or []
        _sync_scene_clip_files(scene, clips_dir, plans, scene_idx)
        board_path.write_text(
            json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        log_event(
            video_id,
            "info",
            f"I2V clip scene {scene_idx}/{clip_idx}: {paths['part'].name}",
        )

    # Sync final pour scenes deja en cache
    for scene in board.get("scenes") or []:
        scene_idx = int(scene.get("index") or 0)
        plans = scene.get("clip_plans") or []
        if plans:
            _sync_scene_clip_files(scene, clips_dir, plans, scene_idx)

    board["pipeline"] = "i2v_clip_plans_anti_loop"
    board["i2v_mode"] = health.get("mode")
    board_path.write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
    update_video(video_id, statut="images_ok")
    log_event(
        video_id,
        "info",
        f"Pipeline I2V OK : {total_clips} clips courts (3-5 s, trim anti-loop).",
    )
    set_progress(
        step="video_ai",
        video_id=video_id,
        message=f"I2V termine — {total_clips} clips",
        clips_done=total_clips,
        clips_total=total_clips,
        detail="pret pour montage",
    )
    return {
        "ok": True,
        "provider": "i2v",
        "model": "LTX/Wan-clip-batch",
        "clips": total_clips,
        "dir": str(clips_dir),
    }
