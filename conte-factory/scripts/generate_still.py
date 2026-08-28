"""Génère une image SDXL-Turbo locale (venv Wan / CUDA)."""

from __future__ import annotations

import argparse
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    parser.add_argument("--cache", type=str, default="")
    parser.add_argument("--steps", type=int, default=4)
    args = parser.parse_args()

    import torch
    from diffusers import AutoPipelineForText2Image

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32
    model_id = "stabilityai/sdxl-turbo"

    pipe = AutoPipelineForText2Image.from_pretrained(
        model_id,
        torch_dtype=dtype,
        variant="fp16" if device == "cuda" else None,
        cache_dir=args.cache or None,
    )
    if device == "cuda":
        pipe.to(device)
        try:
            pipe.enable_attention_slicing()
        except Exception:
            pass
    else:
        pipe.to(device)

    # SDXL-Turbo: guidance_scale=0.0 recommandé
    result = pipe(
        prompt=args.prompt,
        num_inference_steps=max(1, min(8, args.steps)),
        guidance_scale=0.0,
        width=(args.width // 8) * 8,
        height=(args.height // 8) * 8,
    )
    image = result.images[0]
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    image.save(out)
    print(f"OK {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
