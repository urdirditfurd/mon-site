"""Pipeline Image-to-Video — vraie animation (pas diaporama / Wav2Lip).

1 TTS (deja fait) → 2 Image scene 16:9 Pixar → 3 Wan/LTX I2V (batch) → 4 Mux audio → 5 Montage

Batch critique : 1 chargement modele pour toutes les scenes restantes
(sinon chaque CLI recharge = 10+ min/scene).
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
from modules.i2v_ai import (
    MOTION_PROMPT,
    animate_scene_i2v,
    animate_scenes_i2v_batch,
    i2v_health,
)
from modules.image_ai import generate_scene_image, set_image_output_size
from modules.progress import set_progress
from modules.storyboard import enrich_board_visual_prompts
from modules.youth_spec import normalize_age, youth_profile

PIXAR_SCENE_PREFIX = (
    "cute 3D Pixar style children's film still, vibrant pastel colors, "
    "bright soft lighting, highly detailed, cinematic 16:9 composition, "
    "clear character in environment, friendly expression, sharp focus"
)


def _ffprobe_duration(path: Path) -> float:
    out = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        text=True,
    ).strip()
    return float(out)


def _scene_image_prompt(scene: dict[str, Any], board: dict[str, Any]) -> str:
    """Utilise le visual_prompt EN du storyboard (LLM) — pas le script FR."""
    base = str(scene.get("visual_prompt") or "").strip()
    style = str(board.get("visual_style") or "")
    # Si deja un prompt EN riche, ne pas re-injecter le theme FR
    if base and len(base) > 60:
        if style and style.lower() not in base.lower():
            return f"{PIXAR_SCENE_PREFIX}. {style}. {base}"
        return f"{PIXAR_SCENE_PREFIX}. {base}"
    theme = str(board.get("hero_description") or board.get("theme") or board.get("hero") or "")
    age = normalize_age(str(board.get("age_group") or "1-10"))
    profile = youth_profile(age)
    color = str(profile.get("color_prompt") or "")
    return (
        f"{PIXAR_SCENE_PREFIX}. {style}. {base}. "
        f"Main subject: {theme}. {color}. "
        f"no text, no watermark, no logo, not a close-up portrait only"
    )


def _motion_prompt(scene: dict[str, Any], board: dict[str, Any]) -> str:
    """Motion I2V : base visuelle EN + mouvement doux/net (pas la narration FR)."""
    visual = str(scene.get("visual_prompt") or "").strip()
    theme = str(
        board.get("hero_description") or board.get("theme") or board.get("hero") or "character"
    )
    age = normalize_age(str(board.get("age_group") or "1-10"))
    profile = youth_profile(age)
    motion = str(profile.get("motion_prompt") or "")
    head = visual if visual else f"Cute Pixar 3D animated shot of {theme}"
    return (
        f"{head}. Soft gentle acting, speaking naturally. {motion}. {MOTION_PROMPT}"
    )


def _fit_video_to_audio(video: Path, audio: Path, out: Path, fps: int = 24) -> None:
    """Boucle le clip I2V anime jusqu'a la duree audio (mouvement reel, pas image fixe)."""
    dur = max(1.0, _ffprobe_duration(audio))
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-y",
        "-stream_loop",
        "-1",
        "-i",
        str(video),
        "-i",
        str(audio),
        "-t",
        f"{dur:.3f}",
        "-vf",
        f"scale=1920:1080:force_original_aspect_ratio=decrease,"
        f"pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,fps={fps},format=yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        "-r",
        str(fps),
        str(out),
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def _scene_audio(projet: Path, idx: int) -> Path | None:
    audio_dir = projet / "audio"
    scene = audio_dir / f"scene_{idx:03d}.mp3"
    if scene.exists():
        return scene
    parts = sorted(audio_dir.glob(f"scene_{idx:03d}_line*.mp3"))
    return parts[0] if parts else None


