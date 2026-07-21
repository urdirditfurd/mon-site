"""Étape 5 — Montage FFmpeg : Ken Burns + audio + musique + sous-titres."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from config import (
    EXPORTS_DIR,
    MUSIC_DIR,
    MUSIC_VOLUME,
    VIDEO_FPS,
    VIDEO_HEIGHT,
    VIDEO_WIDTH,
)
from db.database import get_video, log_event, update_video


def _sec_to_srt(t: float) -> str:
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    ms = int(round((t - int(t)) * 1000))
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _write_srt(board: dict[str, Any], out_path: Path) -> None:
    cursor = 0.0
    lines: list[str] = []
    for i, scene in enumerate(board["scenes"], start=1):
        dur = float(scene.get("duration_sec") or scene.get("target_duration_sec") or 5)
        start = cursor
        end = cursor + max(dur - 0.05, 0.2)
        text = scene["narration"].replace("\n", " ").strip()
        # Sous-titres courts pour enfants : découpe ~80 car.
        chunks = []
        words = text.split()
        buf: list[str] = []
        for w in words:
            trial = (" ".join(buf + [w])).strip()
            if len(trial) > 72 and buf:
                chunks.append(" ".join(buf))
                buf = [w]
            else:
                buf.append(w)
        if buf:
            chunks.append(" ".join(buf))
        if not chunks:
            chunks = [text]
        piece = dur / len(chunks)
        for j, chunk in enumerate(chunks):
            a = start + j * piece
            b = start + (j + 1) * piece
            lines.append(str(len(lines) + 1))
            lines.append(f"{_sec_to_srt(a)} --> {_sec_to_srt(b)}")
            lines.append(chunk)
            lines.append("")
        cursor = end + 0.05
    out_path.write_text("\n".join(lines), encoding="utf-8")


def _find_music() -> Path | None:
    for ext in ("*.mp3", "*.m4a", "*.wav", "*.ogg"):
        files = sorted(MUSIC_DIR.glob(ext))
        if files:
            return files[0]
    return None


def _ken_burns_clip(image: Path, duration: float, out_mp4: Path, zoom_in: bool) -> None:
    # Zoom/pan léger (effet Ken Burns) — léger pour rester fluide sur VPS CPU
    frames = max(int(duration * VIDEO_FPS), 1)
    z_start, z_end = (1.0, 1.12) if zoom_in else (1.12, 1.0)
    z_expr = f"'{z_start}+({z_end}-{z_start})*on/{frames}'"
    vf = (
        f"scale={VIDEO_WIDTH * 2}:{VIDEO_HEIGHT * 2},"
        f"zoompan=z={z_expr}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
        f"d={frames}:s={VIDEO_WIDTH}x{VIDEO_HEIGHT}:fps={VIDEO_FPS},"
        f"format=yuv420p"
    )
    cmd = [
        "ffmpeg",
        "-y",
        "-loop",
        "1",
        "-i",
        str(image),
        "-vf",
        vf,
        "-t",
        f"{duration:.3f}",
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        str(out_mp4),
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def assemble_video(video_id: int, burn_subs: bool = True) -> dict[str, Any]:
    video = get_video(video_id)
    if not video:
        raise ValueError(f"Vidéo introuvable: {video_id}")
    projet = Path(video["chemin_projet"])
    board = json.loads((projet / "storyboard.json").read_text(encoding="utf-8"))
    images_dir = projet / "images"
    audio_dir = projet / "audio"
    clips_dir = projet / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)

    narration = audio_dir / "narration.mp3"
    if not narration.exists():
        raise FileNotFoundError("narration.mp3 manquant — lancez l'audio d'abord.")

    clip_paths: list[Path] = []
    for i, scene in enumerate(board["scenes"]):
        dur = float(scene.get("duration_sec") or 5)
        img = images_dir / scene["image_file"]
        if not img.exists():
            raise FileNotFoundError(f"Image manquante: {img}")
        clip = clips_dir / f"clip_{scene['index']:03d}.mp4"
        if not clip.exists():
            _ken_burns_clip(img, dur, clip, zoom_in=(i % 2 == 0))
        clip_paths.append(clip)

    list_file = clips_dir / "concat.txt"
    list_file.write_text(
        "\n".join(f"file '{p.name}'" for p in clip_paths) + "\n", encoding="utf-8"
    )
    silent_video = clips_dir / "video_silent.mp4"
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
            str(silent_video),
        ],
        check=True,
        cwd=str(clips_dir),
        capture_output=True,
    )

    srt_path = projet / "subtitles.srt"
    _write_srt(board, srt_path)

    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    safe_title = "".join(c if c.isalnum() or c in "-_" else "_" for c in video["titre"])[:60]
    final_path = EXPORTS_DIR / f"{video_id:04d}_{safe_title}.mp4"

    music = _find_music()
    filter_parts = []
    inputs = ["-i", str(silent_video), "-i", str(narration)]
    # [0:v] video, [1:a] narration
    audio_map = "[1:a]"
    if music:
        inputs += ["-stream_loop", "-1", "-i", str(music)]
        filter_parts.append(
            f"[2:a]volume={MUSIC_VOLUME},aloop=loop=-1:size=2e+09[bg];"
            f"[1:a][bg]amix=inputs=2:duration=first:dropout_transition=2[aout]"
        )
        audio_map = "[aout]"

    if burn_subs:
        # Escape path for subtitles filter
        srt_esc = str(srt_path).replace("\\", "/").replace(":", "\\:")
        vf = f"subtitles='{srt_esc}':force_style='FontSize=22,PrimaryColour=&H00FFFFFF&,Outline=2'"
    else:
        vf = "null"

    cmd = ["ffmpeg", "-y", *inputs]
    if filter_parts:
        cmd += ["-filter_complex", ";".join(filter_parts), "-map", "0:v", "-map", audio_map]
    else:
        cmd += ["-map", "0:v", "-map", "1:a"]

    if burn_subs:
        cmd += ["-vf", vf]

    cmd += [
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "22",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        "-movflags",
        "+faststart",
        str(final_path),
    ]
    subprocess.run(cmd, check=True, capture_output=True)

    # Métadonnées SEO
    meta = {
        "titre": video["titre"],
        "description": _build_description(video, board),
        "tags": _build_tags(video),
        "video": str(final_path),
        "srt": str(srt_path),
        "duree_sec": video.get("duree_sec"),
    }
    (projet / "publish.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    update_video(video_id, statut="pret", chemin_video=str(final_path))
    log_event(video_id, "info", f"Montage terminé : {final_path.name}")
    return {"ok": True, "video": str(final_path), "srt": str(srt_path), "meta": meta}


def _build_description(video: dict[str, Any], board: dict[str, Any]) -> str:
    minutes = (video.get("duree_sec") or 0) / 60
    return (
        f"🌙 {video['titre']}\n\n"
        f"Un conte doux pour s'endormir (~{minutes:.0f} min).\n"
        f"Thème : {video.get('theme') or 'aventure magique'}.\n\n"
        f"Parfait pour le soir, en famille.\n"
        f"#conte #enfants #histoiredusoir\n"
    )


def _build_tags(video: dict[str, Any]) -> list[str]:
    from config import DEFAULT_TAGS

    tags = list(DEFAULT_TAGS)
    if video.get("theme"):
        tags.append(str(video["theme"])[:40])
    return tags[:15]
