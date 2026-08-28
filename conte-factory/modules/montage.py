"""Étape 4 — Montage FFmpeg : clips vidéo IA + audio + musique → MP4 final.

Sous-titres optionnels (case a cocher dans Creation).
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from config import (
    DURATION_TOLERANCE_SEC,
    EXPORTS_DIR,
    MUSIC_DIR,
    MUSIC_VOLUME,
    TARGET_DURATION_MIN,
    VIDEO_FPS,
    VIDEO_HEIGHT,
    VIDEO_WIDTH,
)
from db.database import get_video, log_event, resolve_project_dir, update_video, video_title
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
        # Pas de fichier dans assets/music → berceuse générée (évite vidéo muette)
        pref = "berceuse"
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


def _image_to_motion_clip(
    src: Path,
    duration: float,
    out: Path,
    motion: str = "zoom_in",
    *,
    zoom_delta: float = 0.00028,
    fps: int | None = None,
) -> None:
    """Mouvement doux (Ken Burns) — vitesse adaptée à la tranche d'âge."""
    if out.exists():
        return
    duration = max(1.0, float(duration))
    use_fps = int(fps or cfg.VIDEO_FPS or VIDEO_FPS)
    # Clamp 24–30 (spec jeunesse — jamais 60)
    use_fps = max(24, min(30, use_fps))
    frames = max(use_fps, int(round(duration * use_fps)))
    zd = max(0.00012, float(zoom_delta))
    z_max = 1.0 + zd * frames * 0.35
    z_max = min(1.10, max(1.04, z_max))

    if motion == "zoom_out":
        z = f"if(eq(on,1),{z_max:.4f},max(1.0,{z_max:.4f}-{zd:.6f}*on))"
        x = "iw/2-(iw/zoom/2)"
        y = "ih/2-(ih/zoom/2)"
    elif motion == "pan_right":
        z = "1.06"
        x = "min((iw-iw/zoom)*on/{0}, iw-iw/zoom)".format(max(1, frames - 1))
        y = "ih/2-(ih/zoom/2)"
    elif motion == "pan_left":
        z = "1.06"
        x = "max((iw-iw/zoom)*(1-on/{0}), 0)".format(max(1, frames - 1))
        y = "ih/2-(ih/zoom/2)"
    else:  # zoom_in
        z = f"min(1.0+{zd:.6f}*on,{z_max:.4f})"
        x = "iw/2-(iw/zoom/2)"
        y = "ih/2-(ih/zoom/2)"

    vf = (
        f"scale={cfg.VIDEO_WIDTH * 2}:{cfg.VIDEO_HEIGHT * 2}:force_original_aspect_ratio=increase,"
        f"crop={cfg.VIDEO_WIDTH * 2}:{cfg.VIDEO_HEIGHT * 2},"
        f"zoompan=z='{z}':x='{x}':y='{y}':"
        f"d={frames}:s={cfg.VIDEO_WIDTH}x{cfg.VIDEO_HEIGHT}:fps={use_fps},"
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
        f"fps={max(24, min(30, int(cfg.VIDEO_FPS or VIDEO_FPS)))},format=yuv420p"
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


XFADE_DURATION = 0.5


def _concat_parts_xfade(parts: list[Path], out: Path) -> None:
    """Enchaîne clips avec crossfade 0.5s entre scènes distinctes."""
    if len(parts) == 1:
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(parts[0]), "-c", "copy", str(out)],
            check=True,
            capture_output=True,
        )
        return
    if len(parts) == 2:
        try:
            d0 = max(0.5, _ffprobe_duration(parts[0]) - XFADE_DURATION)
            filter_complex = (
                f"[0:v][1:v]xfade=transition=fade:duration={XFADE_DURATION}:offset={d0:.3f},"
                f"format=yuv420p"
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
    # 3+ clips: chain xfade
    if len(parts) >= 3:
        try:
            durations = [_ffprobe_duration(p) for p in parts]
            inputs = []
            for p in parts:
                inputs += ["-i", str(p)]
            fc_parts = []
            offset = max(0.5, durations[0] - XFADE_DURATION)
            fc_parts.append(
                f"[0:v][1:v]xfade=transition=fade:duration={XFADE_DURATION}:offset={offset:.3f}[v1]"
            )
            for i in range(2, len(parts)):
                prev_label = f"v{i-1}"
                merged_dur = offset + XFADE_DURATION + (durations[i-1] - XFADE_DURATION)
                offset = max(0.5, merged_dur - XFADE_DURATION)
                out_label = f"v{i}" if i < len(parts) - 1 else "vout"
                fc_parts.append(
                    f"[{prev_label}][{i}:v]xfade=transition=fade:duration={XFADE_DURATION}:offset={offset:.3f}[{out_label}]"
                )
            fc = ";".join(fc_parts)
            cmd = [
                "ffmpeg", "-y", *inputs,
                "-filter_complex", f"{fc},format=yuv420p",
                "-map", "[vout]",
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
    from modules.youth_spec import (
        export_size,
        kenburns_zoom_delta,
        normalize_age,
        youth_profile,
    )

    video = get_video(video_id)
    if not video:
        raise ValueError(f"Vidéo introuvable: {video_id}")
    titre = video_title(video)
    projet = resolve_project_dir(video_id, video)
    board = json.loads((projet / "storyboard.json").read_text(encoding="utf-8"))

    age = normalize_age(str(board.get("age_group") or "1-10"))
    profile = youth_profile(age)
    # Spec jeunesse : FPS 24–30, résolution selon âge, musique -12 dB
    use_fps = max(24, min(30, int(profile.get("fps") or 24)))
    cfg.VIDEO_FPS = use_fps
    export_4k = bool(getattr(cfg, "EXPORT_4K", False))
    w, h = export_size(profile, export_4k=export_4k)
    # Respecter aussi le format UI (9:16 / 1:1) si choisi
    aspect = str(board.get("aspect") or profile.get("aspect") or "16:9")
    if aspect != "16:9":
        w, h = format_size(aspect)
        # Pour 9:16 / 1:1 : rester Full HD équivalent (pas 4K portrait lourd)
        if max(w, h) > 1920 and not export_4k:
            scale = 1920 / max(w, h)
            w, h = int(round(w * scale)), int(round(h * scale))
            if w % 2:
                w += 1
            if h % 2:
                h += 1
    cfg.VIDEO_WIDTH = w
    cfg.VIDEO_HEIGHT = h
    music_vol = float(profile.get("music_volume") or cfg.MUSIC_VOLUME)
    zoom_delta = kenburns_zoom_delta(profile)

    ai_dir = projet / "ai_clips"
    audio_dir = projet / "audio"
    fitted_dir = projet / "clips"
    fitted_dir.mkdir(parents=True, exist_ok=True)

    narration = audio_dir / "narration.mp3"
    if not narration.exists():
        raise FileNotFoundError("narration.mp3 manquant — lancez l'audio d'abord.")

    scene_clips: list[Path] = []
    # 1-3 ans : mouvements très lents ; 7-10 : un peu plus de variété
    if age == "1-3":
        motions = ["zoom_in", "pan_right", "zoom_in", "pan_left"]
    else:
        motions = ["zoom_in", "pan_right", "zoom_out", "pan_left"]

    shot_min = float(profile.get("shot_sec_min") or 3.0)
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
            _image_to_motion_clip(
                parts[0], dur, fitted, motion=motion, zoom_delta=zoom_delta, fps=use_fps
            )
        elif all(_is_image(p) for p in parts):
            video_parts: list[Path] = []
            # Plans longs pour les petits : ne pas découper sous shot_min
            slice_dur = max(shot_min, dur / len(parts))
            for i, p in enumerate(parts):
                tmp = fitted_dir / f"scene_{idx:03d}_img{i:02d}.mp4"
                _image_to_motion_clip(
                    p,
                    slice_dur,
                    tmp,
                    motion=motions[(idx + i) % len(motions)],
                    zoom_delta=zoom_delta,
                    fps=use_fps,
                )
                video_parts.append(tmp)
            raw = fitted_dir / f"scene_{idx:03d}_raw.mp4"
            _concat_parts(video_parts, raw)
            _fit_clip_to_duration(raw, dur, fitted, motion=motion)
        else:
            norm_parts: list[Path] = []
            for i, p in enumerate(parts):
                if _is_image(p):
                    tmp = fitted_dir / f"scene_{idx:03d}_img{i:02d}.mp4"
                    _image_to_motion_clip(
                        p,
                        max(shot_min, dur / len(parts)),
                        tmp,
                        motion=motion,
                        zoom_delta=zoom_delta,
                        fps=use_fps,
                    )
                    norm_parts.append(tmp)
                else:
                    tmp = fitted_dir / f"scene_{idx:03d}_n{i:02d}.mp4"
                    if not tmp.exists():
                        subprocess.run(
                            [
                                "ffmpeg", "-y", "-i", str(p),
                                "-vf",
                                f"scale={cfg.VIDEO_WIDTH}:{cfg.VIDEO_HEIGHT}:force_original_aspect_ratio=decrease,"
                                f"pad={cfg.VIDEO_WIDTH}:{cfg.VIDEO_HEIGHT}:(ow-iw)/2:(oh-ih)/2,"
                                f"fps={use_fps},format=yuv420p",
                                "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                                str(tmp),
                            ],
                            check=True,
                            capture_output=True,
                        )
                    norm_parts.append(tmp)
            raw = fitted_dir / f"scene_{idx:03d}_raw.mp4"
            # 1-3 ans : fondus plus longs / soft ; 7-10 : xfade court
            _concat_parts_xfade(norm_parts, raw)
            _fit_clip_to_duration(raw, dur, fitted, motion=motion)
        scene_clips.append(fitted)

    silent_video = fitted_dir / "video_silent.mp4"
    if len(scene_clips) > 1:
        _concat_parts_xfade(scene_clips, silent_video)
    else:
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(scene_clips[0]), "-c", "copy", str(silent_video)],
            check=True, capture_output=True,
        )

    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    safe_title = "".join(c if c.isalnum() or c in "-_" else "_" for c in titre)[:60]
    final_path = EXPORTS_DIR / f"{video_id:04d}_{safe_title}.mp4"

    music = _find_music(str(board.get("music") or "berceuse"))
    inputs = ["-i", str(silent_video), "-i", str(narration)]
    filter_complex = None
    # -16 dB sous la voix ≈ 0.158 linéaire
    music_linear = min(music_vol, 10 ** (-16.0 / 20.0))
    if music:
        inputs += ["-stream_loop", "-1", "-i", str(music)]
        filter_complex = (
            f"[1:a]volume=1.0[vox];"
            f"[2:a]afade=t=in:st=0:d=2.0,volume={music_linear:.4f}[bg];"
            f"[vox][bg]amix=inputs=2:duration=first:dropout_transition=2[aout]"
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

    # Coupe dure a la duree cible (ex: 300s pour 5 min) — +/- tolerance
    target_cap = float(
        board.get("target_audio_sec")
        or (float(board.get("duration_min") or TARGET_DURATION_MIN) * 60.0)
    )
    target_cap = max(30.0, target_cap)

    cmd += [
        "-t",
        f"{target_cap:.3f}",
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
    # Filet de securite si -shortest a laisse un depassement
    if total > target_cap + max(1.0, DURATION_TOLERANCE_SEC):
        trimmed = final_path.with_suffix(".trim.mp4")
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(final_path),
                "-t",
                f"{target_cap:.3f}",
                "-c",
                "copy",
                str(trimmed),
            ],
            check=True,
            capture_output=True,
        )
        trimmed.replace(final_path)
        total = _ffprobe_duration(final_path)
        log_event(
            video_id,
            "info",
            f"Montage coupe a {target_cap:.0f}s (etait trop long).",
        )
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
    log_event(
        video_id,
        "info",
        (
            f"Montage jeunesse {age} : {final_path.name} ({total/60:.1f} min) "
            f"{w}x{h}@{use_fps}fps musique={music_linear:.3f} (-16dB)."
        ),
    )
    return {"ok": True, "video": str(final_path), "duree_sec": total, "meta": meta}


def _build_tags(video: dict[str, Any]) -> list[str]:
    from config import DEFAULT_TAGS

    tags = list(DEFAULT_TAGS)
    if video.get("theme"):
        tags.append(str(video["theme"])[:40])
    return tags[:15]
