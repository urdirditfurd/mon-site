"""Étape 2 — Découper le script en scènes + prompts visuels."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from config import SCENE_TARGET_SEC, VISUAL_STYLE
from db.database import get_video, log_event, update_video, video_title


def _split_paragraphs(script: str) -> list[str]:
    parts = [p.strip() for p in re.split(r"\n\s*\n", script) if p.strip()]
    if len(parts) >= 6:
        return parts
    sentences = [s.strip() for s in re.split(r"(?<=[.!?…])\s+", script) if s.strip()]
    if not sentences:
        return [script]
    # Regroupe pour viser ~ scène / minute (longueur texte)
    target_chars = 450
    chunks: list[str] = []
    buf = ""
    for sentence in sentences:
        if buf and len(buf) + len(sentence) > target_chars:
            chunks.append(buf.strip())
            buf = sentence
        else:
            buf = f"{buf} {sentence}".strip()
    if buf:
        chunks.append(buf.strip())
    return chunks or [script]


def _visual_prompt(narration: str, index: int, story: dict[str, Any]) -> str:
    hero = story.get("hero") or "a cute animal hero"
    place = story.get("place") or "an enchanted forest"
    snippet = narration[:180].replace("\n", " ")
    return (
        f"{VISUAL_STYLE}, scene {index + 1}, featuring {hero}, setting inspired by {place}, "
        f"story moment: {snippet}"
    )


def build_storyboard(video_id: int) -> dict[str, Any]:
    video = get_video(video_id)
    if not video:
        raise ValueError(f"Vidéo introuvable: {video_id}")
    projet = Path(video["chemin_projet"])
    story_path = projet / "story.json"
    if not story_path.exists():
        raise FileNotFoundError("story.json manquant — relancez l'étape sourcing.")

    story = json.loads(story_path.read_text(encoding="utf-8"))
    paragraphs = _split_paragraphs(story["script"])
    scenes = []
    for i, narration in enumerate(paragraphs):
        scenes.append(
            {
                "index": i + 1,
                "narration": narration,
                "visual_prompt": _visual_prompt(narration, i, story),
                "target_duration_sec": SCENE_TARGET_SEC,
            }
        )

    board = {
        "video_id": video_id,
        "titre": story.get("titre") or video["titre"],
        "scene_count": len(scenes),
        "scenes": scenes,
    }
    out = projet / "storyboard.json"
    out.write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
    update_video(video_id, statut="storyboard_ok")
    log_event(video_id, "info", f"Storyboard : {len(scenes)} scènes.")
    return board
