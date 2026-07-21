"""Étape 4 — Montage FFmpeg : clips vidéo IA + audio + musique → MP4 final.

Pas de sous-titres (exigence projet : l'audio suffit).
Publication YouTube déclenchée ensuite par l'orchestrateur.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from config import EXPORTS_DIR, MUSIC_DIR, MUSIC_VOLUME, VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH
from db.database import get_video, log_event, update_video


def _find_music() -> Path | None:
    for ext in ("*.mp3", "*.m4a", "*.wav", "*.ogg"):
        files = sorted(MUSIC_DIR.glob(ext))
        if files:
            return files[0]
    return None


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


def _fit_clip_to_duration(src: Path, duration: float, out: Path) -> None:
    """Boucle / coupe un clip IA pour coller exactement à la durée audio de la scène."""
    if out.exists():
        return
    # stream_loop puis -t pour caler la durée
    cmd = [
        "ffmpeg",
        "-y",
        "-stream_loop",
        "-1",
        "-i",
        str(src),
        "-t",
        f"{duration:.3f}",
        "-vf",
        f"scale={VIDEO_WIDTH}:{VIDEO_HEIGHT}:force_original_aspect_ratio=decrease,"
        f"pad={VIDEO_WIDTH}:{VIDEO_HEIGHT}:(ow-iw)/2:(oh-ih)/2,fps={VIDEO_FPS},format=yuv420p",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "22",
        str(out),
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def _concat_parts(parts: list[Path], out: Path) -> None:
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


def assemble_video(video_id: int) -> dict[str, Any]:
    video = get_video(video_id)
    if not video:
        raise ValueError(f"Vidéo introuvable: {video_id}")
    projet = Path(video["chemin_projet"])
    board = json.loads((projet / "storyboard.json").read_text(encoding="utf-8"))
    ai_dir = projet / "ai_clips"
    audio_dir = projet / "audio"
    fitted_dir = projet / "clips"
    fitted_dir.mkdir(parents=True, exist_ok=True)

    narration = audio_dir / "narration.mp3"
    if not narration.exists():
        raise FileNotFoundError("narration.mp3 manquant — lancez l'audio d'abord.")

    scene_clips: list[Path] = []
    for scene in board["scenes"]:
        idx = int(scene["index"])
        dur = float(scene.get("duration_sec") or 5)
        files = scene.get("ai_clip_files") or []
        if not files:
            raise FileNotFoundError(
                f"Aucun clip IA pour la scène {idx} — lancez le moteur vidéo IA."
            )
        parts = [ai_dir / name for name in files]
        for p in parts:
            if not p.exists():
                raise FileNotFoundError(f"Clip IA manquant: {p}")

        # Concatène les parts de la scène puis ajuste à la durée audio
        raw = fitted_dir / f"scene_{idx:03d}_raw.mp4"
        fitted = fitted_dir / f"scene_{idx:03d}.mp4"
        _concat_parts(parts, raw)
        _fit_clip_to_duration(raw, dur, fitted)
        scene_clips.append(fitted)

    list_file = fitted_dir / "concat.txt"
    list_file.write_text(
        "\n".join(f"file '{p.name}'" for p in scene_clips) + "\n", encoding="utf-8"
    )
    silent_video = fitted_dir / "video_silent.mp4"
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
        cwd=str(fitted_dir),
        capture_output=True,
    )

    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    safe_title = "".join(c if c.isalnum() or c in "-_" else "_" for c in video["titre"])[:60]
    final_path = EXPORTS_DIR / f"{video_id:04d}_{safe_title}.mp4"

    music = _find_music()
    inputs = ["-i", str(silent_video), "-i", str(narration)]
    filter_complex = None
    if music:
        inputs += ["-stream_loop", "-1", "-i", str(music)]
        filter_complex = (
            f"[2:a]volume={MUSIC_VOLUME}[bg];"
            f"[1:a][bg]amix=inputs=2:duration=first:dropout_transition=2[aout]"
        )

    cmd = ["ffmpeg", "-y", *inputs]
    if filter_complex:
        cmd += ["-filter_complex", filter_complex, "-map", "0:v", "-map", "[aout]"]
    else:
        cmd += ["-map", "0:v", "-map", "1:a"]

    cmd += [
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
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

    total = _ffprobe_duration(final_path)
    meta = {
        "titre": video["titre"],
        "description": (
            f"🌙 {video['titre']}\n\n"
            f"Conte généré par IA (~{total/60:.0f} min).\n"
            f"Thème : {video.get('theme') or 'aventure magique'}.\n"
            f"#conte #enfants #histoiredusoir\n"
        ),
        "tags": _build_tags(video),
        "video": str(final_path),
        "duree_sec": total,
    }
    (projet / "publish.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    update_video(video_id, statut="pret", chemin_video=str(final_path), duree_sec=total)
    log_event(video_id, "info", f"Montage terminé : {final_path.name} ({total/60:.1f} min)")
    return {"ok": True, "video": str(final_path), "duree_sec": total, "meta": meta}


def _build_tags(video: dict[str, Any]) -> list[str]:
    from config import DEFAULT_TAGS

    tags = list(DEFAULT_TAGS)
    if video.get("theme"):
        tags.append(str(video["theme"])[:40])
    return tags[:15]
