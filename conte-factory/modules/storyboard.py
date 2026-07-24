"""Étape 2 — Scènes dialogues + prompts visuels (personnages qui parlent)."""

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


_SPEAKER_RE = re.compile(
    r"^\[(?P<sp>HEROS|HÉROS|AMI|CHOEUR|CHŒUR|NARRATEUR)\]\s*(?P<text>.+)$",
    re.IGNORECASE | re.MULTILINE,
)


def _normalize_speaker(raw: str) -> str:
    key = (raw or "heros").strip().lower()
    key = key.replace("é", "e").replace("œ", "oe")
    if key in {"heros", "hero", "héros"}:
        return "heros"
    if key in {"ami", "amie", "friend"}:
        return "ami"
    if key in {"choeur", "chorus"}:
        return "choeur"
    return "heros"


def _parse_dialogue_block(block: str) -> list[dict[str, str]]:
    lines: list[dict[str, str]] = []
    for match in _SPEAKER_RE.finditer(block):
        text = (match.group("text") or "").strip()
        if text:
            lines.append(
                {"speaker": _normalize_speaker(match.group("sp")), "text": text}
            )
    if lines:
        return lines
    # Fallback : tout le bloc dit par le héros
    clean = " ".join(block.split())
    if clean:
        return [{"speaker": "heros", "text": clean}]
    return []


def _dialogue_from_story(story: dict[str, Any], target_n: int) -> list[list[dict[str, str]]]:
    raw = story.get("dialogue_scenes")
    if isinstance(raw, list) and raw:
        scenes: list[list[dict[str, str]]] = []
        for item in raw:
            if isinstance(item, list) and item:
                cleaned = []
                for line in item:
                    if not isinstance(line, dict):
                        continue
                    text = str(line.get("text") or "").strip()
                    if not text:
                        continue
                    cleaned.append(
                        {
                            "speaker": _normalize_speaker(str(line.get("speaker") or "heros")),
                            "text": text,
                        }
                    )
                if cleaned:
                    scenes.append(cleaned)
        if scenes:
            return scenes[:target_n] if len(scenes) >= target_n else scenes

    script = str(story.get("script") or "")
    blocks = [b.strip() for b in re.split(r"\n\s*\n", script) if b.strip()]
    scenes = [_parse_dialogue_block(b) for b in blocks]
    scenes = [s for s in scenes if s]
    if not scenes:
        scenes = [[{"speaker": "heros", "text": script.strip() or "..."}]]
    # Ajuster au nombre de scènes cible
    while len(scenes) < target_n and scenes:
        # découper la plus longue
        longest_i = max(range(len(scenes)), key=lambda i: sum(len(x["text"]) for x in scenes[i]))
        long = scenes[longest_i]
        if len(long) < 2:
            break
        mid = len(long) // 2
        scenes[longest_i : longest_i + 1] = [long[:mid], long[mid:]]
    if len(scenes) > target_n:
        # fusionner la fin
        while len(scenes) > target_n:
            scenes[-2] = scenes[-2] + scenes[-1]
            scenes.pop()
    return scenes


def _visual_prompt(
    dialogue: list[dict[str, str]],
    index: int,
    story: dict[str, Any],
    part: int = 0,
) -> str:
    hero = str(story.get("hero") or story.get("theme") or "a magical character")
    theme = str(story.get("theme") or hero)
    friend = str(story.get("friend") or "a friendly star companion")
    place = str(story.get("place") or "an enchanted sky with soft clouds")
    style = str(story.get("visual_style") or VISUAL_STYLE)
    speakers = {d.get("speaker") for d in dialogue}
    who = "hero speaking to friend" if "ami" in speakers else "hero speaking expressively"
    snippet = " ".join(d.get("text", "")[:80] for d in dialogue[:2])
    motions = [
        "gentle camera push-in, wings moving, mouth animating while speaking",
        "slow orbit around characters, expressive gestures, breathing motion",
        "dynamic flying through clouds, speaking and smiling, blue fire accents if dragon",
        "soft parallax, characters reacting to each other, lively eyes and mouth",
    ]
    motion = motions[(index + part) % len(motions)]
    return (
        f"{style}. "
        f"Animated children's film shot (NOT a still photo). "
        f"Main subject MUST be: {theme}. Same character: {hero}. Friend: {friend}. "
        f"Setting: {place}. "
        f"Action: {who}. Dialogue vibe: {snippet}. "
        f"Motion: {motion}. "
        f"Continuous motion, cinematic lighting, coherent character design, "
        f"no text, no watermark, no logo, no unrelated animals"
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

    dialogue_scenes = _dialogue_from_story(story, target_n)
    scenes = []
    for i, dialogue in enumerate(dialogue_scenes):
        narration = " ".join(f"{d['text']}" for d in dialogue)
        scenes.append(
            {
                "index": i + 1,
                "narration": narration,
                "dialogue": dialogue,
                "visual_prompt": _visual_prompt(dialogue, i, story),
                "target_duration_sec": scene_sec,
            }
        )

    board = {
        "video_id": video_id,
        "titre": story.get("titre") or video_title(video),
        "age_group": age_group,
        "duration_min": duration_min,
        "theme": story.get("theme"),
        "hero": story.get("hero"),
        "friend": story.get("friend"),
        "style_key": story.get("style_key"),
        "visual_style": story.get("visual_style"),
        "aspect": story.get("aspect") or "16:9",
        "music": story.get("music") or "berceuse",
        "format": "dialogue",
        "scene_count": len(scenes),
        "scenes": scenes,
    }
    out = projet / "storyboard.json"
    out.write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
    update_video(video_id, statut="storyboard_ok")
    log_event(
        video_id,
        "info",
        f"Storyboard dialogue : {len(scenes)} scènes (public {age_group}).",
    )
    return board
