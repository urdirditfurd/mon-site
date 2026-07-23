"""Suivi d'avancement lisible pour l'UI Creation (sans montrer Wan)."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from config import DATA_DIR, ensure_dirs

PROGRESS_FILE = DATA_DIR / "progress.json"
JOB_FILE = DATA_DIR / "job.json"

STEPS_WEIGHT = {
    "start": 0,
    "sourcing": 5,
    "storyboard": 12,
    "audio": 22,
    "video_ai": 75,  # gros du travail
    "montage": 92,
    "publish": 98,
    "done": 100,
    "error": 100,
}

STEP_LABELS = {
    "start": "Demarrage",
    "sourcing": "Ecriture de l'histoire",
    "storyboard": "Decoupage des scenes",
    "audio": "Generation de la voix",
    "video_ai": "Generation des images animees",
    "montage": "Assemblage du film",
    "publish": "Publication YouTube",
    "done": "Termine",
    "error": "Erreur",
}


def _write(path: Path, data: dict[str, Any]) -> None:
    ensure_dirs()
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def set_progress(
    *,
    step: str,
    pct: float | None = None,
    message: str = "",
    video_id: int | None = None,
    detail: str = "",
    clips_done: int | None = None,
    clips_total: int | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    base = STEPS_WEIGHT.get(step, 0)
    if pct is None:
        if step == "video_ai" and clips_done is not None and clips_total:
            # 22% → 75% selon clips
            span = STEPS_WEIGHT["video_ai"] - STEPS_WEIGHT["audio"]
            pct = STEPS_WEIGHT["audio"] + span * (clips_done / max(1, clips_total))
        else:
            pct = float(base)

    data = {
        "step": step,
        "label": STEP_LABELS.get(step, step),
        "pct": round(min(100.0, max(0.0, float(pct))), 1),
        "message": message or STEP_LABELS.get(step, step),
        "detail": detail,
        "video_id": video_id,
        "clips_done": clips_done,
        "clips_total": clips_total,
        "error": error,
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "running": step not in {"done", "error"},
    }
    _write(PROGRESS_FILE, data)
    return data


def get_progress() -> dict[str, Any]:
    if not PROGRESS_FILE.exists():
        return {
            "step": "idle",
            "label": "En attente",
            "pct": 0,
            "message": "Aucune generation en cours",
            "running": False,
        }
    try:
        return json.loads(PROGRESS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"step": "idle", "pct": 0, "message": "Progression illisible", "running": False}


def clear_progress() -> None:
    if PROGRESS_FILE.exists():
        PROGRESS_FILE.unlink()


def set_job(data: dict[str, Any]) -> None:
    _write(JOB_FILE, data)


def get_job() -> dict[str, Any] | None:
    if not JOB_FILE.exists():
        return None
    try:
        return json.loads(JOB_FILE.read_text(encoding="utf-8"))
    except Exception:
        return None


def clear_job() -> None:
    if JOB_FILE.exists():
        JOB_FILE.unlink()
