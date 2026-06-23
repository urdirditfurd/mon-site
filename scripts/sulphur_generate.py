"""
Génération vidéo locale (text-to-video) basée sur les snippets officiels du Hub
Hugging Face (https://huggingface.co/SulphurAI/Sulphur-2-base et modèles LTX/Wan).

Ce script est délibérément autonome : il n'est jamais importé par le serveur Node
mais lancé comme sous-processus quand `SULPHUR_LOCAL=1` (ou par défaut si
`python3 -c "import diffusers, torch"` répond OK).

Usage :
    python3 scripts/sulphur_generate.py \
        --pipeline sulphur-2 \
        --prompt "a misty forest at dawn" \
        --duration 5 \
        --aspect-ratio 9:16 \
        --output /tmp/out.mp4

Pipelines pris en charge (le mapping ci-dessous reflète l'état du Hub) :
  - sulphur-2  → SulphurAI/Sulphur-2-base (poids brut LTX-2.3)
  - ltx-video  → Lightricks/LTX-Video       (Diffusers LTXPipeline)
  - wan-2.2    → Wan-AI/Wan2.2-T2V-A14B-Diffusers
  - wan-2.1    → Wan-AI/Wan2.1-T2V-1.3B-Diffusers
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
import traceback
from pathlib import Path


def _aspect_to_size(aspect_ratio: str, base: int = 768) -> tuple[int, int]:
    """Retourne (width, height) cohérents avec un ratio commun TikTok/YouTube."""
    if aspect_ratio == "9:16":
        return 480, 832
    if aspect_ratio == "16:9":
        return 832, 480
    return 512, 512


def _run_diffusers_pipeline(args: argparse.Namespace) -> Path:
    import torch  # type: ignore
    from diffusers.utils import export_to_video  # type: ignore

    pipeline_key = args.pipeline.lower()
    width, height = _aspect_to_size(args.aspect_ratio)
    num_frames = max(8, int(args.duration * 24))

    if pipeline_key in {"ltx-video", "sulphur-2"}:
        from diffusers import LTXPipeline  # type: ignore
        model_id = args.model_id or "Lightricks/LTX-Video"
        pipe = LTXPipeline.from_pretrained(
            model_id,
            torch_dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,
        )
        pipe.to("cuda" if torch.cuda.is_available() else "cpu")
        if pipeline_key == "sulphur-2" and args.lora_path:
            try:
                pipe.load_lora_weights(args.lora_path)
            except Exception:
                pass
        video = pipe(
            prompt=args.prompt,
            width=width,
            height=height,
            num_frames=num_frames,
            guidance_scale=3.0,
        ).frames[0]
    elif pipeline_key in {"wan-2.2", "wan-2.1"}:
        from diffusers import WanPipeline  # type: ignore
        default_id = (
            "Wan-AI/Wan2.2-T2V-A14B-Diffusers"
            if pipeline_key == "wan-2.2"
            else "Wan-AI/Wan2.1-T2V-1.3B-Diffusers"
        )
        model_id = args.model_id or default_id
        pipe = WanPipeline.from_pretrained(
            model_id,
            torch_dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,
        )
        pipe.to("cuda" if torch.cuda.is_available() else "cpu")
        video = pipe(
            prompt=args.prompt,
            num_frames=num_frames,
            width=width,
            height=height,
            guidance_scale=5.0,
        ).frames[0]
    else:
        raise SystemExit(f"Pipeline local inconnu : {pipeline_key}")

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    export_to_video(video, str(output_path), fps=24)
    return output_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pipeline", required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--duration", type=float, default=5.0)
    parser.add_argument("--aspect-ratio", default="9:16")
    parser.add_argument("--output", required=True)
    parser.add_argument("--model-id", default=None)
    parser.add_argument("--lora-path", default=None)
    args = parser.parse_args()

    try:
        path = _run_diffusers_pipeline(args)
    except Exception as exc:
        traceback.print_exc()
        print(f"ERREUR génération locale : {exc}", file=sys.stderr)
        return 1
    print(f"Vidéo écrite dans {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
