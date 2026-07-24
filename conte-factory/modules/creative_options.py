"""Styles visuels, formats et musique — options utilisateur Creation."""

from __future__ import annotations

import os

# Styles d'illustration (préfixe de prompt)
VISUAL_STYLES: dict[str, str] = {
    "aquarelle": (
        "children's storybook watercolor illustration, soft washes, warm pastel palette, "
        "gentle lighting, hand-painted look, no text, no watermark"
    ),
    "anime_doux": (
        "soft anime illustration for children, clean lines, pastel colors, cozy lighting, "
        "Studio Ghibli inspired mood, no text, no watermark"
    ),
    "3d_mignon": (
        "cute 3D rendered children's character art, soft clay-like materials, warm light, "
        "Pixar-like friendliness, no text, no watermark"
    ),
    "conte_classique": (
        "classic European fairy-tale book plate, detailed ink and soft color, vintage charm, "
        "magical atmosphere, no text, no watermark"
    ),
    "papier_decoupe": (
        "paper-cut stop-motion style illustration, layered paper textures, soft shadows, "
        "whimsical children's craft look, no text, no watermark"
    ),
}

FORMAT_PRESETS: dict[str, tuple[int, int]] = {
    "16:9": (1920, 1080),
    "9:16": (1080, 1920),
    "1:1": (1080, 1080),
}

MUSIC_OPTIONS: dict[str, str] = {
    "aucune": "Pas de musique de fond",
    "berceuse": "Berceuse douce generee (libre)",
    "fichier": "Fichier libre de droit dans assets/music/",
}

# Mots / minute narration enfants (voix ralentie)
WORDS_PER_MINUTE = float(os.getenv("CONTE_WORDS_PER_MIN", "125"))


def style_prompt(style_key: str) -> str:
    key = (style_key or "aquarelle").strip().lower()
    return VISUAL_STYLES.get(key, VISUAL_STYLES["aquarelle"])


def format_size(format_key: str) -> tuple[int, int]:
    key = (format_key or "16:9").strip()
    return FORMAT_PRESETS.get(key, FORMAT_PRESETS["16:9"])
