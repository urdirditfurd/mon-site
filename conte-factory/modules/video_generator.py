"""Génération de clips vidéo via Wan Gradio (/generate) ou wan_engine.

Compatible dashboard Qwen + pipeline Cursor.
Corrige l'erreur: Cannot find a function with api_name: /predict
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any, Callable

from config import (
    PINOKIO_WAN_FRAMES,
    PINOKIO_WAN_RESOLUTION,
    PINOKIO_WAN_STEPS,
    PINOKIO_WAN_URL,
    ROOT,
)
from modules.video_ai import (
    _generate_one_pinokio_clip,
    pinokio_wan_health,
)


class VideoGenerator:
    def __init__(self, wan_url: str | None = None) -> None:
        self.wan_url = (wan_url or PINOKIO_WAN_URL).rstrip("/")
        self.root = ROOT

    def check_wan_status(self) -> bool:
        health = pinokio_wan_health(deep=False)
        return bool(health.get("gradio_up") or health.get("ready_for_pipeline"))

    def generate_clip(self, prompt: str, output_path: str | Path) -> Path:
        dest = Path(output_path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        return _generate_one_pinokio_clip(prompt, dest)

    def generate_all_clips(
        self,
        storyboard_path: str | Path,
        video_id: int,
        max_scenes: int | None = None,
        progress_callback: Callable[[int, int, str], None] | None = None,
    ) -> dict[str, Any]:
        path = Path(storyboard_path)
        if not path.is_absolute():
            path = (self.root / path).resolve()
        if not path.exists():
            raise FileNotFoundError(f"Storyboard introuvable: {path}")

        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or "scenes" not in data:
            raise ValueError(
                "storyboard.json invalide (attendu un objet avec 'scenes'). "
                "Reconstruis le storyboard + audio avant de générer les clips."
            )

        scenes = list(data.get("scenes") or [])
        if max_scenes is not None:
            scenes = scenes[: max(1, int(max_scenes))]

        clips_dir = path.parent / "ai_clips"
        clips_dir.mkdir(parents=True, exist_ok=True)

        success = 0
        failed = 0
        errors: list[str] = []
        total = len(scenes)

        for i, scene in enumerate(scenes, start=1):
            numero = int(scene.get("numero") or scene.get("index") or i)
            prompt = (
                scene.get("prompt_visuel")
                or scene.get("visual_prompt")
                or scene.get("prompt")
                or ""
            ).strip()
            if not prompt:
                prompt = f"children storybook animation, scene {numero}"

            out = clips_dir / f"scene_{numero:03d}.mp4"
            msg = f"Generation scene {numero}/{total}..."
            print(f"🎬 {msg}")
            if progress_callback:
                progress_callback(i - 1, total, msg)

            try:
                self.generate_clip(prompt, out)
                # Chemins absolus pour FFmpeg / montage
                abs_out = str(out.resolve())
                scene["video_path"] = abs_out
                scene["ai_clip_files"] = [out.name]
                # Mettre à jour aussi dans data["scenes"] (même objet ou copie)
                for full in data["scenes"]:
                    n = int(full.get("numero") or full.get("index") or 0)
                    if n == numero:
                        full["video_path"] = abs_out
                        full["ai_clip_files"] = [out.name]
                        break
                success += 1
                print(f"✅ Scene {numero}: {abs_out}")
            except Exception as exc:
                failed += 1
                err = f"Scene {numero}: {exc}"
                errors.append(err)
                print(f"❌ {err}")

            if progress_callback:
                progress_callback(i, total, f"Scene {numero} terminee")

        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return {
            "success": success,
            "failed": failed,
            "total": total,
            "errors": errors,
            "storyboard": str(path),
            "resolution": PINOKIO_WAN_RESOLUTION,
            "frames": PINOKIO_WAN_FRAMES,
            "steps": PINOKIO_WAN_STEPS,
            "wan_url": self.wan_url,
        }
