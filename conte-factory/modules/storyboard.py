"""Étape 2 — Scènes dialogues + prompts visuels EN (LLM, pas le script brut)."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import requests

from config import (
    MISTRAL_API_KEY,
    OLLAMA_URL,
    SCENE_TARGET_SEC,
    STORY_MODE,
    TARGET_DURATION_MIN,
    VISUAL_STYLE,
    scene_count_for_duration,
    scene_sec_for_audience,
)
from db.database import get_video, log_event, project_dir, update_video, video_title
from modules.clip_prompts import build_clip_plans_for_board
from modules.script_parser import apply_structured_scenes_to_board
from modules.sourcing import ensure_story_files
from modules.youth_spec import normalize_age, youth_profile, youth_visual_suffix


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
    while len(scenes) < target_n and scenes:
        longest_i = max(range(len(scenes)), key=lambda i: sum(len(x["text"]) for x in scenes[i]))
        long = scenes[longest_i]
        if len(long) < 2:
            break
        mid = len(long) // 2
        scenes[longest_i : longest_i + 1] = [long[:mid], long[mid:]]
    if len(scenes) > target_n:
        while len(scenes) > target_n:
            scenes[-2] = scenes[-2] + scenes[-1]
            scenes.pop()
    return scenes


def _looks_like_english_visual(prompt: str) -> bool:
    """True si le prompt semble deja etre une description visuelle EN."""
    p = f" {(prompt or '').lower()} "
    if len(p) < 50:
        return False
    fr_hits = sum(
        1
        for w in (" le ", " la ", " les ", " une ", " des ", " dans ", " qui ", " pour ")
        if w in p
    )
    en_hits = sum(
        1
        for w in (
            " the ",
            " with ",
            " soft ",
            " lighting ",
            " pixar ",
            " cinematic ",
            " detailed ",
            " watercolor ",
            " cute ",
        )
        if w in p
    )
    return en_hits >= max(2, fr_hits)


def _fallback_visual_prompt_en(
    dialogue: list[dict[str, str]],
    index: int,
    story: dict[str, Any],
    part: int = 0,
) -> str:
    """Prompt EN detaille sans coller le script FR brut (fallback sans LLM)."""
    hero = str(story.get("hero") or "a magical child hero")
    theme = str(story.get("hero_description") or story.get("theme") or hero)
    friend = str(story.get("friend") or "a friendly glowing companion")
    place = str(story.get("place") or "an enchanted soft forest clearing")
    style = str(story.get("visual_style") or VISUAL_STYLE)
    age = normalize_age(str(story.get("age_group") or "1-10"))
    profile = youth_profile(age)
    speakers = {d.get("speaker") for d in dialogue}
    action = (
        "hero speaking warmly to friend, expressive eyes and gentle gesture"
        if "ami" in speakers
        else "hero speaking expressively, curious and kind expression"
    )
    # Intention visuelle depuis mots-cles (pas le texte lu a haute voix)
    blob = " ".join(d.get("text", "") for d in dialogue).lower()
    props: list[str] = []
    for fr, en in (
        ("fleur", "a sparkling magical flower"),
        ("dragon", "a friendly dark-violet dragon with soft scales"),
        ("nuage", "fluffy pastel clouds"),
        ("etoile", "a twinkling friendly star"),
        ("foret", "an enchanted forest with soft light shafts"),
        ("château", "a gentle fairy-tale castle silhouette"),
        ("chateau", "a gentle fairy-tale castle silhouette"),
        ("lune", "a soft glowing moon"),
        ("riviere", "a shimmering calm river"),
        ("vol", "gentle flying pose, wings mid-beat"),
        ("chante", "singing with a joyful open mouth"),
        ("ours", "a cute fluffy bear"),
    ):
        if fr in blob and en not in props:
            props.append(en)
    prop_txt = ", ".join(props[:3]) if props else "a small magical storybook prop nearby"
    motions = [
        "soft push-in, calm breathing, wings or hair moving gently",
        "very slow orbit, warm eye contact, subtle hand gesture",
        "gentle float through air, continuous soft motion",
        "soft parallax background, lively but calm character acting",
    ]
    motion = motions[(index + part) % len(motions)]
    return (
        f"Children's storybook film still, {style}. "
        f"Main character: {theme} (consistent design named {hero}). "
        f"Companion: {friend}. Setting: {place}. "
        f"Action: {action}. Key props: {prop_txt}. "
        f"Camera motion feel: {motion}. "
        f"{youth_visual_suffix(profile)} "
        f"sharp focus, crisp details, soft warm lighting, "
        f"wide readable framing, coherent character design, "
        f"same character identity throughout, "
        f"no text, no watermark, no logo, no motion blur, no neon"
    )


def _llm_visual_prompt_en(
    dialogue: list[dict[str, str]],
    index: int,
    story: dict[str, Any],
    part: int = 0,
) -> str | None:
    """Demande au LLM un prompt VISUEL EN ultra-detaille (jamais le script brut)."""
    hero = str(story.get("hero") or story.get("theme") or "hero")
    theme = str(story.get("hero_description") or story.get("theme") or hero)
    friend = str(story.get("friend") or "friendly companion")
    place = str(story.get("place") or "enchanted place")
    style = str(story.get("visual_style") or VISUAL_STYLE)
    age = normalize_age(str(story.get("age_group") or "1-10"))
    lines = " | ".join(
        f"{d.get('speaker', 'heros')}: {d.get('text', '')[:120]}" for d in dialogue[:4]
    )
    system = (
        "You convert children's story dialogue into ONE English IMAGE prompt for a "
        "children's storybook illustration (respect the given visual style; "
        "if watercolor, do NOT describe 3D/Pixar). Never copy French dialogue verbatim. "
        "Describe who, where, action, emotion, lighting, camera. "
        "Keep the same character design. Output ONLY the English prompt string."
    )
    user = (
        f"Age group: {age}. Style: {style}.\n"
        f"Hero/visual identity: {theme} (name: {hero}). Friend: {friend}. Place: {place}.\n"
        f"Scene {index + 1} dialogue (for MEANING only, do not quote): {lines}\n"
        f"Part/shot: {part + 1}.\n"
        "Write one detailed English visual prompt (~40-80 words), example tone: "
        "'Cute Pixar style 3D bear glowing with curiosity, looking down at a magical "
        "sparkling blue flower in an enchanted forest, soft warm lighting, 8k, detailed'."
    )

    mode = (STORY_MODE or "builtin").lower()
    try:
        if mode == "mistral" and MISTRAL_API_KEY:
            resp = requests.post(
                "https://api.mistral.ai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {MISTRAL_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "mistral-small-latest",
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    "temperature": 0.55,
                    "max_tokens": 220,
                },
                timeout=60,
            )
            resp.raise_for_status()
            text = str(resp.json()["choices"][0]["message"]["content"] or "").strip()
        elif mode == "ollama":
            resp = requests.post(
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model": "llama3.2",
                    "prompt": f"{system}\n\n{user}",
                    "stream": False,
                },
                timeout=90,
            )
            resp.raise_for_status()
            text = str(resp.json().get("response") or "").strip()
        else:
            # Pas de LLM configure : tenter Ollama local puis Mistral si cle presente
            text = ""
            if MISTRAL_API_KEY:
                resp = requests.post(
                    "https://api.mistral.ai/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {MISTRAL_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": "mistral-small-latest",
                        "messages": [
                            {"role": "system", "content": system},
                            {"role": "user", "content": user},
                        ],
                        "temperature": 0.55,
                        "max_tokens": 220,
                    },
                    timeout=45,
                )
                if resp.ok:
                    text = str(resp.json()["choices"][0]["message"]["content"] or "").strip()
            if not text:
                try:
                    resp = requests.post(
                        f"{OLLAMA_URL}/api/generate",
                        json={
                            "model": "llama3.2",
                            "prompt": f"{system}\n\n{user}",
                            "stream": False,
                        },
                        timeout=45,
                    )
                    if resp.ok:
                        text = str(resp.json().get("response") or "").strip()
                except Exception:
                    text = ""
        if not text:
            return None
        # Nettoyer guillemets / markdown
        text = text.strip().strip("`").strip('"').strip("'")
        if text.lower().startswith("prompt:"):
            text = text.split(":", 1)[1].strip()
        if len(text) < 40 or not _looks_like_english_visual(text):
            return None
        return text
    except Exception:
        return None


def _visual_prompt(
    dialogue: list[dict[str, str]],
    index: int,
    story: dict[str, Any],
    part: int = 0,
) -> str:
    """Prompt image EN : LLM d'abord, sinon fallback structure (jamais script FR brut)."""
    llm = _llm_visual_prompt_en(dialogue, index, story, part=part)
    if llm:
        style = str(story.get("visual_style") or VISUAL_STYLE)
        if style.lower() not in llm.lower():
            llm = f"{style}. {llm}"
        return llm
    return _fallback_visual_prompt_en(dialogue, index, story, part=part)


