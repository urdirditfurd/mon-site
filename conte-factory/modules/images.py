"""Étape 4 — Images par scène (demo local / Pollinations gratuit / OpenAI)."""

from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
from typing import Any
from urllib.parse import quote

import requests
from PIL import Image, ImageDraw, ImageFont

from config import IMAGE_MODE, OPENAI_API_KEY, VIDEO_HEIGHT, VIDEO_WIDTH
from db.database import get_video, log_event, update_video

PALETTE = [
    ((255, 214, 165), (120, 180, 140)),
    ((186, 230, 253), (147, 197, 253)),
    ((254, 215, 226), (244, 163, 176)),
    ((220, 252, 231), (134, 239, 172)),
    ((254, 243, 199), (253, 224, 71)),
    ((233, 213, 255), (196, 181, 253)),
]


def _demo_image(prompt: str, out_path: Path, index: int) -> None:
    w, h = VIDEO_WIDTH, VIDEO_HEIGHT
    bg, accent = PALETTE[index % len(PALETTE)]
    img = Image.new("RGB", (w, h), bg)
    draw = ImageDraw.Draw(img)

    # Ciel / sol
    draw.rectangle([0, int(h * 0.62), w, h], fill=accent)

    # Soleil / lune
    cx, cy, r = int(w * 0.82), int(h * 0.18), 90
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 248, 220))

    # Arbres simplifiés
    for i, x in enumerate(range(120, w - 100, 280)):
        trunk_x = x + 40
        draw.rectangle([trunk_x, int(h * 0.45), trunk_x + 28, int(h * 0.72)], fill=(120, 80, 50))
        rr = 70 + (i % 3) * 15
        draw.ellipse(
            [x, int(h * 0.32) - rr // 2, x + 120, int(h * 0.32) + rr],
            fill=(70 + (i * 17) % 80, 140, 90),
        )

    # Petit personnage (cercle + oreilles)
    px, py = int(w * 0.35), int(h * 0.58)
    draw.ellipse([px - 55, py - 55, px + 55, py + 55], fill=(255, 250, 240))
    draw.ellipse([px - 70, py - 90, px - 30, py - 45], fill=(255, 250, 240))
    draw.ellipse([px + 30, py - 90, px + 70, py - 45], fill=(255, 250, 240))
    draw.ellipse([px - 18, py - 10, px - 4, py + 4], fill=(40, 40, 40))
    draw.ellipse([px + 4, py - 10, px + 18, py + 4], fill=(40, 40, 40))

    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 36)
        small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 22)
    except OSError:
        font = ImageFont.load_default()
        small = font

    title = f"Scène {index + 1}"
    draw.text((48, 40), title, fill=(40, 50, 60), font=font)
    snippet = (prompt[:90] + "…") if len(prompt) > 90 else prompt
    draw.text((48, 90), snippet, fill=(60, 70, 80), font=small)

    img.save(out_path, quality=92)


def _pollinations_image(prompt: str, out_path: Path) -> None:
    seed = int(hashlib.md5(prompt.encode()).hexdigest()[:8], 16) % 10_000_000
    url = (
        "https://image.pollinations.ai/prompt/"
        + quote(prompt[:400])
        + f"?width={VIDEO_WIDTH}&height={VIDEO_HEIGHT}&seed={seed}&nologo=true"
    )
    resp = requests.get(url, timeout=120)
    resp.raise_for_status()
    Image.open(io.BytesIO(resp.content)).convert("RGB").save(out_path, quality=92)


def _openai_image(prompt: str, out_path: Path) -> None:
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY manquant")
    resp = requests.post(
        "https://api.openai.com/v1/images/generations",
        headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
        json={
            "model": "dall-e-3",
            "prompt": prompt[:1000],
            "size": "1792x1024",
            "quality": "standard",
            "n": 1,
        },
        timeout=180,
    )
    resp.raise_for_status()
    image_url = resp.json()["data"][0]["url"]
    img = requests.get(image_url, timeout=120)
    img.raise_for_status()
    Image.open(io.BytesIO(img.content)).convert("RGB").resize((VIDEO_WIDTH, VIDEO_HEIGHT)).save(
        out_path, quality=92
    )


def _make_image(prompt: str, out_path: Path, index: int, mode: str) -> None:
    if mode == "openai":
        try:
            _openai_image(prompt, out_path)
            return
        except Exception:
            _demo_image(prompt, out_path, index)
            return
    if mode == "pollinations":
        try:
            _pollinations_image(prompt, out_path)
            return
        except Exception:
            _demo_image(prompt, out_path, index)
            return
    _demo_image(prompt, out_path, index)


def generate_images(video_id: int, mode: str | None = None) -> dict[str, Any]:
    video = get_video(video_id)
    if not video:
        raise ValueError(f"Vidéo introuvable: {video_id}")
    projet = Path(video["chemin_projet"])
    board_path = projet / "storyboard.json"
    board = json.loads(board_path.read_text(encoding="utf-8"))
    images_dir = projet / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    mode = (mode or IMAGE_MODE).lower()
    generated = []
    for scene in board["scenes"]:
        idx = int(scene["index"]) - 1
        out = images_dir / f"scene_{scene['index']:03d}.jpg"
        if not out.exists():
            _make_image(scene["visual_prompt"], out, idx, mode)
        scene["image_file"] = out.name
        generated.append(out.name)

    board_path.write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
    update_video(video_id, statut="images_ok")
    log_event(video_id, "info", f"Images prêtes ({mode}) : {len(generated)}.")
    return {"ok": True, "count": len(generated), "mode": mode, "dir": str(images_dir)}
