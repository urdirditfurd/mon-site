"""Configuration centrale — trame d'origine (vidéo IA + publish auto)."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env", override=False)

DATA_DIR = Path(os.getenv("CONTE_DATA_DIR", ROOT / "data"))
VIDEOS_DIR = DATA_DIR / "videos"
CACHE_DIR = DATA_DIR / "cache"
EXPORTS_DIR = DATA_DIR / "exports"
DB_PATH = Path(os.getenv("CONTE_DB_PATH", DATA_DIR / "database.db"))
ASSETS_DIR = ROOT / "assets"
MUSIC_DIR = ASSETS_DIR / "music"
SECRETS_DIR = ROOT / "secrets"

# Durée cible (minutes). Le TTS décide la durée réelle.
TARGET_DURATION_MIN = float(os.getenv("CONTE_TARGET_DURATION_MIN", "30"))
# Durée narration cible par scène storyboard (secondes)
SCENE_TARGET_SEC = float(os.getenv("CONTE_SCENE_TARGET_SEC", "180"))

# Voix Edge-TTS — plus douce / moins mécanique
TTS_VOICE = os.getenv("CONTE_TTS_VOICE", "fr-FR-DeniseNeural")
TTS_RATE = os.getenv("CONTE_TTS_RATE", "-18%")
TTS_PITCH = os.getenv("CONTE_TTS_PITCH", "-2Hz")

# Style visuel fixe pour cohérence entre clips IA
VISUAL_STYLE = os.getenv(
    "CONTE_VISUAL_STYLE",
    "children's storybook illustration, soft watercolor, warm colors, "
    "friendly animals, enchanted forest, calm bedtime mood, no text, no watermark",
)

# Moteur visuel
# i2v     = TTS → image scène Pixar → Wan I2V (vraie animation) — recommandé
# talking = portrait + Wav2Lip (legacy / tête parlante)
# pinokio = Wan T2V brut (sans image de départ)
# images  = illustrations + Ken Burns
# fal     = cloud Kling (optionnel)
VIDEO_PROVIDER = os.getenv("CONTE_VIDEO_PROVIDER", "i2v")
FAL_KEY = os.getenv("FAL_KEY", os.getenv("FAL_API_KEY", ""))
FAL_MODEL = os.getenv(
    "CONTE_FAL_MODEL",
    "fal-ai/kling-video/v1.6/standard/text-to-video",
)
AI_CLIP_SEC = int(os.getenv("CONTE_AI_CLIP_SEC", "20"))
FAL_CONCURRENCY = int(os.getenv("CONTE_FAL_CONCURRENCY", "3"))
ASPECT_RATIO = os.getenv("CONTE_ASPECT_RATIO", "16:9")
IMAGE_BACKEND = os.getenv("CONTE_IMAGE_BACKEND", "auto")  # auto|pollinations|local|pillow

# Pinokio — Wan 2.1 T2V (optionnel)
PINOKIO_WAN_URL = os.getenv("PINOKIO_WAN_URL", "http://127.0.0.1:7860")
PINOKIO_WAN_ENGINE = os.getenv("PINOKIO_WAN_ENGINE", "")
PINOKIO_WAN_PYTHON = os.getenv("PINOKIO_WAN_PYTHON", "")
PINOKIO_WAN_RESOLUTION = os.getenv("PINOKIO_WAN_RESOLUTION", "480p 16:9")
PINOKIO_WAN_FRAMES = int(os.getenv("PINOKIO_WAN_FRAMES", "13"))
PINOKIO_WAN_STEPS = int(os.getenv("PINOKIO_WAN_STEPS", "10"))
WAN_CLIP_SPAN_SEC = float(os.getenv("CONTE_WAN_CLIP_SPAN_SEC", "22"))

# Wan I2V (Image-to-Video) — vraie animation RAPIDE (cible <90 s/scène après warm)
PINOKIO_I2V_URL = os.getenv("PINOKIO_I2V_URL", "http://127.0.0.1:7861")
PINOKIO_I2V_ENGINE = os.getenv("PINOKIO_I2V_ENGINE", "")
PINOKIO_I2V_PYTHON = os.getenv("PINOKIO_I2V_PYTHON", "")
# Plafonds RTX 3080 10 Go — batch 1 load + clips courts bouclés sur l'audio
PINOKIO_I2V_FRAMES = int(os.getenv("PINOKIO_I2V_FRAMES", "33"))
PINOKIO_I2V_STEPS = min(10, int(os.getenv("PINOKIO_I2V_STEPS", "8")))
PINOKIO_I2V_WIDTH = int(os.getenv("PINOKIO_I2V_WIDTH", "704"))
PINOKIO_I2V_HEIGHT = int(os.getenv("PINOKIO_I2V_HEIGHT", "384"))
PINOKIO_I2V_GUIDANCE = float(os.getenv("PINOKIO_I2V_GUIDANCE", "5.0"))
WAN_I2V_BACKEND = os.getenv("WAN_I2V_BACKEND", "ltx")  # ltx (rapide) | wan
CONTE_I2V_LOWVRAM = os.getenv("CONTE_I2V_LOWVRAM", "1") == "1"
AUTO_START_I2V = os.getenv("CONTE_AUTO_START_I2V", "1") == "1"
I2V_START_TIMEOUT_SEC = int(os.getenv("CONTE_I2V_TIMEOUT_SEC", "600"))

# Lip-sync Pinokio (legacy Wav2Lip)
PINOKIO_LIPSYNC_URL = os.getenv("PINOKIO_LIPSYNC_URL", "http://127.0.0.1:7870")
PINOKIO_LIPSYNC_ENGINE = os.getenv("PINOKIO_LIPSYNC_ENGINE", "")
AUTO_START_LIPSYNC = os.getenv("CONTE_AUTO_START_LIPSYNC", "0") == "1"
LIPSYNC_START_TIMEOUT_SEC = int(os.getenv("CONTE_LIPSYNC_TIMEOUT_SEC", "300"))

MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY", "")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
STORY_MODE = os.getenv("CONTE_STORY_MODE", "builtin")  # builtin | mistral | ollama

VIDEO_WIDTH = int(os.getenv("CONTE_VIDEO_WIDTH", "1920"))
VIDEO_HEIGHT = int(os.getenv("CONTE_VIDEO_HEIGHT", "1080"))
# Spec jeunesse : 24–30 FPS (jamais 60). Défaut cinéma doux 24.
VIDEO_FPS = int(os.getenv("CONTE_VIDEO_FPS", "24"))
# Musique à -14 dB sous les voix ≈ 0.20
MUSIC_VOLUME = float(os.getenv("CONTE_MUSIC_VOLUME", "0.20"))
# Export 4K pour 4–10 ans (upscale — tradeoff poids fichier)
EXPORT_4K = os.getenv("CONTE_EXPORT_4K", "0") == "1"

# Publication auto dès la fin du montage (exigence de viabilité)
AUTO_PUBLISH = os.getenv("CONTE_AUTO_PUBLISH", "1") == "1"
YOUTUBE_PRIVACY = os.getenv("CONTE_YOUTUBE_PRIVACY", "private")
PAUSE_PIPELINE = os.getenv("CONTE_PAUSE", "0") == "1"

# Démarrage auto de Wan (défaut ON si provider pinokio)
AUTO_START_WAN = os.getenv("CONTE_AUTO_START_WAN", "1") == "1"
WAN_START_TIMEOUT_SEC = int(os.getenv("CONTE_WAN_START_TIMEOUT_SEC", "600"))

CHANNEL_NAME = os.getenv("CONTE_CHANNEL_NAME", "Contes du Soir")
DEFAULT_TAGS = [
    "conte pour enfants",
    "histoire du soir",
    "conte magique",
    "vidéo enfants",
    "bedtime story français",
]


def ensure_dirs() -> None:
    for path in (DATA_DIR, VIDEOS_DIR, CACHE_DIR, EXPORTS_DIR, MUSIC_DIR, SECRETS_DIR):
        path.mkdir(parents=True, exist_ok=True)


def scene_sec_for_audience(age_group: str = "1-10") -> float:
    """Durée audio moyenne par scène — alignée spec rythme jeunesse."""
    from modules.youth_spec import youth_profile

    return float(youth_profile(age_group)["scene_target_sec"])


def shot_span_for_audience(age_group: str = "1-10") -> float:
    """Durée cible d'un plan visuel (Wan clip span) selon l'âge."""
    from modules.youth_spec import youth_profile

    return float(youth_profile(age_group)["wan_clip_span_sec"])


def scene_count_for_duration(
    duration_min: float | None = None,
    age_group: str = "1-10",
) -> int:
    """Nombre de scènes dialogues (plusieurs clips Wan possibles / scène)."""
    minutes = duration_min if duration_min is not None else TARGET_DURATION_MIN
    scene_sec = scene_sec_for_audience(age_group)

    if minutes <= 2:
        minimum = 4
        scene_sec = min(scene_sec, 30)
    elif minutes <= 5:
        minimum = 8
        scene_sec = min(scene_sec, max(35.0, scene_sec))
    elif minutes <= 15:
        minimum = 12
        scene_sec = max(scene_sec, 45)
    elif minutes <= 30:
        minimum = 16
        scene_sec = max(scene_sec, 70)
    else:
        minimum = 20
        scene_sec = max(scene_sec, 100)

    count = max(minimum, int(round((minutes * 60) / scene_sec)))
    return min(count, 36)


def wan_clip_budget(duration_min: float | None = None) -> int:
    """Plafond clips Wan pour rester <1h sur RTX 3080 (~2–3 min/clip)."""
    minutes = float(duration_min if duration_min is not None else TARGET_DURATION_MIN)
    if minutes <= 5:
        return 12
    if minutes <= 15:
        return 16
    if minutes <= 30:
        return 20
    return 24


def estimate_ai_clips(
    duration_min: float | None = None,
    age_group: str = "1-10",
) -> int:
    """Nombre de jobs visuels estimés (I2V/Wan = scènes, images = scènes)."""
    provider = VIDEO_PROVIDER.lower().strip()
    if provider in {"i2v", "wan_i2v", "image2video", "img2vid"}:
        return scene_count_for_duration(duration_min, age_group=age_group)
    if provider in {"pinokio", "wan", "wan21", "wan-snapdragon", "fal", "talking", "lipsync"}:
        return wan_clip_budget(duration_min)
    return scene_count_for_duration(duration_min, age_group=age_group)


def estimate_render_minutes(
    duration_min: float | None = None,
    age_group: str = "1-10",
) -> tuple[int, int]:
    """Estimation temps de création (minutes) selon le provider."""
    clips = estimate_ai_clips(duration_min, age_group=age_group)
    provider = VIDEO_PROVIDER.lower().strip()
    if provider in {"images", "image", "still", "stills", "invideo"}:
        low = max(3, int(round(clips * 0.35 + 2)))
        high = max(6, int(round(clips * 0.9 + 4)))
        return low, high
    if provider in {"i2v", "wan_i2v", "image2video", "img2vid"}:
        # Batch 1 load + 33f/8steps/704x384 → ~45–90 s/scène apres warm
        low = max(6, int(round(clips * 0.75 + 4)))
        high = max(12, int(round(clips * 1.5 + 6)))
        return min(low, 40), min(high, 50)
    if provider in {"talking", "lipsync", "talk"}:
        low = max(8, int(round(clips * 0.6 + 4)))
        high = max(15, int(round(clips * 1.5 + 8)))
        return min(low, 50), min(high, 65)
    low = max(15, int(round(clips * 1.8 + 5)))
    high = max(25, int(round(clips * 3.2 + 8)))
    return min(low, 55), min(high, 70)
