"""Étape 2 — Image de référence personnage (ancre I2V / lip-sync).

Génère un portrait fixe cohérent (style Pixar/enfants) pour héros et ami.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from modules.image_ai import generate_scene_image, set_image_output_size
from modules.youth_spec import normalize_age, youth_profile, youth_visual_suffix


def _portrait_prompt(role: str, description: str, style_key: str, age_group: str) -> str:
    from modules.creative_options import style_prompt

    profile = youth_profile(age_group)
    base_style = style_prompt(style_key)
    who = description.strip() or "a friendly magical creature"
    role_label = "main hero" if role == "heros" else "cute friend companion"
    return (
        f"Cute 3D Pixar style illustration, vibrant pastel colors, bright soft lighting, "
        f"front view character portrait, clear facial features, friendly expression, "
        f"clean soft background, highly detailed children's character, 8k render. "
        f"{base_style}. "
        f"Subject ({role_label}): {who}. "
        f"Medium close-up, face clearly visible and large enough for lip-sync, "
        f"looking at camera, mouth slightly closed, eyes open, "
        f"{youth_visual_suffix(profile)} "
        f"no text, no watermark, no logo, no extra characters"
    )


def ensure_character_refs(projet: Path, board: dict[str, Any]) -> dict[str, Path]:
    """Crée/retourne portraits héros + ami (seed stable = cohérence visuelle)."""
    refs_dir = projet / "characters"
    refs_dir.mkdir(parents=True, exist_ok=True)
    meta_path = refs_dir / "refs.json"

    hero = str(board.get("hero") or board.get("theme") or "magical hero")
    friend = str(board.get("friend") or "Lumi the friendly star")
    style_key = str(board.get("style_key") or "3d_mignon")
    age = normalize_age(str(board.get("age_group") or "1-10"))
    theme_key = str(board.get("theme") or hero)
    base_seed = int(hashlib.md5(theme_key.encode("utf-8")).hexdigest()[:8], 16) % 1_000_000

    # Portrait 16:9 mais visage centré / assez grand
    set_image_output_size(1280, 720)

    paths: dict[str, Path] = {
        "heros": refs_dir / "heros_portrait.png",
        "ami": refs_dir / "ami_portrait.png",
        "choeur": refs_dir / "heros_portrait.png",  # choeur = héros
    }

    generate_scene_image(
        _portrait_prompt("heros", hero, style_key, age),
        paths["heros"],
        seed=base_seed,
        width=1280,
        height=720,
    )
    generate_scene_image(
        _portrait_prompt("ami", friend, style_key, age),
        paths["ami"],
        seed=(base_seed + 77) % 1_000_000,
        width=1280,
        height=720,
    )

    meta = {
        "hero": hero,
        "friend": friend,
        "style_key": style_key,
        "age_group": age,
        "seed_heros": base_seed,
        "seed_ami": (base_seed + 77) % 1_000_000,
        "files": {k: v.name for k, v in paths.items() if k != "choeur"},
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return paths
