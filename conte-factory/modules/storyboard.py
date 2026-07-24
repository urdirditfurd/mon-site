"""Étape 2 — Découper le script en scènes + prompts visuels."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from config import (
    SCENE_TARGET_SEC,
    TARGET_DURATION_MIN,
    VISUAL_STYLE,
    scene_count_for_duration,
    scene_sec_for_audience,
)
from db.database import get_video, log_event, update_video, video_title


def _sentences(text: str) -> list[str]:
    parts = [s.strip() for s in re.split(r"(?<=[.!?…])\s+", text) if s.strip()]
    return parts or ([text.strip()] if text.strip() else [])


def _split_words(text: str, parts: int) -> list[str]:
    words = text.split()
    if parts <= 1 or len(words) < parts * 2:
        return [text]
    size = max(1, len(words) // parts)
    out: list[str] = []
    for i in range(parts):
        start = i * size
        end = len(words) if i == parts - 1 else (i + 1) * size
        chunk = " ".join(words[start:end]).strip()
        if chunk:
            out.append(chunk)
    return out or [text]


def _chunk_to_n(script: str, target_n: int) -> list[str]:
    """Regroupe le script en au plus `target_n` scènes (ordre préservé)."""
    target_n = max(1, int(target_n))
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", script) if p.strip()]
    if not paragraphs:
        return [script.strip() or ""]

    units: list[str] = []
    for para in paragraphs:
        units.extend(_sentences(para))
    if not units:
        return [script.strip() or ""]

    # Pas assez d'unités : découper les plus longues
    while len(units) < target_n:
        longest_i = max(range(len(units)), key=lambda i: len(units[i].split()))
        words = units[longest_i].split()
        if len(words) < 8:
            break
        mid = len(words) // 2
        units[longest_i : longest_i + 1] = [
            " ".join(words[:mid]),
            " ".join(words[mid:]),
        ]

    if len(units) <= target_n:
        return units

    # Trop d'unités : fusionner en `target_n` blocs équilibrés (mots)
    total_words = sum(max(1, len(u.split())) for u in units)
    ideal = total_words / target_n
    chunks: list[str] = []
    buf: list[str] = []
    buf_words = 0
    slots_left = target_n

    for idx, unit in enumerate(units):
        w = max(1, len(unit.split()))
        units_after = len(units) - idx - 1
        can_flush = bool(buf) and slots_left > 1 and units_after >= (slots_left - 1)
        should_flush = can_flush and buf_words + w > ideal and buf_words >= ideal * 0.55

        if should_flush:
            chunks.append(" ".join(buf).strip())
            buf = [unit]
            buf_words = w
            slots_left -= 1
        else:
            buf.append(unit)
            buf_words += w

        if slots_left == 1:
            # tout le reste dans le dernier slot
            rest = units[idx + 1 :]
            if rest:
                buf.extend(rest)
            break

    if buf:
        chunks.append(" ".join(buf).strip())

    while len(chunks) > target_n and len(chunks) >= 2:
        chunks[-2] = f"{chunks[-2]} {chunks[-1]}".strip()
        chunks.pop()

    if len(chunks) < target_n and chunks:
        # Répartir encore un peu si possible
        need = target_n - len(chunks)
        longest_i = max(range(len(chunks)), key=lambda i: len(chunks[i].split()))
        pieces = _split_words(chunks[longest_i], need + 1)
        if len(pieces) > 1:
            chunks[longest_i : longest_i + 1] = pieces

    return chunks[:target_n] if len(chunks) >= target_n else (chunks or [script.strip()])


def _visual_prompt(narration: str, index: int, story: dict[str, Any]) -> str:
    hero = story.get("hero") or "a cute animal hero"
    place = story.get("place") or "an enchanted forest"
    snippet = narration[:180].replace("\n", " ")
    return (
        f"{VISUAL_STYLE}, scene {index + 1}, featuring {hero}, setting inspired by {place}, "
        f"story moment: {snippet}, single keyframe illustration"
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
    age_group = str(story.get("age_group") or "1-9")
    duration_min = float(story.get("duration_min") or TARGET_DURATION_MIN)
    target_n = int(
        story.get("target_scenes")
        or scene_count_for_duration(duration_min, age_group=age_group)
    )
    scene_sec = float(
        story.get("scene_target_sec")
        or scene_sec_for_audience(age_group)
        or SCENE_TARGET_SEC
    )

    narrations = _chunk_to_n(story["script"], target_n)
    scenes = []
    for i, narration in enumerate(narrations):
        scenes.append(
            {
                "index": i + 1,
                "narration": narration,
                "visual_prompt": _visual_prompt(narration, i, story),
                "target_duration_sec": scene_sec,
            }
        )

    board = {
        "video_id": video_id,
        "titre": story.get("titre") or video_title(video),
        "age_group": age_group,
        "duration_min": duration_min,
        "scene_count": len(scenes),
        "scenes": scenes,
    }
    out = projet / "storyboard.json"
    out.write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
    update_video(video_id, statut="storyboard_ok")
    log_event(
        video_id,
        "info",
        f"Storyboard : {len(scenes)} scènes (public {age_group}, ~{scene_sec:.0f}s/scène).",
    )
    return board
