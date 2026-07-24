"""Étape 4 — Montage FFmpeg : clips vidéo IA + audio + musique → MP4 final.

Sous-titres optionnels (case a cocher dans Creation).
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from config import EXPORTS_DIR, MUSIC_DIR, MUSIC_VOLUME, VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH
from db.database import get_video, log_event, update_video, video_title
import config as cfg


def _find_music(preference: str = "berceuse") -> Path | None:
    pref = (preference or "berceuse").strip().lower()
    if pref in {"aucune", "none", "off", "0"}:
        return None
    if pref in {"fichier", "file", "assets"}:
        for ext in ("*.mp3", "*.m4a", "*.wav", "*.ogg"):
            files = sorted(MUSIC_DIR.glob(ext))
            if files:
                return files[0]
        return None
    # berceuse générée (libre)
    MUSIC_DIR.mkdir(parents=True, exist_ok=True)
    lullaby = MUSIC_DIR / "berceuse_douce.ogg"
    if lullaby.exists() and lullaby.stat().st_size > 1000:
        return lullaby
    # Génère ~10 min de tonalité douce (sine basse + vibrato léger)
    cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=220:sample_rate=44100:duration=600",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=330:sample_rate=44100:duration=600",
        "-filter_complex",
        "[0][1]amix=inputs=2:duration=first,volume=0.18,lowpass=f=1200",
        "-c:a",
        "libvorbis",
        "-q:a",
        "4",
        str(lullaby),
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        return lullaby if lullaby.exists() else None
    except Exception:
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


def _srt_timestamp(sec: float) -> str:
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = int(sec % 60)
    ms = int((sec - int(sec)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _write_srt(board: dict[str, Any], out: Path) -> Path:
    lines: list[str] = []
    t = 0.0
    for i, scene in enumerate(board.get("scenes") or [], start=1):
        dur = float(scene.get("duration_sec") or 5)
        text = str(
            scene.get("narration") or scene.get("texte") or scene.get("text") or ""
        ).strip()
        if not text:
            text = f"Scene {i}"
        wrapped = text if len(text) < 90 else text[:87] + "…"
        lines.append(str(i))
        lines.append(f"{_srt_timestamp(t)} --> {_srt_timestamp(t + dur)}")
        lines.append(wrapped)
        lines.append("")
        t += dur
    out.write_text("\n".join(lines), encoding="utf-8")
    return out


def _is_image(path: Path) -> bool:
    return path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


def _image_to_motion_clip(src: Path, duration: float, out: Path, motion: str = "zoom_in") -> None:
    """Mouvement doux varié (zoom / pan) — évite le même effet « grossit » partout."""
    if out.exists():
        return
    duration = max(1.0, float(duration))
    frames = max(VIDEO_FPS, int(round(duration * VIDEO_FPS)))
    # Expressions zoompan selon le type de mouvement
    if motion == "zoom_out":
        z = "if(eq(on,1),1.12,max(1.0,1.12-0.00035*on))"
        x = "iw/2-(iw/zoom/2)"
        y = "ih/2-(ih/zoom/2)"
    elif motion == "pan_right":
        z = "1.08"
        x = "min((iw-iw/zoom)*on/{0}, iw-iw/zoom)".format(max(1, frames - 1))
        y = "ih/2-(ih/zoom/2)"
    elif motion == "pan_left":
        z = "1.08"
        x = "max((iw-iw/zoom)*(1-on/{0}), 0)".format(max(1, frames - 1))
        y = "ih/2-(ih/zoom/2)"
    else:  # zoom_in
        z = "min(1.0+0.00035*on,1.12)"
        x = "iw/2-(iw/zoom/2)"
        y = "ih/2-(ih/zoom/2)"

    vf = (
        f"scale={cfg.VIDEO_WIDTH * 2}:{cfg.VIDEO_HEIGHT * 2}:force_original_aspect_ratio=increase,"
        f"crop={cfg.VIDEO_WIDTH * 2}:{cfg.VIDEO_HEIGHT * 2},"
        f"zoompan=z='{z}':x='{x}':y='{y}':"
        f"d={frames}:s={cfg.VIDEO_WIDTH}x{cfg.VIDEO_HEIGHT}:fps={VIDEO_FPS},"
        f"format=yuv420p"
    )
    cmd = [
        "ffmpeg",
        "-y",
        "-loop",
        "1",
        "-i",
        str(src),
        "-t",
        f"{duration:.3f}",
        "-vf",
        vf,
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        str(out),
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def _fit_clip_to_duration(src: Path, duration: float, out: Path, motion: str = "zoom_in") -> None:
    """Aligne sur la durée audio SANS rejouer l'action en boucle.

    1) Si assez long → coupe
    2) Si un peu court → ralentit jusqu'à ×2.2 (motion visible)
    3) Si encore trop court → ralentit + freeze dernière frame (dernier recours)
    """
    if out.exists():
        return
    if _is_image(src):
        _image_to_motion_clip(src, duration, out, motion=motion)
        return

    duration = max(1.0, float(duration))
    try:
        src_dur = max(0.1, _ffprobe_duration(src))
    except Exception:
        src_dur = duration

    scale_pad = (
        f"scale={cfg.VIDEO_WIDTH}:{cfg.VIDEO_HEIGHT}:force_original_aspect_ratio=decrease,"
        f"pad={cfg.VIDEO_WIDTH}:{cfg.VIDEO_HEIGHT}:(ow-iw)/2:(oh-ih)/2,"
        f"fps={VIDEO_FPS},format=yuv420p"
    )

    if src_dur >= duration - 0.05:
        vf = scale_pad
        cmd = [
            "ffmpeg", "-y", "-i", str(src),
            "-t", f"{duration:.3f}", "-vf", vf, "-an",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", str(out),
        ]
    else:
        # Ralentir (max ×2.2) pour garder du mouvement, puis freeze si besoin
        max_slow = 2.2
        slow_factor = min(max_slow, duration / src_dur)
        slowed_dur = src_dur * slow_factor
        pad_sec = max(0.0, duration - slowed_dur)
        # setpts: facteur >1 = plus lent
        vf = f"{scale_pad},setpts={slow_factor:.4f}*PTS"
        if pad_sec > 0.05:
            vf += f",tpad=stop_mode=clone:stop_duration={pad_sec:.3f}"
        cmd = [
            "ffmpeg", "-y", "-i", str(src),
            "-vf", vf, "-t", f"{duration:.3f}", "-an",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", str(out),
        ]
    subprocess.run(cmd, check=True, capture_output=True)


def _concat_parts_xfade(parts: list[Path], out: Path) -> None:
    """Enchaîne plusieurs clips Wan avec fondus courts (= vraie vidéo continue)."""
    if len(parts) == 1:
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(parts[0]), "-c", "copy", str(out)],
            check=True,
            capture_output=True,
        )
        return
    if len(parts) == 2:
        # xfade simple
        try:
            d0 = max(0.3, _ffprobe_duration(parts[0]) - 0.25)
            filter_complex = (
                f"[0:v][1:v]xfade=transition=fade:duration=0.25:offset={d0:.3f},format=yuv420p"
            )
            cmd = [
                "ffmpeg", "-y",
                "-i", str(parts[0]), "-i", str(parts[1]),
                "-filter_complex", filter_complex,
                "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                str(out),
            ]
            subprocess.run(cmd, check=True, capture_output=True)
            return
        except Exception:
            pass
    _concat_parts(parts, out)


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


def assemble_video(video_id: int, with_subtitles: bool = False) -> dict[str, Any]:
    from modules.creative_options import format_size

    video = get_video(video_id)
    if not video:
        raise ValueError(f"Vidéo introuvable: {video_id}")
    titre = video_title(video)
    projet = Path(video["chemin_projet"])
    board = json.loads((projet / "storyboard.json").read_text(encoding="utf-8"))
    # Appliquer le format choisi (16:9 / 9:16 / 1:1)
    w, h = format_size(str(board.get("aspect") or "16:9"))
    cfg.VIDEO_WIDTH = w
    cfg.VIDEO_HEIGHT = h

    ai_dir = projet / "ai_clips"
    audio_dir = projet / "audio"
    fitted_dir = projet / "clips"
    fitted_dir.mkdir(parents=True, exist_ok=True)

    narration = audio_dir / "narration.mp3"
    if not narration.exists():
        raise FileNotFoundError("narration.mp3 manquant — lancez l'audio d'abord.")

    scene_clips: list[Path] = []
    motions = ["zoom_in", "pan_right", "zoom_out", "pan_left"]
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

        fitted = fitted_dir / f"scene_{idx:03d}.mp4"
        motion = motions[(idx - 1) % len(motions)]
        if len(parts) == 1 and _is_image(parts[0]):
            _image_to_motion_clip(parts[0], dur, fitted, motion=motion)
        elif all(_is_image(p) for p in parts):
            # Plusieurs images : Ken Burns chacune puis concat
            video_parts: list[Path] = []
            slice_dur = max(1.5, dur / len(parts))
            for i, p in enumerate(parts):
                tmp = fitted_dir / f"scene_{idx:03d}_img{i:02d}.mp4"
                _image_to_motion_clip(p, slice_dur, tmp, motion=motions[(idx + i) % len(motions)])
                video_parts.append(tmp)
            raw = fitted_dir / f"scene_{idx:03d}_raw.mp4"
            _concat_parts(video_parts, raw)
            _fit_clip_to_duration(raw, dur, fitted, motion=motion)
        else:
            # Clips Wan : normaliser puis xfade, puis fit durée audio
            norm_parts: list[Path] = []
            for i, p in enumerate(parts):
                if _is_image(p):
                    tmp = fitted_dir / f"scene_{idx:03d}_img{i:02d}.mp4"
                    _image_to_motion_clip(p, max(2.0, dur / len(parts)), tmp, motion=motion)
                    norm_parts.append(tmp)
                else:
                    # Normalise résolution/fps sans étirer encore
                    tmp = fitted_dir / f"scene_{idx:03d}_n{i:02d}.mp4"
                    if not tmp.exists():
                        subprocess.run(
                            [
                                "ffmpeg", "-y", "-i", str(p),
                                "-vf",
                                f"scale={cfg.VIDEO_WIDTH}:{cfg.VIDEO_HEIGHT}:force_original_aspect_ratio=decrease,"
                                f"pad={cfg.VIDEO_WIDTH}:{cfg.VIDEO_HEIGHT}:(ow-iw)/2:(oh-ih)/2,"
                                f"fps={VIDEO_FPS},format=yuv420p",
                                "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                                str(tmp),
                            ],
                            check=True,
                            capture_output=True,
                        )
                    norm_parts.append(tmp)
            raw = fitted_dir / f"scene_{idx:03d}_raw.mp4"
            _concat_parts_xfade(norm_parts, raw)
            _fit_clip_to_duration(raw, dur, fitted, motion=motion)
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
    safe_title = "".join(c if c.isalnum() or c in "-_" else "_" for c in titre)[:60]
    final_path = EXPORTS_DIR / f"{video_id:04d}_{safe_title}.mp4"

    music = _find_music(str(board.get("music") or "berceuse"))
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

    srt_path = None
    if with_subtitles:
        srt_path = projet / "subtitles.srt"
        _write_srt(board, srt_path)

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
        "titre": titre,
        "description": (
            f"🌙 {titre}\n\n"
            f"Conte généré par IA (~{total/60:.0f} min).\n"
            f"Thème : {video.get('theme') or 'aventure magique'}.\n"
            f"#conte #enfants #histoiredusoir\n"
        ),
        "tags": _build_tags(video),
        "video": str(final_path),
        "duree_sec": total,
        "subtitles": bool(with_subtitles and srt_path and srt_path.exists()),
        "srt": str(srt_path) if srt_path else None,
    }
    (projet / "publish.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    update_video(video_id, statut="pret", chemin_video=str(final_path), duree_sec=total)
    log_event(video_id, "info", f"Montage terminé : {final_path.name} ({total/60:.1f} min)")
    return {"ok": True, "video": str(final_path), "duree_sec": total, "meta": meta}


def _build_tags(video: dict[str, Any]) -> list[str]:
    from config import DEFAULT_TAGS

    tags = list(DEFAULT_TAGS)
    if video.get("theme"):
        tags.append(str(video["theme"])[:40])
    return tags[:15]
