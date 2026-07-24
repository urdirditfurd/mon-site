"""Pipeline Image-to-Video — vraie animation (pas diaporama / Wav2Lip).

1 TTS (deja fait) → 2 Image scene 16:9 Pixar → 3 Wan I2V → 4 Mux audio → 5 Montage
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any

from db.database import get_video, log_event, update_video
from modules.i2v_ai import MOTION_PROMPT, animate_scene_i2v, i2v_health
from modules.image_ai import generate_scene_image, set_image_output_size
from modules.progress import set_progress
from modules.youth_spec import normalize_age, youth_profile

PIXAR_SCENE_PREFIX = (
    "cute 3D Pixar style children's film still, vibrant pastel colors, "
    "bright soft lighting, highly detailed, cinematic 16:9 composition, "
    "clear character in environment, friendly expression"
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
    base = str(scene.get("visual_prompt") or "").strip()
    theme = str(board.get("hero_description") or board.get("theme") or board.get("hero") or "")
    style = str(board.get("visual_style") or "")
    age = normalize_age(str(board.get("age_group") or "1-10"))
    profile = youth_profile(age)
    color = str(profile.get("color_prompt") or "")
    return (
        f"{PIXAR_SCENE_PREFIX}. {style}. {base}. "
        f"Main subject: {theme}. {color}. "
        f"no text, no watermark, no logo, not a close-up portrait only"
    )


def _motion_prompt(scene: dict[str, Any], board: dict[str, Any]) -> str:
    theme = str(board.get("hero_description") or board.get("theme") or board.get("hero") or "character")
    narr = str(scene.get("narration") or "")[:160]
    age = normalize_age(str(board.get("age_group") or "1-10"))
    profile = youth_profile(age)
    motion = str(profile.get("motion_prompt") or "")
    return (
        f"Cute Pixar 3D animated shot of {theme}, speaking and acting naturally. "
        f"Scene vibe: {narr}. {motion}. {MOTION_PROMPT}"
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
    """Etapes 2–4 : image scene → Wan I2V → mux audio."""
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
        f"Pipeline I2V : mode={health.get('mode')} url={health.get('url')}",
    )

    set_image_output_size(1280, 720)
    theme_key = str(board.get("theme") or board.get("hero") or "conte")
    base_seed = int(hashlib.md5(theme_key.encode("utf-8")).hexdigest()[:8], 16) % 1_000_000

    scenes = board.get("scenes") or []
    total = len(scenes)
    if total == 0:
        raise RuntimeError("Aucune scene dans le storyboard")

    for i, scene in enumerate(scenes):
        idx = int(scene["index"])
        set_progress(
            step="video_ai",
            video_id=video_id,
            message=f"I2V scene {i + 1}/{total} — image Pixar…",
            clips_done=i,
            clips_total=total,
            detail="Etape 2/5 : storyboard image",
        )
        still = stills_dir / f"scene_{idx:03d}.png"
        generate_scene_image(
            _scene_image_prompt(scene, board),
            still,
            seed=(base_seed + idx * 17) % 1_000_000,
            width=1280,
            height=720,
        )

        set_progress(
            step="video_ai",
            video_id=video_id,
            message=f"I2V scene {i + 1}/{total} — animation Wan…",
            clips_done=i,
            clips_total=total,
            detail="Etape 3/5 : Image-to-Video (mouvement reel)",
        )
        raw = raw_dir / f"scene_{idx:03d}_i2v.mp4"
        result = animate_scene_i2v(
            still,
            raw,
            prompt=_motion_prompt(scene, board),
            seed=(base_seed + idx * 31) % 1_000_000,
        )

        audio = _scene_audio(projet, idx)
        final = clips_dir / f"scene_{idx:03d}_part00.mp4"
        if audio and audio.exists():
            set_progress(
                step="video_ai",
                video_id=video_id,
                message=f"I2V scene {i + 1}/{total} — sync audio…",
                clips_done=i,
                clips_total=total,
                detail="Etape 4/5 : mux voix sur clip anime",
            )
            _fit_video_to_audio(raw, audio, final, fps=fps)
        else:
            # Pas d'audio scene : copie le clip brut
            final.write_bytes(raw.read_bytes())

        scene["ai_clip_files"] = [final.name]
        scene["ai_clips_planned"] = 1
        scene["still_image"] = still.name
        scene["i2v_raw"] = raw.name
        scene["i2v_mode"] = result.get("mode")
        log_event(
            video_id,
            "info",
            f"I2V scene {idx}: {result.get('mode')} → {final.name}",
        )
        set_progress(
            step="video_ai",
            video_id=video_id,
            message=f"I2V {i + 1}/{total} OK",
            clips_done=i + 1,
            clips_total=total,
            detail=f"Scene {idx} animee [{result.get('mode')}]",
        )

    board["pipeline"] = "i2v_wan_fun_1_3b"
    board["i2v_mode"] = health.get("mode")
    board_path.write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
    update_video(video_id, statut="images_ok")
    log_event(video_id, "info", f"Pipeline I2V OK : {total} scenes animees (Wan Fun 1.3B).")
    return {
        "ok": True,
        "provider": "i2v",
        "model": "Wan2.1-Fun-1.3B-InP",
        "clips": total,
        "dir": str(clips_dir),
    }
