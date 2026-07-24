"""Génération d'images IA pour contes (1 image / scène) — mode rapide style Invideo.

Backends (dans l'ordre) :
1. pollinations (HTTP, gratuit, rapide) — défaut
2. local SDXL-Turbo via le Python Wan (si CONTE_IMAGE_BACKEND=local)
3. illustration Pillow de secours (toujours dispo)
"""

from __future__ import annotations

import hashlib
import io
import os
import random
import subprocess
import urllib.parse
from pathlib import Path
from typing import Any

import requests
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from config import (
    CACHE_DIR,
    PINOKIO_WAN_PYTHON,
    ROOT,
    VIDEO_HEIGHT,
    VIDEO_WIDTH,
    VISUAL_STYLE,
)

IMAGE_BACKEND = os.getenv("CONTE_IMAGE_BACKEND", "auto").strip().lower()
IMAGE_WIDTH = int(os.getenv("CONTE_IMAGE_WIDTH", str(min(1280, VIDEO_WIDTH))))
IMAGE_HEIGHT = int(os.getenv("CONTE_IMAGE_HEIGHT", str(min(720, VIDEO_HEIGHT))))
POLLINATIONS_MODEL = os.getenv("CONTE_POLLINATIONS_MODEL", "flux")


def _safe_prompt(prompt: str, max_len: int = 420) -> str:
    text = " ".join((prompt or "").split())
    if not text:
        text = f"{VISUAL_STYLE}, magical children's storybook scene"
    if VISUAL_STYLE.lower() not in text.lower():
        text = f"{VISUAL_STYLE}, {text}"
    # Renforcer le style conte (pas de texte à l'écran)
    text = f"{text}, soft storybook illustration, calm bedtime mood, no text, no watermark, no logo"
    return text[:max_len]


def generate_scene_image(prompt: str, dest: Path) -> Path:
    """Produit une image PNG pour une scène."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 2000:
        return dest

    prompt = _safe_prompt(prompt)
    errors: list[str] = []

    backends = _backends_order()
    for name in backends:
        try:
            if name == "pollinations":
                _via_pollinations(prompt, dest)
            elif name == "local":
                _via_local_sd(prompt, dest)
            elif name == "pillow":
                _via_pillow(prompt, dest)
            else:
                continue
            if dest.exists() and dest.stat().st_size > 2000:
                return dest
        except Exception as exc:
            errors.append(f"{name}: {exc}")

    # Dernier recours
    _via_pillow(prompt, dest)
    if dest.exists() and dest.stat().st_size > 500:
        return dest
    raise RuntimeError("Generation image impossible: " + " | ".join(errors[:3]))


def _backends_order() -> list[str]:
    if IMAGE_BACKEND in {"pollinations", "local", "pillow"}:
        if IMAGE_BACKEND == "local":
            return ["local", "pollinations", "pillow"]
        if IMAGE_BACKEND == "pillow":
            return ["pillow"]
        return ["pollinations", "local", "pillow"]
    # auto : prioriser la vitesse (pollinations), puis local, puis fallback
    return ["pollinations", "local", "pillow"]


def _via_pollinations(prompt: str, dest: Path) -> None:
    encoded = urllib.parse.quote(prompt)
    seed = int(hashlib.md5(prompt.encode("utf-8")).hexdigest()[:8], 16) % 1_000_000
    url = (
        f"https://image.pollinations.ai/prompt/{encoded}"
        f"?width={IMAGE_WIDTH}&height={IMAGE_HEIGHT}"
        f"&model={POLLINATIONS_MODEL}&nologo=true&enhance=true&seed={seed}"
    )
    resp = requests.get(url, timeout=180)
    resp.raise_for_status()
    ctype = (resp.headers.get("content-type") or "").lower()
    if "image" not in ctype and len(resp.content) < 2000:
        raise RuntimeError(f"Reponse non-image ({ctype})")
    dest.write_bytes(resp.content)
    # Normaliser en PNG
    img = Image.open(io.BytesIO(dest.read_bytes())).convert("RGB")
    img = img.resize((IMAGE_WIDTH, IMAGE_HEIGHT), Image.Resampling.LANCZOS)
    img.save(dest, format="PNG", optimize=True)


def _via_local_sd(prompt: str, dest: Path) -> None:
    from modules.video_ai import resolve_wan_engine, resolve_wan_python

    engine = resolve_wan_engine()
    py = Path(PINOKIO_WAN_PYTHON) if PINOKIO_WAN_PYTHON else Path(resolve_wan_python(engine))
    if not py.exists():
        raise FileNotFoundError(f"Python Wan introuvable: {py}")

    script = ROOT / "scripts" / "generate_still.py"
    if not script.exists():
        raise FileNotFoundError(f"Script manquant: {script}")

    cache = CACHE_DIR / "sd_models"
    cache.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [
            str(py),
            str(script),
            "--prompt",
            prompt,
            "--output",
            str(dest),
            "--width",
            str(IMAGE_WIDTH),
            "--height",
            str(IMAGE_HEIGHT),
            "--cache",
            str(cache),
        ],
        capture_output=True,
        text=True,
        timeout=600,
        env={**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"},
    )
    if proc.returncode != 0 or not dest.exists():
        raise RuntimeError((proc.stderr or proc.stdout or "local sd failed")[-1200:])


def _via_pillow(prompt: str, dest: Path) -> None:
    """Illustration douce de secours (pas de réseau / pas de GPU)."""
    rng = random.Random(hashlib.md5(prompt.encode("utf-8")).hexdigest())
    w, h = IMAGE_WIDTH, IMAGE_HEIGHT
    img = Image.new("RGB", (w, h))
    draw = ImageDraw.Draw(img)

    top = (rng.randint(40, 90), rng.randint(50, 110), rng.randint(120, 180))
    bot = (rng.randint(180, 230), rng.randint(140, 200), rng.randint(90, 140))
    for y in range(h):
        t = y / max(1, h - 1)
        col = tuple(int(top[i] * (1 - t) + bot[i] * t) for i in range(3))
        draw.line([(0, y), (w, y)], fill=col)

    # Lunes / orbes
    for _ in range(6):
        cx, cy = rng.randint(0, w), rng.randint(0, h // 2)
        r = rng.randint(20, 90)
        c = (255, 240, rng.randint(180, 230), 90)
        overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        od = ImageDraw.Draw(overlay)
        od.ellipse([cx - r, cy - r, cx + r, cy + r], fill=c)
        img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")

    # Collines
    draw = ImageDraw.Draw(img)
    for i in range(3):
        y0 = int(h * (0.55 + i * 0.12))
        pts = [(0, h), (0, y0)]
        x = 0
        while x <= w:
            pts.append((x, y0 + rng.randint(-40, 40)))
            x += rng.randint(80, 160)
        pts += [(w, y0), (w, h)]
        green = (rng.randint(30, 70), rng.randint(90, 140), rng.randint(60, 100))
        draw.polygon(pts, fill=green)

    img = img.filter(ImageFilter.GaussianBlur(radius=0.8))
    snippet = " ".join(prompt.split()[:8])
    try:
        font = ImageFont.truetype("arial.ttf", 28)
    except Exception:
        font = ImageFont.load_default()
    # Pas de texte visible (règle kids) — juste texture
    _ = (snippet, font)
    img.save(dest, format="PNG", optimize=True)


def describe_backend() -> dict[str, Any]:
    return {
        "backend": IMAGE_BACKEND,
        "order": _backends_order(),
        "size": f"{IMAGE_WIDTH}x{IMAGE_HEIGHT}",
        "model": POLLINATIONS_MODEL,
    }
