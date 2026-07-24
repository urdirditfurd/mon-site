"""Moteur lip-sync local gratuit (Wav2Lip si installé, sinon portrait+audio).

Usage:
  python lipsync_engine.py check
  python lipsync_engine.py generate --image face.png --audio line.mp3 --output out.mp4
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import traceback
from pathlib import Path


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


def _fallback(image: Path, audio: Path, output: Path, fps: int = 24) -> dict:
    dur = max(1.0, _ffprobe_duration(audio))
    frames = max(fps, int(round(dur * fps)))
    vf = (
        f"scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,"
        f"zoompan=z='min(1.0+0.00025*on,1.05)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
        f"d={frames}:s=1280x720:fps={fps},format=yuv420p"
    )
    cmd = [
        "ffmpeg", "-y",
        "-loop", "1", "-i", str(image),
        "-i", str(audio),
        "-t", f"{dur:.3f}",
        "-vf", vf,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-c:a", "aac", "-b:a", "192k",
        "-shortest", "-r", str(fps),
        str(output),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return {
        "ok": True,
        "outputPath": str(output.resolve()),
        "mode": "fallback_portrait",
        "seconds": round(dur, 2),
    }


def _try_wav2lip(image: Path, audio: Path, output: Path) -> dict | None:
    """Si le repo Wav2Lip + checkpoint sont presents, les utiliser."""
    root = Path(__file__).resolve().parent
    wav2lip = root / "Wav2Lip"
    checkpoint = wav2lip / "checkpoints" / "wav2lip_gan.pth"
    if not (wav2lip / "inference.py").exists() or not checkpoint.exists():
        return None
    py = sys.executable
    # Wav2Lip ecrit souvent dans results/
    results = wav2lip / "results"
    results.mkdir(parents=True, exist_ok=True)
    cmd = [
        py,
        str(wav2lip / "inference.py"),
        "--checkpoint_path",
        str(checkpoint),
        "--face",
        str(image),
        "--audio",
        str(audio),
        "--outfile",
        str(output),
    ]
    proc = subprocess.run(cmd, cwd=str(wav2lip), capture_output=True, text=True, timeout=60 * 20)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "wav2lip failed")[-2000:])
    if not output.exists():
        # parfois outfile relatif
        cand = results / output.name
        if cand.exists():
            output.write_bytes(cand.read_bytes())
    if not output.exists():
        raise RuntimeError("Wav2Lip n'a pas ecrit le fichier de sortie")
    return {
        "ok": True,
        "outputPath": str(output.resolve()),
        "mode": "wav2lip",
    }


def generate_video(
    *,
    image: str,
    audio: str,
    output_path: str,
    prompt: str = "",
    fps: int = 24,
) -> dict:
    _ = prompt
    image_p = Path(image)
    audio_p = Path(audio)
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    if not image_p.exists():
        raise FileNotFoundError(image)
    if not audio_p.exists():
        raise FileNotFoundError(audio)

    try:
        result = _try_wav2lip(image_p, audio_p, out)
        if result:
            return result
    except Exception as exc:
        print(f"[lipsync] Wav2Lip echec -> fallback: {exc}", flush=True)

    return _fallback(image_p, audio_p, out, fps=fps)


def check_environment() -> dict:
    root = Path(__file__).resolve().parent
    wav2lip = root / "Wav2Lip"
    ckpt = wav2lip / "checkpoints" / "wav2lip_gan.pth"
    return {
        "ok": True,
        "wav2lip_repo": wav2lip.exists(),
        "wav2lip_checkpoint": ckpt.exists(),
        "mode": "wav2lip" if ckpt.exists() else "fallback_portrait",
        "ffmpeg": True,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check")
    gen = sub.add_parser("generate")
    gen.add_argument("--image", required=True)
    gen.add_argument("--audio", required=True)
    gen.add_argument("--output", required=True)
    gen.add_argument("--prompt", default="")
    gen.add_argument("--fps", type=int, default=24)
    args = parser.parse_args()

    if args.cmd == "check":
        print(json.dumps(check_environment(), indent=2))
    else:
        try:
            print(
                json.dumps(
                    generate_video(
                        image=args.image,
                        audio=args.audio,
                        output_path=args.output,
                        prompt=args.prompt,
                        fps=args.fps,
                    ),
                    indent=2,
                )
            )
        except Exception as exc:
            print(json.dumps({"ok": False, "error": str(exc), "trace": traceback.format_exc()}))
            raise SystemExit(1) from exc
