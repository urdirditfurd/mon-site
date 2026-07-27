"""Post-traitement des clips I2V : coupe des boucles en fin de clip."""
from __future__ import annotations

import logging
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

# Conserver 50–70 % du clip (couper 30–50 % de la fin où les loops apparaissent)
DEFAULT_KEEP_RATIO = 0.65
MIN_KEEP_SECONDS = 1.5


def _probe_duration(path: Path) -> float:
    try:
        result = subprocess.run(
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
            capture_output=True,
            text=True,
            check=True,
            timeout=30,
        )
        return max(0.1, float(result.stdout.strip()))
    except Exception:
        return 4.0


def trim_loop_tail(
    input_path: Path,
    output_path: Path | None = None,
    *,
    keep_ratio: float = DEFAULT_KEEP_RATIO,
    min_keep_seconds: float = MIN_KEEP_SECONDS,
) -> Path:
    """
    Coupe la fin du clip (30–50 %) pour supprimer les répétitions visuelles.
    Priorise la première partie du clip, généralement la plus propre.
    """
    input_path = Path(input_path)
    if output_path is None:
        output_path = input_path.with_name(f"{input_path.stem}_trim{input_path.suffix}")
    else:
        output_path = Path(output_path)

    keep_ratio = max(0.5, min(0.7, float(keep_ratio)))
    duration = _probe_duration(input_path)
    keep_duration = max(min_keep_seconds, duration * keep_ratio)
    keep_duration = min(keep_duration, duration - 0.05)

    if keep_duration >= duration - 0.1:
        if output_path != input_path:
            output_path.write_bytes(input_path.read_bytes())
        return output_path

    output_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-t",
        f"{keep_duration:.3f}",
        "-c",
        "copy",
        str(output_path),
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=120)
        logger.info(
            "Loop trim: %s %.2fs -> %.2fs (keep %.0f%%)",
            input_path.name,
            duration,
            keep_duration,
            keep_ratio * 100,
        )
        return output_path
    except Exception as exc:
        logger.warning("Loop trim failed for %s: %s", input_path, exc)
        if output_path != input_path:
            output_path.write_bytes(input_path.read_bytes())
        return output_path


def trim_all_clips(
    clip_paths: list[Path],
    *,
    keep_ratio: float = DEFAULT_KEEP_RATIO,
    in_place: bool = True,
) -> list[Path]:
    """Applique le nettoyage anti-loop à tous les clips générés."""
    cleaned: list[Path] = []
    for path in clip_paths:
        if not path.exists():
            continue
        if in_place:
            tmp = path.with_name(f"{path.stem}__trim_tmp{path.suffix}")
            trim_loop_tail(path, tmp, keep_ratio=keep_ratio)
            tmp.replace(path)
            cleaned.append(path)
        else:
            out = trim_loop_tail(path, keep_ratio=keep_ratio)
            cleaned.append(out)
    return cleaned
