"""Configuration centrale — tout se règle ici ou via le fichier .env."""

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

# Durée cible (minutes). Le TTS décide la durée réelle.
TARGET_DURATION_MIN = float(os.getenv("CONTE_TARGET_DURATION_MIN", "30"))
SCENE_TARGET_SEC = float(os.getenv("CONTE_SCENE_TARGET_SEC", "60"))

# Voix Edge-TTS (français, douce)
TTS_VOICE = os.getenv("CONTE_TTS_VOICE", "fr-FR-DeniseNeural")
TTS_RATE = os.getenv("CONTE_TTS_RATE", "-5%")

# Style visuel fixe pour cohérence
VISUAL_STYLE = os.getenv(
    "CONTE_VISUAL_STYLE",
    "children's storybook illustration, soft watercolor, warm colors, "
    "friendly animals, enchanted forest, no text, no watermark",
)

# Mode images : demo (rapide, sans API) | pollinations (gratuit) | openai
IMAGE_MODE = os.getenv("CONTE_IMAGE_MODE", "demo")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY", "")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
STORY_MODE = os.getenv("CONTE_STORY_MODE", "builtin")  # builtin | mistral | ollama

# Vidéo
VIDEO_WIDTH = int(os.getenv("CONTE_VIDEO_WIDTH", "1920"))
VIDEO_HEIGHT = int(os.getenv("CONTE_VIDEO_HEIGHT", "1080"))
VIDEO_FPS = int(os.getenv("CONTE_VIDEO_FPS", "30"))
MUSIC_VOLUME = float(os.getenv("CONTE_MUSIC_VOLUME", "0.12"))

# Publication
AUTO_PUBLISH = os.getenv("CONTE_AUTO_PUBLISH", "0") == "1"
YOUTUBE_PRIVACY = os.getenv("CONTE_YOUTUBE_PRIVACY", "private")  # private | unlisted | public
PAUSE_PIPELINE = os.getenv("CONTE_PAUSE", "0") == "1"

# Chaîne
CHANNEL_NAME = os.getenv("CONTE_CHANNEL_NAME", "Contes du Soir")
DEFAULT_TAGS = [
    "conte pour enfants",
    "histoire du soir",
    "conte magique",
    "vidéo enfants",
    "bedtime story français",
]


def ensure_dirs() -> None:
    for path in (DATA_DIR, VIDEOS_DIR, CACHE_DIR, EXPORTS_DIR, MUSIC_DIR):
        path.mkdir(parents=True, exist_ok=True)


def scene_count_for_duration(duration_min: float | None = None) -> int:
    minutes = duration_min if duration_min is not None else TARGET_DURATION_MIN
    # Au moins 4 scènes pour une vraie narration ; le mode --short/--micro baisse la durée.
    minimum = 2 if minutes <= 2 else 4 if minutes < 10 else 8
    return max(minimum, int(round((minutes * 60) / SCENE_TARGET_SEC)))
