"""Étape 3 — Animation + lip-sync (image + audio → MP4).

Providers (gratuits / Pinokio) :
1. Gradio InfiniteTalk / MultiTalk si PINOKIO_LIPSYNC_URL répond (meilleure qualité)
2. Gradio Wav2Lip local (pinokio/talking-wav2lip) — gratuit, RTX 3080 OK
3. Fallback portrait animé FFmpeg (toujours une vidéo, lip-sync approximatif)
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import requests

from config import (
    PINOKIO_LIPSYNC_ENGINE,
    PINOKIO_LIPSYNC_URL,
    PINOKIO_WAN_PYTHON,
    ROOT,
    VIDEO_FPS,
)


def lipsync_health() -> dict[str, Any]:
    info: dict[str, Any] = {
        "url": PINOKIO_LIPSYNC_URL,
        "gradio_up": False,
        "engine": None,
        "ready": False,
        "mode": "fallback",
    }
    try:
        resp = requests.get(PINOKIO_LIPSYNC_URL.rstrip("/") + "/", timeout=2)
        info["gradio_up"] = resp.status_code < 500
    except Exception as exc:
        info["error"] = str(exc)

    engine = resolve_lipsync_engine()
    if engine:
        info["engine"] = str(engine)
        info["engine_ok"] = engine.exists()

    if info["gradio_up"]:
        info["ready"] = True
        info["mode"] = "gradio"
    elif info.get("engine_ok"):
        info["ready"] = True
        info["mode"] = "cli"
    return info


def resolve_lipsync_engine() -> Path | None:
    if PINOKIO_LIPSYNC_ENGINE:
        p = Path(PINOKIO_LIPSYNC_ENGINE)
        if p.exists():
            return p
    candidates = [
        ROOT.parent / "pinokio" / "talking-wav2lip" / "app" / "lipsync_engine.py",
        Path(os.path.expandvars(r"%USERPROFILE%\pinokio\api\talking-wav2lip.git\app\lipsync_engine.py")),
        Path(r"C:\pinokio\api\talking-wav2lip.git\app\lipsync_engine.py"),
        Path.home() / "pinokio" / "api" / "talking-wav2lip.git" / "app" / "lipsync_engine.py",
    ]
    for path in candidates:
        if path.exists():
            return path
    return None


def resolve_lipsync_python(engine: Path | None = None) -> str:
    engine = engine or resolve_lipsync_engine()
    if engine:
        for rel in (
            Path("env") / "Scripts" / "python.exe",
            Path("env") / "bin" / "python",
            Path("..") / "env" / "Scripts" / "python.exe",
        ):
            cand = (engine.parent / rel).resolve()
            if cand.exists():
                return str(cand)
    if PINOKIO_WAN_PYTHON and Path(PINOKIO_WAN_PYTHON).exists():
        return PINOKIO_WAN_PYTHON
    return sys.executable


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


def _fallback_portrait_talk(
    image: Path,
    audio: Path,
    dest: Path,
    *,
    fps: int = 24,
) -> Path:
    """Toujours produit une vidéo : portrait + zoom doux muxé avec l'audio.

    Pas un vrai lip-sync — utilisé seulement si Wav2Lip / InfiniteTalk absents.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 1000:
        return dest
    dur = max(1.0, _ffprobe_duration(audio))
    frames = max(fps, int(round(dur * fps)))
    # Zoom très léger (mouvement de tête / respiration)
    vf = (
        f"scale=1920:1080:force_original_aspect_ratio=increase,"
        f"crop=1920:1080,"
        f"zoompan=z='min(1.0+0.00025*on,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
        f"d={frames}:s=1920x1080:fps={fps},"
        f"format=yuv420p"
    )
    cmd = [
        "ffmpeg",
        "-y",
        "-loop",
        "1",
        "-i",
        str(image),
        "-i",
        str(audio),
        "-t",
        f"{dur:.3f}",
        "-vf",
        vf,
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
        str(dest),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return dest


def _via_gradio(image: Path, audio: Path, dest: Path, prompt: str) -> Path:
    from gradio_client import Client, handle_file

    client = Client(PINOKIO_LIPSYNC_URL)
    last_err: Exception | None = None
    # APIs possibles : Wav2Lip simple ou InfiniteTalk
    attempts = [
        {"api_name": "/predict"},
        {"api_name": "/generate"},
        {"api_name": "/lip_sync"},
    ]
    result = None
    for att in attempts:
        try:
            result = client.predict(
                handle_file(str(image)),
                handle_file(str(audio)),
                prompt,
                api_name=att["api_name"],
            )
            break
        except Exception as exc:
            last_err = exc
            try:
                result = client.predict(
                    handle_file(str(image)),
                    handle_file(str(audio)),
                    api_name=att["api_name"],
                )
                break
            except Exception as exc2:
                last_err = exc2
                continue
    if result is None:
        # Sans api_name
        try:
            result = client.predict(handle_file(str(image)), handle_file(str(audio)), prompt)
        except Exception as exc:
            raise RuntimeError(f"Gradio lipsync échoué: {last_err or exc}") from exc

    video_path = result[0] if isinstance(result, (list, tuple)) else result
    if not video_path or not Path(str(video_path)).exists():
        raise RuntimeError(f"Lipsync Gradio sans fichier: {result}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(str(video_path), dest)
    return dest


def _via_cli(image: Path, audio: Path, dest: Path, prompt: str) -> Path:
    engine = resolve_lipsync_engine()
    if not engine:
        raise FileNotFoundError("lipsync_engine.py introuvable")
    py = resolve_lipsync_python(engine)
    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        py,
        str(engine),
        "generate",
        "--image",
        str(image),
        "--audio",
        str(audio),
        "--output",
        str(dest),
        "--prompt",
        prompt,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60 * 30)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or f"exit {proc.returncode}")[-2000:])
    if not dest.exists():
        try:
            body = json.loads(proc.stdout.strip().splitlines()[-1])
            src = Path(body.get("outputPath") or "")
            if src.exists():
                shutil.copy2(src, dest)
        except Exception:
            pass
    if not dest.exists():
        raise RuntimeError("lipsync_engine n'a pas produit de MP4")
    return dest


