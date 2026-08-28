"""Styles visuels, formats, musique et voix personnages."""

from __future__ import annotations

import os

# Styles d'illustration (préfixe de prompt)
VISUAL_STYLES: dict[str, str] = {
    "aquarelle": (
        "children's storybook watercolor illustration, soft washes, warm pastel palette, "
        "gentle lighting, hand-painted 2D look, flat illustration, "
        "no 3D rendering, no Pixar, no CGI, no photorealistic, no text, no watermark"
    ),
    "anime_doux": (
        "soft anime illustration for children, clean lines, pastel colors, cozy lighting, "
        "Studio Ghibli inspired mood, no text, no watermark"
    ),
    "3d_mignon": (
        "3D Pixar animation style, Disney quality rendering, cute character design, "
        "vibrant colors, soft cinematic lighting, subsurface scattering skin, "
        "detailed textures, volumetric lighting, expressive facial features, "
        "professional animation studio quality, depth of field, no text, no watermark"
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

# Voix Edge-TTS jeunesse / conteuse haute qualite (Multilingual Neural)
CHARACTER_VOICES: dict[str, dict[str, str]] = {
    "femme": {
        "heros": "fr-FR-VivienneMultilingualNeural",
        "ami": "fr-FR-RemyMultilingualNeural",
        "choeur": "fr-FR-VivienneMultilingualNeural",
    },
    "homme": {
        "heros": "fr-FR-RemyMultilingualNeural",
        "ami": "fr-FR-VivienneMultilingualNeural",
        "choeur": "fr-FR-RemyMultilingualNeural",
    },
    "auto": {
        "heros": "fr-FR-VivienneMultilingualNeural",
        "ami": "fr-FR-RemyMultilingualNeural",
        "choeur": "fr-FR-VivienneMultilingualNeural",
    },
}

# Mots / minute ÉCRITS pour atteindre la durée parlée (dialogues + pauses)
# Edge-TTS FR enfants parle plus vite que 125 wpm → viser plus haut.
WORDS_PER_MINUTE = float(os.getenv("CONTE_WORDS_PER_MIN", "155"))


def style_prompt(style_key: str) -> str:
    key = (style_key or "aquarelle").strip().lower()
    return VISUAL_STYLES.get(key, VISUAL_STYLES["aquarelle"])


def format_size(format_key: str) -> tuple[int, int]:
    key = (format_key or "16:9").strip()
    return FORMAT_PRESETS.get(key, FORMAT_PRESETS["16:9"])


def voices_for_preference(preference: str = "auto") -> dict[str, str]:
    key = (preference or "auto").strip().lower()
    return dict(CHARACTER_VOICES.get(key, CHARACTER_VOICES["auto"]))
