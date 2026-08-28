"""Spec obligatoire videos jeunesse (1-10 ans).

Critères techniques/artistiques appliqués à chaque génération :
- FPS 24–30 (jamais 60)
- Résolution / format selon l'âge
- Colorimétrie adaptée
- Rythme de plans selon l'attention
- Mix audio : musique à -14 dB sous les voix
"""

from __future__ import annotations

from typing import Any

# -14 dB = 10^(-14/20) ≈ 0.200
MUSIC_DB_BELOW_VOICE = -14.0
MUSIC_LINEAR_VS_VOICE = 10 ** (MUSIC_DB_BELOW_VOICE / 20.0)  # ~0.200


def normalize_age(age_group: str | None) -> str:
    key = (age_group or "1-10").strip().lower().replace(" ", "")
    aliases = {
        "1-9": "1-10",
        "1–9": "1-10",
        "1–10": "1-10",
        "7-9": "7-10",
        "7–9": "7-10",
        "7–10": "7-10",
        "tous": "1-10",
        "all": "1-10",
    }
    key = aliases.get(key, key)
    if key in {"1-3", "4-6", "7-10", "1-10"}:
        return key
    return "1-10"


def youth_profile(age_group: str | None = "1-10") -> dict[str, Any]:
    """Profil technique obligatoire pour la tranche d'âge."""
    age = normalize_age(age_group)

    # Commun : cinéma doux, jamais 60 FPS
    base = {
        "age_group": age,
        "fps": 24,
        "aspect": "16:9",
        "avoid_60fps": True,
        "music_db_below_voice": MUSIC_DB_BELOW_VOICE,
        "music_volume": round(MUSIC_LINEAR_VS_VOICE, 3),
        "motion_blur": "minimal",
        "camera": "wide clear framing, no excessive motion blur",
    }

    if age == "1-3":
        base.update(
            {
                "label": "1-3 ans (eveil visuel)",
                "width": 1920,
                "height": 1080,
                "resolution_label": "Full HD",
                "fps": 24,
                "shot_sec_min": 6.0,
                "shot_sec_max": 10.0,
                "wan_clip_span_sec": 9.0,
                "scene_target_sec": 50.0,
                "kenburns_speed": "very_slow",
                "tts_rate": "-20%",
                "tts_pitch": "-1Hz",
                "color_prompt": (
                    "saturated primary and secondary colors (red, blue, yellow, green), "
                    "high clear contrast, NOT neon, NOT fluorescent, "
                    "bright friendly background, never pure black background, "
                    "simple clean shapes with sharp outlines"
                ),
                "motion_prompt": (
                    "very slow ample camera move, long calm takes, "
                    "smooth gentle character motion, no sudden jerks, no rapid cuts feel"
                ),
                "audio_prompt": "soft gentle foley only, calm bedtime soundscape",
            }
        )
    elif age == "4-6":
        base.update(
            {
                "label": "4-6 ans (narration dynamique douce)",
                "width": 1920,
                "height": 1080,
                "resolution_label": "Full HD (source); export cible 4K si CONTE_EXPORT_4K=1",
                "export_4k_default": True,
                "width_4k": 3840,
                "height_4k": 2160,
                "fps": 24,
                "shot_sec_min": 3.0,
                "shot_sec_max": 5.0,
                "wan_clip_span_sec": 4.5,
                "scene_target_sec": 35.0,
                "kenburns_speed": "slow",
                "tts_rate": "-12%",
                "tts_pitch": "-1Hz",
                "color_prompt": (
                    "rich harmonious children's palette with gentle color grading, "
                    "warm tones for joy and safety, cool tones only for mild wonder, "
                    "clear contrast, no neon, readable shapes"
                ),
                "motion_prompt": (
                    "smooth medium-paced cinematic moves, clear axis continuity, "
                    "expressive but soft character animation, no whip pans"
                ),
                "audio_prompt": "light immersive sound design, soft foley, music tucked under voices",
            }
        )
    elif age == "7-10":
        base.update(
            {
                "label": "7-10 ans (rythme cinema narratif)",
                "width": 1920,
                "height": 1080,
                "resolution_label": "Full HD (source); export cible 4K si CONTE_EXPORT_4K=1",
                "export_4k_default": True,
                "width_4k": 3840,
                "height_4k": 2160,
                "fps": 24,
                "shot_sec_min": 2.0,
                "shot_sec_max": 4.0,
                "wan_clip_span_sec": 3.5,
                "scene_target_sec": 28.0,
                "kenburns_speed": "medium",
                "tts_rate": "-8%",
                "tts_pitch": "+0Hz",
                "color_prompt": (
                    "cinematic children's color grade, emotional palette, "
                    "warm for safety/joy, cooler accents for gentle suspense, "
                    "clear contrast, detailed but soft, no neon"
                ),
                "motion_prompt": (
                    "fluid narrative cinema pacing, motivated camera moves, "
                    "continuous storytelling motion, minimal motion blur"
                ),
                "audio_prompt": "richer immersive sound design under clear dialogue",
            }
        )
    else:  # 1-10 — compromis doux pour tous
        base.update(
            {
                "label": "1-10 ans (compromis doux)",
                "width": 1920,
                "height": 1080,
                "resolution_label": "Full HD",
                "fps": 24,
                "shot_sec_min": 4.0,
                "shot_sec_max": 8.0,
                "wan_clip_span_sec": 6.0,
                "scene_target_sec": 40.0,
                "kenburns_speed": "slow",
                "tts_rate": "-14%",
                "tts_pitch": "-1Hz",
                "color_prompt": (
                    "warm friendly children's palette, clear saturated but not neon colors, "
                    "bright scenes, no pure black backgrounds, readable shapes"
                ),
                "motion_prompt": (
                    "smooth ample motion, calm cinematic pacing, "
                    "no sudden jerks, minimal motion blur"
                ),
                "audio_prompt": "soft foley, music clearly under voices",
            }
        )
    return base


def export_size(profile: dict[str, Any], export_4k: bool = False) -> tuple[int, int]:
    """Taille d'export master. 4K seulement si demandé et profil 4-10."""
    if export_4k and profile.get("export_4k_default"):
        return int(profile.get("width_4k") or 3840), int(profile.get("height_4k") or 2160)
    return int(profile.get("width") or 1920), int(profile.get("height") or 1080)


def youth_visual_suffix(profile: dict[str, Any]) -> str:
    return (
        f"{profile.get('color_prompt')}. {profile.get('motion_prompt')}. "
        f"{profile.get('camera')}. {profile.get('audio_prompt')}."
    )


def kenburns_zoom_delta(profile: dict[str, Any]) -> float:
    speed = str(profile.get("kenburns_speed") or "slow")
    return {
        "very_slow": 0.00018,
        "slow": 0.00028,
        "medium": 0.00038,
    }.get(speed, 0.00028)
