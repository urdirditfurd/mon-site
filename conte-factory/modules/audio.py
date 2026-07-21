"""Étape 3 — Voix off complète (Edge-TTS) + durées réelles par scène."""

from __future__ import annotations

import asyncio
import json
import subprocess
from pathlib import Path
from typing import Any

from config import TTS_RATE, TTS_VOICE
from db.database import get_video, log_event, update_video


def _ffprobe_duration(path: Path) -> float:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    out = subprocess.check_output(cmd, text=True).strip()
    return float(out)


async def _synthesize(text: str, out_path: Path, voice: str, rate: str) -> None:
    import edge_tts

    communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate)
    await communicate.save(str(out_path))


def generate_audio(video_id: int, voice: str | None = None, rate: str | None = None) -> dict[str, Any]:
    video = get_video(video_id)
    if not video:
        raise ValueError(f"Vidéo introuvable: {video_id}")
    projet = Path(video["chemin_projet"])
    board_path = projet / "storyboard.json"
    if not board_path.exists():
        raise FileNotFoundError("storyboard.json manquant.")

    board = json.loads(board_path.read_text(encoding="utf-8"))
    audio_dir = projet / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    voice = voice or TTS_VOICE
    rate = rate or TTS_RATE
    timings: list[dict[str, Any]] = []
    concat_list = audio_dir / "list.txt"
    lines: list[str] = []

    for scene in board["scenes"]:
        idx = int(scene["index"])
        scene_path = audio_dir / f"scene_{idx:03d}.mp3"
        text = scene["narration"].strip()
        if not text:
            text = "..."
        asyncio.run(_synthesize(text, scene_path, voice, rate))
        duration = _ffprobe_duration(scene_path)
        scene["audio_file"] = str(scene_path.name)
        scene["duration_sec"] = round(duration, 3)
        timings.append({"index": idx, "duration_sec": scene["duration_sec"], "file": scene_path.name})
        # FFmpeg concat demuxer
        lines.append(f"file '{scene_path.name}'")

    concat_list.write_text("\n".join(lines) + "\n", encoding="utf-8")
    full_audio = audio_dir / "narration.mp3"
    cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(concat_list),
        "-c",
        "copy",
        str(full_audio),
    ]
    subprocess.run(cmd, check=True, cwd=str(audio_dir), capture_output=True)

    total = sum(t["duration_sec"] for t in timings)
    board["timings"] = timings
    board["total_audio_sec"] = round(total, 3)
    board_path.write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")

    update_video(video_id, statut="audio_ok", duree_sec=total)
    log_event(video_id, "info", f"Audio prêt : {total/60:.1f} min.")
    return {"ok": True, "total_sec": total, "audio": str(full_audio), "scenes": len(timings)}