# Alias public (video_ai / i2v)
visual_prompt_for_scene = _visual_prompt


def enrich_board_visual_prompts(board: dict[str, Any], *, force: bool = False) -> int:
    """Regenere les visual_prompt EN manquants / trop 'script FR'. Retourne nb maj."""
    story_ctx = {
        "hero": board.get("hero"),
        "theme": board.get("theme"),
        "hero_description": board.get("hero_description") or board.get("theme"),
        "friend": board.get("friend"),
        "place": board.get("place") or "enchanted soft landscape",
        "visual_style": board.get("visual_style"),
        "age_group": board.get("age_group") or "1-10",
    }
    updated = 0
    for i, scene in enumerate(board.get("scenes") or []):
        dialogue = scene.get("dialogue") or [
            {"speaker": "heros", "text": scene.get("narration") or ""}
        ]
        current = str(scene.get("visual_prompt") or "")
        if force or not _looks_like_english_visual(current):
            scene["visual_prompt"] = _visual_prompt(dialogue, i, story_ctx, part=0)
            scene["visual_prompt_source"] = "llm_or_fallback_en"
            updated += 1
    return updated


def build_storyboard(video_id: int) -> dict[str, Any]:
    video = get_video(video_id)
    if not video:
        raise ValueError(f"Vidéo introuvable: {video_id}")
    projet = Path(video["chemin_projet"]) if video.get("chemin_projet") else project_dir(video_id)
    ensure_story_files(video_id)
    story_path = projet / "story.json"
    if not story_path.exists():
        story_path = project_dir(video_id) / "story.json"
    if not story_path.exists():
        raise FileNotFoundError("story.json manquant — relancez l'étape sourcing.")

    story = json.loads(story_path.read_text(encoding="utf-8"))
    age_group = normalize_age(str(story.get("age_group") or "1-10"))
    profile = youth_profile(age_group)
    duration_min = float(story.get("duration_min") or TARGET_DURATION_MIN)
    target_n = int(
        story.get("target_scenes")
        or scene_count_for_duration(duration_min, age_group=age_group)
    )
    scene_sec = float(
        story.get("scene_target_sec")
        or profile.get("scene_target_sec")
        or scene_sec_for_audience(age_group)
        or SCENE_TARGET_SEC
    )

    dialogue_scenes = _dialogue_from_story(story, target_n)
    # Script structure : 1 scene board = 1 scene script
    structured = story.get("structured_scenes") or []
    if structured:
        target_n = len(structured)
        dialogue_scenes = _dialogue_from_story(story, target_n)

    scenes = []
    for i, dialogue in enumerate(dialogue_scenes):
        narration = " ".join(f"{d['text']}" for d in dialogue)
        scenes.append(
            {
                "index": i + 1,
                "narration": narration,
                "dialogue": dialogue,
                "visual_prompt": _visual_prompt(
                    dialogue, i, {**story, "age_group": age_group}
                ),
                "visual_prompt_source": "llm_or_fallback_en",
                "target_duration_sec": scene_sec,
                "shot_sec_min": profile["shot_sec_min"],
                "shot_sec_max": profile["shot_sec_max"],
            }
        )

    board = {
        "video_id": video_id,
        "titre": story.get("titre") or video_title(video),
        "age_group": age_group,
        "youth_profile": {
            "label": profile["label"],
            "fps": profile["fps"],
            "width": profile["width"],
            "height": profile["height"],
            "shot_sec_min": profile["shot_sec_min"],
            "shot_sec_max": profile["shot_sec_max"],
            "wan_clip_span_sec": profile["wan_clip_span_sec"],
            "music_volume": profile["music_volume"],
            "resolution_label": profile["resolution_label"],
        },
        "duration_min": duration_min,
        "theme": story.get("theme"),
        "hero": story.get("hero"),
        "hero_description": story.get("hero_description") or story.get("theme"),
        "friend": story.get("friend"),
        "place": story.get("place"),
        "style_key": story.get("style_key"),
        "visual_style": story.get("visual_style"),
        "character_ref_hint": story.get("character_ref_hint"),
        "aspect": story.get("aspect") or profile.get("aspect") or "16:9",
        "music": story.get("music") or "berceuse",
        "format": "dialogue",
        "scene_count": len(scenes),
        "scenes": scenes,
    }
    apply_structured_scenes_to_board(board, story)
    total_clips = build_clip_plans_for_board(board)
    out = projet / "storyboard.json"
    out.write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
    update_video(video_id, statut="storyboard_ok")
    log_event(
        video_id,
        "info",
        (
            f"Storyboard jeunesse {age_group} : {len(scenes)} scènes, "
            f"{total_clips} clips courts (3-5 s), prompts anti-boucle, "
            f"{profile['fps']} fps, plans {profile['shot_sec_min']}-{profile['shot_sec_max']}s."
        ),
    )
    return board
