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
SCENE_TARGET_SEC = float(os.getenv("CONTE_SCENE_TARGET_SEC", "60"))

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
PINOKIO_WAN_FRAMES = int(os.getenv("PINOKIO_WAN_FRAMES", "33"))
PINOKIO_WAN_STEPS = int(os.getenv("PINOKIO_WAN_STEPS", "20"))

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


def scene_count_for_duration(duration_min: float | None = None) -> int:
    minutes = duration_min if duration_min is not None else TARGET_DURATION_MIN
    minimum = 2 if minutes <= 2 else 4 if minutes < 10 else 8
    return max(minimum, int(round((minutes * 60) / SCENE_TARGET_SEC)))


def estimate_ai_clips(duration_min: float | None = None) -> int:
    """Nombre approximatif de clips IA (5–10 s) pour couvrir la durée."""
    minutes = duration_min if duration_min is not None else TARGET_DURATION_MIN
    clip = max(5, AI_CLIP_SEC)
    return max(1, int(round((minutes * 60) / clip)))
