"""P2 — Lock de style visuel global (anti melange aquarelle/Pixar)."""

from __future__ import annotations

from modules.creative_options import VISUAL_STYLES, style_prompt

STYLE_PRESETS: dict[str, str] = {
    "aquarelle": (
        "watercolor illustration, soft pastel colors, children's book style, "
        "hand-painted texture, flat 2D illustration, ink and wash"
    ),
    "anime_doux": (
        "soft anime 2D illustration, Studio Ghibli inspired, clean lines, pastel colors"
    ),
    "3d_mignon": (
        "3D Pixar animation style, Disney quality rendering, cute character design, "
        "vibrant colors, soft cinematic lighting, subsurface scattering, "
        "detailed textures, volumetric lighting, expressive eyes"
    ),
    "conte_classique": (
        "classic European fairy-tale book plate, detailed ink and soft watercolor wash"
    ),
    "papier_decoupe": (
        "paper-cut stop-motion style, layered paper textures, craft children's look"
    ),
}

STYLE_NEGATIVES: dict[str, str] = {
    "aquarelle": (
        "no 3D rendering, no CGI, no Pixar, no photorealistic, no plastic materials, "
        "no Unreal Engine, no octane render"
    ),
    "anime_doux": "no photorealistic, no 3D CGI, no live action",
    "3d_mignon": (
        "no flat 2D watercolor, no sketchy lineart only, no photorealistic live action, "
        "no deformed face, no blurry, no loop, no repetition, no static frozen pose"
    ),
    "conte_classique": "no modern 3D CGI, no photorealistic",
    "papier_decoupe": "no photorealistic, no smooth 3D CGI",
}


def normalize_style_key(style_key: str | None) -> str:
    key = (style_key or "aquarelle").strip().lower()
    if key in STYLE_PRESETS or key in VISUAL_STYLES:
        return key
    return "aquarelle"


def style_lock_positive(style_key: str | None) -> str:
    key = normalize_style_key(style_key)
    return STYLE_PRESETS.get(key) or style_prompt(key)


def style_lock_negative(style_key: str | None) -> str:
    key = normalize_style_key(style_key)
    return STYLE_NEGATIVES.get(key, "")


def apply_style_lock(prompt: str, style_key: str | None) -> str:
    """Impose le style choisi et ajoute les interdits (ex: no Pixar si aquarelle)."""
    key = normalize_style_key(style_key)
    positive = style_lock_positive(key)
    negative = style_lock_negative(key)
    base = (prompt or "").strip()
    # Eviter de re-injecter un prefixe Pixar contradictoire
    low = base.lower()
    if key == "aquarelle":
        for bad in ("pixar", "3d rendered", "cgi", "octane"):
            if bad in low:
                base = base  # le negative suffira ; on prefixe le style fort
    parts = [positive, base]
    if negative:
        parts.append(negative)
    return ". ".join(p for p in parts if p)
