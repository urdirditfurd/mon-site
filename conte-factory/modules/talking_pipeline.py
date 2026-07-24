"""Pipeline 4 étapes — génération vidéo personnages parlants.

[Script] → [1 TTS] → [2 Portrait] → [3 Lip-sync] → [4 Montage FFmpeg]

Cette module couvre les étapes 2+3 (l'audio TTS est déjà produit avant).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from db.database import get_video, log_event, update_video
from modules.character_ref import ensure_character_refs
from modules.lipsync_ai import animate_talking_clip, lipsync_health
from modules.progress import set_progress
from modules.youth_spec import normalize_age, youth_profile


def _concat_clips(parts: list[Path], out: Path) -> None:
    import subprocess

    if len(parts) == 1:
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(parts[0]), "-c", "copy", str(out)],
            check=True,
            capture_output=True,
        )
        return
    list_file = out.with_suffix(".txt")
    list_file.write_text(
        "\n".join(f"file '{p.resolve()}'" for p in parts) + "\n", encoding="utf-8"
    )
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(list_file),
            "-c",
            "copy",
            str(out),
        ],
        check=True,
        capture_output=True,
    )


def generate_talking_videos(video_id: int) -> dict[str, Any]:
    """Étapes 2+3 : portraits + lip-sync ligne par ligne → clips scène."""
    video = get_video(video_id)
    if not video:
        raise ValueError(f"Vidéo introuvable: {video_id}")

    projet = Path(video["chemin_projet"])
    board_path = projet / "storyboard.json"
    board = json.loads(board_path.read_text(encoding="utf-8"))
    audio_dir = projet / "audio"
    clips_dir = projet / "ai_clips"
    clips_dir.mkdir(parents=True, exist_ok=True)
    lines_dir = clips_dir / "lines"
    lines_dir.mkdir(parents=True, exist_ok=True)

    age = normalize_age(str(board.get("age_group") or "1-10"))
    profile = youth_profile(age)
    fps = int(profile.get("fps") or 24)
    shot_min = float(profile.get("shot_sec_min") or 4.0)

    health = lipsync_health()
    log_event(
        video_id,
        "info",
        f"Pipeline talking : lipsync mode={health.get('mode')} ready={health.get('ready')}",
    )

    # Étape 2 — portraits ancre
    set_progress(
        step="video_ai",
        video_id=video_id,
        message="Portraits personnages (ancre visuelle)…",
        detail="Style Pixar / visage lisible pour lip-sync",
    )
    refs = ensure_character_refs(projet, board)
    board["character_refs"] = {k: str(v.name) for k, v in refs.items() if k != "choeur"}

    # Compter les jobs (1 clip / réplique)
    jobs: list[tuple[int, int, str, Path, Path]] = []
    for scene in board["scenes"]:
        idx = int(scene["index"])
        dialogue = scene.get("dialogue") or [
            {"speaker": "heros", "text": scene.get("narration") or "..."}
        ]
        for li, line in enumerate(dialogue):
            speaker = str(line.get("speaker") or "heros")
            audio_name = f"scene_{idx:03d}_line{li:02d}.mp3"
            audio_path = audio_dir / audio_name
            if not audio_path.exists():
                # Fallback : audio scène entière une seule fois
                scene_audio = audio_dir / f"scene_{idx:03d}.mp3"
                if scene_audio.exists() and li == 0:
                    audio_path = scene_audio
                else:
                    continue
            img = refs.get(speaker) or refs["heros"]
            out = lines_dir / f"scene_{idx:03d}_line{li:02d}.mp4"
            jobs.append((idx, li, speaker, audio_path, out))

    if not jobs:
        raise RuntimeError(
            "Aucun audio de réplique trouvé — relance l'étape audio (dialogues)."
        )

    warnings: list[str] = []
    done = 0
    for idx, li, speaker, audio_path, out in jobs:
        img = refs.get(speaker) or refs["heros"]
        prompt = (
            f"The character is talking happily to children, subtle head movement, "
            f"blinking naturally, smooth animation, warm lighting, friendly expression"
        )
        result = animate_talking_clip(
            img, audio_path, out, prompt=prompt, fps=fps, allow_fallback=True
        )
        if result.get("warning"):
            warnings.append(str(result["warning"]))
        done += 1
        set_progress(
            step="video_ai",
            video_id=video_id,
            message=f"Lip-sync {done}/{len(jobs)}",
            clips_done=done,
            clips_total=len(jobs),
            detail=f"Scene {idx} replique {li + 1} ({speaker}) [{result.get('mode')}]",
        )
        log_event(
            video_id,
            "info",
            f"Talking clip scene {idx} line {li}: {result.get('mode')}",
        )

    # Regrouper les lignes → 1 clip / scène (pour montage existant)
    for scene in board["scenes"]:
        idx = int(scene["index"])
        line_files = sorted(lines_dir.glob(f"scene_{idx:03d}_line*.mp4"))
        if not line_files:
            continue
        scene_out = clips_dir / f"scene_{idx:03d}_part00.mp4"
        _concat_clips(line_files, scene_out)
        # Respect rythme enfants : plan minimum (pad silencieux interdit — déjà audio)
        # Si clip trop court vs shot_min, le montage gère via fit.
        scene["ai_clip_files"] = [scene_out.name]
        scene["ai_clips_planned"] = 1
        scene["talking_lines"] = len(line_files)

    board["pipeline"] = "talking_4steps"
    board["lipsync_mode"] = health.get("mode")
    board_path.write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
    update_video(video_id, statut="images_ok")

    mode_note = health.get("mode")
    if any("fallback" in (w or "") for w in warnings) or mode_note == "fallback":
        log_event(
            video_id,
            "warn",
            "Video generee en mode portrait+audio (lip-sync moteur absent). "
            "Installe pinokio/talking-wav2lip pour bouche synchronisee.",
        )
    log_event(
        video_id,
        "info",
        f"Talking pipeline OK : {len(jobs)} repliques, fps={fps}, shot_min={shot_min}s.",
    )
    return {
        "ok": True,
        "provider": "talking",
        "model": f"portrait+lipsync[{health.get('mode')}]",
        "clips": len(jobs),
        "warnings": warnings[:5],
        "dir": str(clips_dir),
    }
