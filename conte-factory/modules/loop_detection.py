"""P4 — Detection de boucles par similarite de frames (sans OpenCV obligatoire)."""

from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageChops

logger = logging.getLogger(__name__)

DEFAULT_THRESHOLD = 0.85


def _extract_frames(video_path: Path, work: Path, max_frames: int = 24) -> list[Path]:
    work.mkdir(parents=True, exist_ok=True)
    pattern = str(work / "f_%03d.png")
    # fps bas pour echantillonner rapidement
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(video_path),
        "-vf",
        f"fps=6,scale=160:90",
        "-frames:v",
        str(max_frames),
        pattern,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=60)
    except Exception as exc:
        logger.warning("extract frames failed: %s", exc)
        return []
    return sorted(work.glob("f_*.png"))


def _frame_similarity(a: Path, b: Path) -> float:
    try:
        ia = Image.open(a).convert("RGB").resize((160, 90))
        ib = Image.open(b).convert("RGB").resize((160, 90))
        diff = ImageChops.difference(ia, ib)
        hist = diff.histogram()
        # Somme des ecarts / max possible
        total = sum(i * hist[i] for i in range(256)) * 3  # RGB approx via flat hist
        # hist length 768 for RGB
        n = ia.width * ia.height * 3
        mean_diff = total / max(1, n) / 255.0
        return max(0.0, min(1.0, 1.0 - mean_diff))
    except Exception:
        return 0.0


def detect_loop(
    video_path: str | Path,
    threshold: float = DEFAULT_THRESHOLD,
) -> tuple[bool, float]:
    """
    Detecte une boucle probable.
    Retourne (is_loop, cut_ratio) ou cut_ratio dans ]0.5, 0.7] si boucle.
    """
    video_path = Path(video_path)
    if not video_path.exists():
        return False, 0.0
    threshold = max(0.7, min(0.95, float(threshold)))

    tmp = Path(tempfile.mkdtemp(prefix="loopdet_"))
    try:
        frames = _extract_frames(video_path, tmp)
        if len(frames) < 8:
            return False, 0.0
        first = frames[0]
        last = frames[-1]
        end_sim = _frame_similarity(first, last)
        if end_sim < threshold:
            return False, 0.0

        # Chercher le moment ou la frame redevient proche du debut (2e moitie)
        start = len(frames) // 2
        best_i = None
        for i in range(start, len(frames)):
            sim = _frame_similarity(first, frames[i])
            if sim >= threshold:
                best_i = i
                break
        if best_i is None:
            # Boucle probable en fin → coupe standard 65%
            return True, 0.65
        ratio = best_i / max(1, len(frames))
        ratio = max(0.5, min(0.7, ratio))
        return True, ratio
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
