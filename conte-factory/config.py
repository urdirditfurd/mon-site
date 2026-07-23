"""Configuration centrale — trame d'origine (vidéo IA + publish auto)."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

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

# Voix Edge-TTS
TTS_VOICE = os.getenv("CONTE_TTS_VOICE", "fr-FR-DeniseNeural")
TTS_RATE = os.getenv("CONTE_TTS_RATE", "-5%")

# Style visuel fixe pour cohérence entre clips IA
VISUAL_STYLE = os.getenv(
    "CONTE_VISUAL_STYLE",
    "children's storybook animation, soft watercolor, warm colors, "
    "friendly animals, enchanted forest, gentle camera motion, no text, no watermark",
)

# Moteur vidéo IA
# pinokio = Wan 2.1 via Pinokio (recommandé pour ce projet)
# fal     = cloud Kling (optionnel)
VIDEO_PROVIDER = os.getenv("CONTE_VIDEO_PROVIDER", "pinokio")
FAL_KEY = os.getenv("FAL_KEY", os.getenv("FAL_API_KEY", ""))
FAL_MODEL = os.getenv(
    "CONTE_FAL_MODEL",
    "fal-ai/kling-video/v1.6/standard/text-to-video",
)
AI_CLIP_SEC = int(os.getenv("CONTE_AI_CLIP_SEC", "20"))
FAL_CONCURRENCY = int(os.getenv("CONTE_FAL_CONCURRENCY", "2"))
ASPECT_RATIO = os.getenv("CONTE_ASPECT_RATIO", "16:9")

# Pinokio — Wan 2.1 Snapdragon / local
PINOKIO_WAN_URL = os.getenv("PINOKIO_WAN_URL", "http://127.0.0.1:7860")
PINOKIO_WAN_ENGINE = os.getenv("PINOKIO_WAN_ENGINE", "")
PINOKIO_WAN_PYTHON = os.getenv("PINOKIO_WAN_PYTHON", "")
PINOKIO_WAN_RESOLUTION = os.getenv("PINOKIO_WAN_RESOLUTION", "480p 16:9")
PINOKIO_WAN_FRAMES = int(os.getenv("PINOKIO_WAN_FRAMES", "13"))
PINOKIO_WAN_STEPS = int(os.getenv("PINOKIO_WAN_STEPS", "10"))

MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY", "")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
STORY_MODE = os.getenv("CONTE_STORY_MODE", "builtin")  # builtin | mistral | ollama

VIDEO_WIDTH = int(os.getenv("CONTE_VIDEO_WIDTH", "1920"))
VIDEO_HEIGHT = int(os.getenv("CONTE_VIDEO_HEIGHT", "1080"))
VIDEO_FPS = int(os.getenv("CONTE_VIDEO_FPS", "30"))
MUSIC_VOLUME = float(os.getenv("CONTE_MUSIC_VOLUME", "0.12"))

# Publication auto dès la fin du montage (exigence de viabilité)
AUTO_PUBLISH = os.getenv("CONTE_AUTO_PUBLISH", "1") == "1"
YOUTUBE_PRIVACY = os.getenv("CONTE_YOUTUBE_PRIVACY", "private")
PAUSE_PIPELINE = os.getenv("CONTE_PAUSE", "0") == "1"

# Démarrage auto de Wan quand on ouvre le dashboard ou le pipeline
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


def scene_sec_for_audience(age_group: str = "1-9") -> float:
    """Rythme visuel pour contes du soir (1–9 ans).

    La voix porte l'attention ; le clip Wan boucle avec un léger mouvement.
    Pas besoin d'un nouveau plan toutes les 15–60 s — ça sur-génère pour rien
    et ça agite trop pour s'endormir.
    """
    key = (age_group or "1-9").strip().lower()
    # secondes de narration / scène visuelle (= 1 clip Wan bouclé)
    mapping = {
        "1-3": 210.0,  # ~3,5 min — très calme (tout-petits)
        "4-6": 180.0,  # ~3 min
        "7-9": 150.0,  # ~2,5 min — un peu plus de variété
        "1-9": 180.0,  # défaut bedtime large 1–9
    }
    return mapping.get(key, mapping["1-9"])


def scene_count_for_duration(
    duration_min: float | None = None,
    age_group: str = "1-9",
) -> int:
    """Nombre de scènes = nombre de clips Wan (1 clip/scène, bouclé).

    Ex. 30 min / public 1–9 → ~10 scènes (pas 15, encore moins 120).
    """
    minutes = duration_min if duration_min is not None else TARGET_DURATION_MIN
    scene_sec = scene_sec_for_audience(age_group)

    # Courtes vidéos : garder un minimum de décors sans remonter au rythme adulte
    if minutes <= 2:
        minimum = 2
        scene_sec = min(scene_sec, 50)
    elif minutes <= 5:
        minimum = 2
        scene_sec = min(scene_sec, 90)
    elif minutes <= 15:
        minimum = 4
    else:
        minimum = 6

    return max(minimum, int(round((minutes * 60) / scene_sec)))


def estimate_ai_clips(
    duration_min: float | None = None,
    age_group: str = "1-9",
) -> int:
    """1 clip Wan par scène (bouclé au montage)."""
    return scene_count_for_duration(duration_min, age_group=age_group)


def estimate_render_minutes(
    duration_min: float | None = None,
    age_group: str = "1-9",
) -> tuple[int, int]:
    """Estimation temps GPU (minutes)."""
    clips = estimate_ai_clips(duration_min, age_group=age_group)
    low = max(2, int(round(clips * 0.8 + 3)))
    high = max(5, int(round(clips * 2.2 + 5)))
    return low, high