def generate_i2v_videos(video_id: int) -> dict[str, Any]:
    """Etapes 2–4 : image scene → I2V batch → mux audio."""
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
    profile = youth_profile(age)
    fps = int(profile.get("fps") or 24)

    health = i2v_health()
    if not health.get("ready"):
        raise RuntimeError(
            "Moteur Wan I2V indisponible. "
            "powershell -ExecutionPolicy Bypass -File pinokio\\wan-i2v\\INSTALL-I2V.ps1 "
            "puis LANCER-I2V.bat (http://127.0.0.1:7861)."
        )
    log_event(
        video_id,
        "info",
        f"Pipeline I2V : mode={health.get('mode')} url={health.get('url')} batch=on",
    )

    # Aligner image source = resolution I2V (evite deformation / flou)
    img_w = int(PINOKIO_I2V_WIDTH or 1024)
    img_h = int(PINOKIO_I2V_HEIGHT or 576)
    set_image_output_size(img_w, img_h)

    # Regenerer prompts EN si storyboard ancien (script FR brut)
    n_enriched = enrich_board_visual_prompts(board, force=False)
    if n_enriched:
        board_path.write_text(
            json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        log_event(
            video_id,
            "info",
            f"Prompts visuels EN enrichis (LLM/fallback) : {n_enriched} scene(s).",
        )

    theme_key = str(board.get("theme") or board.get("hero") or "conte")
    base_seed = int(hashlib.md5(theme_key.encode("utf-8")).hexdigest()[:8], 16) % 1_000_000

    scenes = board.get("scenes") or []
    total = len(scenes)
    if total == 0:
        raise RuntimeError("Aucune scene dans le storyboard")

    pending: list[dict[str, Any]] = []

    # --- Phase 1 : skip deja faits + generer images manquantes ---
    for i, scene in enumerate(scenes):
        idx = int(scene["index"])
        still = stills_dir / f"scene_{idx:03d}.png"
        raw = raw_dir / f"scene_{idx:03d}_i2v.mp4"
        final = clips_dir / f"scene_{idx:03d}_part00.mp4"

        if final.exists() and final.stat().st_size > 5000:
            scene["ai_clip_files"] = [final.name]
            scene["ai_clips_planned"] = 1
            scene["still_image"] = still.name if still.exists() else scene.get("still_image")
            scene["i2v_raw"] = raw.name if raw.exists() else scene.get("i2v_raw")
            scene["i2v_mode"] = scene.get("i2v_mode") or "cached"
            log_event(video_id, "info", f"I2V scene {idx}: skip (deja pret)")
            set_progress(
                step="video_ai",
                video_id=video_id,
                message=f"I2V {i + 1}/{total} deja OK (reprise)",
                clips_done=i + 1,
                clips_total=total,
                detail=f"Scene {idx} ignoree (fichier existant)",
            )
            continue

        # Raw I2V deja la + still bonne res → juste mux plus tard
        still_ok = False
        if still.exists() and still.stat().st_size > 1000:
            try:
                with Image.open(still) as im:
                    still_ok = im.size == (img_w, img_h)
            except Exception:
                still_ok = False

        if raw.exists() and raw.stat().st_size > 5000 and still_ok:
            pending.append(
                {
                    "i": i,
                    "idx": idx,
                    "scene": scene,
                    "still": still,
                    "raw": raw,
                    "final": final,
                    "need_i2v": False,
                }
            )
            continue

        set_progress(
            step="video_ai",
            video_id=video_id,
            message=f"I2V scene {i + 1}/{total} — image Pixar…",
            clips_done=i,
            clips_total=total,
            detail="Etape 2/5 : storyboard image",
        )
        if not still_ok:
            generate_scene_image(
                _scene_image_prompt(scene, board),
                still,
                seed=(base_seed + idx * 17) % 1_000_000,
                width=img_w,
                height=img_h,
            )
            # Nouvelle image → invalider raw ancien (res/flou)
            if raw.exists():
                try:
                    raw.unlink(missing_ok=True)
                except OSError:
                    pass

        pending.append(
            {
                "i": i,
                "idx": idx,
                "scene": scene,
                "still": still,
                "raw": raw,
                "final": final,
                "need_i2v": not (raw.exists() and raw.stat().st_size > 5000),
                "prompt": _motion_prompt(scene, board),
                "seed": (base_seed + idx * 31) % 1_000_000,
            }
        )

    # --- Phase 2 : batch I2V (1 chargement modele) ---
    to_animate = [p for p in pending if p.get("need_i2v")]
    if to_animate:
        set_progress(
            step="video_ai",
            video_id=video_id,
            message=f"I2V batch {len(to_animate)} scene(s) — 1 chargement modele…",
            clips_done=total - len(pending),
            clips_total=total,
            detail="Etape 3/5 : Image-to-Video batch (22 steps · 1024x576 · motion douce)",
        )
        log_event(
            video_id,
            "info",
            f"I2V batch start: {len(to_animate)} scenes (1 load modele)",
        )
        batch_jobs = [
            {
                "image": p["still"],
                "dest": p["raw"],
                "prompt": p.get("prompt") or "",
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
                            p["still"],
                            p["raw"],
                            prompt=str(p.get("prompt") or ""),
                            seed=p.get("seed"),
                        )
                    )
                except Exception as exc2:
                    batch_results.append({"ok": False, "error": str(exc2)[:500]})

        for p, result in zip(to_animate, batch_results):
            if not result.get("ok"):
                raise RuntimeError(
                    f"I2V scene {p['idx']} echoue: {result.get('error') or result}"
                )
            p["i2v_mode"] = result.get("mode") or "cli_i2v_batch"
            p["need_i2v"] = False

    # --- Phase 3 : mux audio + checkpoint ---
    for p in pending:
        i = int(p["i"])
        idx = int(p["idx"])
        scene = p["scene"]
        still: Path = p["still"]
        raw: Path = p["raw"]
        final: Path = p["final"]

        if not raw.exists() or raw.stat().st_size < 5000:
            raise RuntimeError(f"I2V raw manquant pour scene {idx}: {raw}")

        set_progress(
            step="video_ai",
            video_id=video_id,
            message=f"I2V scene {i + 1}/{total} — sync audio…",
            clips_done=i,
            clips_total=total,
            detail="Etape 4/5 : mux voix sur clip anime",
        )
        audio = _scene_audio(projet, idx)
        if audio and audio.exists():
            _fit_video_to_audio(raw, audio, final, fps=fps)
        else:
            final.write_bytes(raw.read_bytes())

        scene["ai_clip_files"] = [final.name]
        scene["ai_clips_planned"] = 1
        scene["still_image"] = still.name
        scene["i2v_raw"] = raw.name
        scene["i2v_mode"] = p.get("i2v_mode") or "cli_i2v_batch"
        board_path.write_text(
            json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        log_event(
            video_id,
            "info",
            f"I2V scene {idx}: {scene['i2v_mode']} → {final.name}",
        )
        set_progress(
            step="video_ai",
            video_id=video_id,
            message=f"I2V {i + 1}/{total} OK",
            clips_done=i + 1,
            clips_total=total,
            detail=f"Scene {idx} animee [{scene['i2v_mode']}]",
        )

    board["pipeline"] = "i2v_ltx_wan_batch"
    board["i2v_mode"] = health.get("mode")
    board_path.write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
    update_video(video_id, statut="images_ok")
    log_event(
        video_id,
        "info",
        f"Pipeline I2V OK : {total} scenes (batch, 33f/8steps).",
    )
    return {
        "ok": True,
        "provider": "i2v",
        "model": "LTX/Wan-1.3B-batch",
        "clips": total,
        "dir": str(clips_dir),
    }
