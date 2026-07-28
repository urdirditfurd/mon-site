"""P1 — Parseur de script narratif structure (JSON/YAML-like JSON).

Remplace un simple "theme" par un scenario scene-par-scene fidele au conte.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from modules.creative_options import style_prompt
from modules.youth_spec import normalize_age

REQUIRED_TOP = ("titre", "scenes")


def load_script_file(path: str | Path) -> dict[str, Any]:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Script introuvable: {p}")
    raw = p.read_text(encoding="utf-8")
    data = json.loads(raw)
    return validate_script(data)


def validate_script(data: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise ValueError("Le script doit etre un objet JSON")
    for key in REQUIRED_TOP:
        if key not in data:
            raise ValueError(f"Script incomplet: champ manquant '{key}'")
    scenes = data.get("scenes") or []
    if not isinstance(scenes, list) or len(scenes) < 1:
        raise ValueError("Script: 'scenes' doit contenir au moins 1 scene")

    hero = data.get("personnage_principal") or {}
    if isinstance(hero, str):
        hero = {"description": hero}
    style_key = str(data.get("style_key") or data.get("style_visuel_key") or "aquarelle")
    # Si style_visuel texte libre fourni sans cle, garder aquarelle par defaut
    if data.get("style_visuel") and not data.get("style_key"):
        low = str(data["style_visuel"]).lower()
        if "pixar" in low or "3d" in low:
            style_key = "3d_mignon"
        elif "anime" in low or "ghibli" in low:
            style_key = "anime_doux"
        elif "papier" in low:
            style_key = "papier_decoupe"
        else:
            style_key = "aquarelle"

    cleaned_scenes: list[dict[str, Any]] = []
    for i, sc in enumerate(scenes):
        if not isinstance(sc, dict):
            continue
        action = str(sc.get("action") or sc.get("description") or "").strip()
        if not action:
            continue
        cleaned_scenes.append(
            {
                "id": int(sc.get("id") or i + 1),
                "lieu": str(sc.get("lieu") or sc.get("place") or "enchanted setting"),
                "action": action,
                "duree_secondes": float(sc.get("duree_secondes") or sc.get("duration") or 4),
                "camera": str(sc.get("camera") or "static camera shot"),
                "emotion": str(sc.get("emotion") or "gentle curiosity"),
                "action_type": str(sc.get("action_type") or _infer_action_type(action)),
                "narration": str(sc.get("narration") or action),
                "dialogue": sc.get("dialogue"),
                "visual_prompt": str(sc.get("visual_prompt") or sc.get("visual_prompt_en") or "").strip(),
                "characters": sc.get("characters") or [],
            }
        )
    if not cleaned_scenes:
        raise ValueError("Aucune scene valide (champ 'action' requis)")

    out = {
        "titre": str(data.get("titre") or "Conte").strip(),
        "theme": str(data.get("theme") or data.get("titre") or "conte"),
        "style_key": style_key,
        "style_visuel": str(data.get("style_visuel") or style_prompt(style_key)),
        "personnage_principal": {
            "nom": str(hero.get("nom") or hero.get("name") or "heros"),
            "description": str(
                hero.get("description")
                or hero.get("desc")
                or data.get("theme")
                or "a storybook child hero"
            ),
            "reference_image": hero.get("reference_image") or hero.get("ref"),
        },
        "age_group": normalize_age(str(data.get("age_group") or "7-10")),
        "duration_min": float(data.get("duration_min") or max(1.0, len(cleaned_scenes) * 0.5)),
        "music": str(data.get("music") or "berceuse"),
        "aspect": str(data.get("aspect") or "16:9"),
        "friend": str(data.get("friend") or "").strip(),
        "place": str(data.get("place") or cleaned_scenes[0]["lieu"]),
        "morale": str(data.get("morale") or "le courage et la prudence"),
        "scenes": cleaned_scenes,
        "source": "structured_script",
    }
    return out


def _infer_action_type(action: str) -> str:
    low = action.lower()
    mapping = (
        ("knock", "frappe"),
        ("frappe", "frappe"),
        ("hug", "etreinte"),
        ("embrace", "etreinte"),
        ("step back", "recule"),
        ("steps back", "recule"),
        ("recule", "recule"),
        ("point", "pointe"),
        ("pointe", "pointe"),
        ("listen", "ecoute"),
        ("ecoute", "ecoute"),
        ("pick", "cueille"),
        ("cueill", "cueille"),
        ("bend", "cueille"),
        ("appear", "apparait"),
        ("apparait", "apparait"),
        ("steps out", "apparait"),
        ("wolf", "apparait"),
        ("marche", "marche"),
        ("walk", "marche"),
        ("court", "court"),
        ("run", "court"),
        ("danse", "danse"),
        ("dance", "danse"),
        ("regarde", "regarde"),
        ("look", "regarde"),
        ("peek", "regarde"),
    )
    for fr, key in mapping:
        if fr in low:
            return key
    return "regarde"


def build_scene_visual_prompt(
    sc: dict[str, Any],
    *,
    hero: str,
    style: str,
    place: str = "",
) -> str:
    """Prompt visuel EN fidele au script (sans LLM ni compagnon invente)."""
    custom = str(sc.get("visual_prompt") or "").strip()
    if custom:
        return custom
    lieu = str(sc.get("lieu") or place or "enchanted fairy-tale setting")
    action = str(sc.get("action") or "")
    emotion = str(sc.get("emotion") or "gentle")
    camera = str(sc.get("camera") or "static camera shot")
    chars = sc.get("characters") or []
    cast = ", ".join(str(c) for c in chars) if chars else ""
    cast_clause = f" Characters in scene: {cast}." if cast else ""
    return (
        f"{style}. Single environment: {lieu}. "
        f"Main character: {hero}.{cast_clause} "
        f"Action: {action}. Emotion: {emotion}. Camera: {camera}. "
        f"Cinematic composition, clear readable characters, faithful to the fairy tale, "
        f"no text, no watermark."
    )


def script_to_story_payload(script: dict[str, Any]) -> dict[str, Any]:
    """Convertit le script structure en payload story.json (compatible pipeline)."""
    hero = script["personnage_principal"]
    scenes = script["scenes"]
    dialogue_scenes: list[list[dict[str, str]]] = []
    script_lines: list[str] = []
    for sc in scenes:
        narr = str(sc.get("narration") or sc["action"]).strip()
        dialogue = sc.get("dialogue")
        if isinstance(dialogue, list) and dialogue:
            cleaned = []
            for line in dialogue:
                if isinstance(line, dict) and line.get("text"):
                    cleaned.append(
                        {
                            "speaker": str(line.get("speaker") or "heros"),
                            "text": str(line["text"]).strip(),
                        }
                    )
            if cleaned:
                dialogue_scenes.append(cleaned)
                for d in cleaned:
                    sp = str(d["speaker"]).upper()
                    script_lines.append(f"[{sp}] {d['text']}")
                script_lines.append("")
                continue
        dialogue_scenes.append([{"speaker": "heros", "text": narr}])
        script_lines.append(f"[HEROS] {narr}")
        script_lines.append("")

    return {
        "titre": script["titre"],
        "theme": script["theme"],
        "morale": script["morale"],
        "hero": hero["nom"],
        "hero_description": hero["description"],
        "friend": script["friend"],
        "place": script["place"],
        "script": "\n".join(script_lines).strip(),
        "dialogue_scenes": dialogue_scenes,
        "format": "dialogue",
        "age_group": script["age_group"],
        "duration_min": script["duration_min"],
        "target_scenes": len(scenes),
        "style_key": script["style_key"],
        "visual_style": script["style_visuel"] or style_prompt(script["style_key"]),
        "aspect": script["aspect"],
        "music": script["music"],
        "structured_scenes": scenes,
        "character_ref_hint": hero.get("reference_image"),
        "source": "structured_script",
        "word_count": len(re.findall(r"\w+", "\n".join(script_lines), flags=re.UNICODE)),
    }


def apply_structured_scenes_to_board(board: dict[str, Any], story: dict[str, Any]) -> None:
    """Enrichit le storyboard avec lieu/action/camera issus du script structure."""
    structured = story.get("structured_scenes") or []
    if not structured:
        return
    scenes = board.get("scenes") or []
    for i, scene in enumerate(scenes):
        if i >= len(structured):
            break
        sc = structured[i]
        scene["lieu"] = sc.get("lieu")
        scene["script_action"] = sc.get("action")
        scene["script_camera"] = sc.get("camera")
        scene["emotion"] = sc.get("emotion")
        scene["action_type"] = sc.get("action_type")
        scene["target_duration_sec"] = float(sc.get("duree_secondes") or 4)
        hero = str(board.get("hero_description") or board.get("hero") or "")
        style = str(board.get("visual_style") or "")
        scene["visual_prompt"] = build_scene_visual_prompt(
            sc,
            hero=hero,
            style=style,
            place=str(board.get("place") or ""),
        )
        scene["visual_prompt_source"] = "structured_script"
    board["structured_script"] = True