def animate_talking_clip(
    image: Path,
    audio: Path,
    dest: Path,
    *,
    prompt: str | None = None,
    fps: int = 24,
    allow_fallback: bool = True,
) -> dict[str, Any]:
    """Image + audio → clip MP4 (lip-sync si moteur dispo)."""
    dest = Path(dest)
    if dest.exists() and dest.stat().st_size > 1000:
        return {"ok": True, "path": str(dest), "mode": "cached"}

    prompt = prompt or (
        "The character is talking happily, subtle head movement, blinking naturally, "
        "smooth animation, warm lighting, children's film"
    )
    errors: list[str] = []

    # 1) Gradio
    try:
        resp = requests.get(PINOKIO_LIPSYNC_URL, timeout=2)
        if resp.status_code < 500:
            _via_gradio(image, audio, dest, prompt)
            return {"ok": True, "path": str(dest), "mode": "gradio"}
    except Exception as exc:
        errors.append(f"gradio: {exc}")

    # 2) CLI Wav2Lip / engine local
    try:
        if resolve_lipsync_engine():
            _via_cli(image, audio, dest, prompt)
            return {"ok": True, "path": str(dest), "mode": "cli"}
    except Exception as exc:
        errors.append(f"cli: {exc}")

    # 3) Fallback — vidéo garantie
    if allow_fallback:
        _fallback_portrait_talk(image, audio, dest, fps=fps)
        return {
            "ok": True,
            "path": str(dest),
            "mode": "fallback_portrait",
            "warning": "Lip-sync moteur absent — portrait anime + audio. "
            "Installe pinokio/talking-wav2lip pour un vrai lip-sync.",
            "errors": errors[:3],
        }

    raise RuntimeError("Lip-sync impossible: " + " | ".join(errors[:3]))
