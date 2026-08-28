"""P3 — Lock personnage : description + image de reference persistante."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from modules.image_ai import generate_scene_image, set_image_output_size
from modules.style_lock import apply_style_lock, normalize_style_key
from modules.youth_spec import normalize_age, youth_profile, youth_visual_suffix


def character_lock_clause(board: dict[str, Any]) -> str:
    """Texte impose dans tous les prompts (description stable du heros)."""
    hero = str(
        board.get("hero_description")
        or board.get("hero")
        or board.get("theme")
        or "storybook hero"
    ).strip()
    name = str(board.get("hero") or "hero").strip()
    return (
        f"same character identity throughout: {name}, {hero}, "
        f"identical outfit, identical hair, identical face design, "
        f"consistent proportions, do not change gender or age or clothing"
    )


def _fullbody_prompt(board: dict[str, Any]) -> str:
    hero = str(board.get("hero_description") or board.get("hero") or "child hero")
    style_key = normalize_style_key(str(board.get("style_key") or "aquarelle"))
    age = normalize_age(str(board.get("age_group") or "1-10"))
    profile = youth_profile(age)
    raw = (
        f"full-body character design sheet, single character centered, "
        f"clear silhouette, friendly expression, standing pose, "
        f"Subject: {hero}. {youth_visual_suffix(profile)} "
        f"plain soft background, no other characters, no text, no watermark"
    )
    return apply_style_lock(raw, style_key)


def ensure_hero_reference(
    projet: Path,
    board: dict[str, Any],
    *,
    width: int = 848,
    height: int = 480,
) -> Path:
    """
    Genere / reutilise une image de reference heros (init_frame character lock).
    Priorite: chemin fourni dans story/board > characters/hero_ref.png existant > T2I.
    """
    refs_dir = projet / "characters"
    refs_dir.mkdir(parents=True, exist_ok=True)
    dest = refs_dir / "hero_ref.png"

    personnage = board.get("personnage_principal")
    ref_from_perso = None
    if isinstance(personnage, dict):
        ref_from_perso = personnage.get("reference_image")
    hint = (
        board.get("character_ref_path")
        or board.get("character_ref_hint")
        or ref_from_perso
    )
    if hint:
        src = Path(str(hint))
        if not src.is_absolute():
            src = projet / src
        if src.exists() and src.stat().st_size > 1000:
            if src.resolve() != dest.resolve():
                dest.write_bytes(src.read_bytes())
            board["character_ref_path"] = str(dest)
            return dest

    if dest.exists() and dest.stat().st_size > 1000:
        board["character_ref_path"] = str(dest)
        return dest

    theme_key = str(board.get("theme") or board.get("hero") or "hero")
    seed = int(hashlib.md5(theme_key.encode("utf-8")).hexdigest()[:8], 16) % 1_000_000
    set_image_output_size(width, height)
    generate_scene_image(
        _fullbody_prompt(board),
        dest,
        seed=seed,
        width=width,
        height=height,
    )
    meta = {
        "hero": board.get("hero"),
        "hero_description": board.get("hero_description"),
        "style_key": board.get("style_key"),
        "path": dest.name,
    }
    (refs_dir / "hero_ref.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    board["character_ref_path"] = str(dest)
    return dest


def apply_character_lock(prompt: str, board: dict[str, Any]) -> str:
    clause = character_lock_clause(board)
    base = (prompt or "").strip()
    return f"{base}. {clause}" if base else clause
