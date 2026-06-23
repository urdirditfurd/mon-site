#!/usr/bin/env python3
"""Generate text-to-video clips with Hugging Face Diffusers.

Default model is Wan-AI/Wan2.1-T2V-1.3B-Diffusers because it is one of the
most downloaded open text-to-video models and runs on consumer GPUs.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
from typing import Tuple

import torch
from diffusers import AutoencoderKLWan, WanPipeline
from diffusers.utils import export_to_video


DEFAULT_MODEL_ID = os.getenv("HF_TEXT_TO_VIDEO_MODEL", "Wan-AI/Wan2.1-T2V-1.3B-Diffusers")
DEFAULT_NEGATIVE_PROMPT = (
    "low quality, blurry, watermark, logo, text overlay, subtitle, extra fingers, "
    "deformed face, static frame, low detail"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a video clip from text.")
    parser.add_argument("--prompt", required=True, help="Positive prompt.")
    parser.add_argument("--output", required=True, help="Output mp4 path.")
    parser.add_argument("--model-id", default=DEFAULT_MODEL_ID, help="HF model id.")
    parser.add_argument("--negative-prompt", default=DEFAULT_NEGATIVE_PROMPT, help="Negative prompt.")
    parser.add_argument("--height", type=int, default=480, help="Output height in pixels.")
    parser.add_argument("--width", type=int, default=832, help="Output width in pixels.")
    parser.add_argument("--duration-sec", type=float, default=5.0, help="Target clip duration.")
    parser.add_argument("--fps", type=int, default=15, help="Output FPS.")
    parser.add_argument("--guidance-scale", type=float, default=5.0, help="Guidance scale.")
    parser.add_argument("--num-inference-steps", type=int, default=30, help="Sampling steps.")
    parser.add_argument("--seed", type=int, default=-1, help="Seed (-1 for random).")
    parser.add_argument("--device", default="auto", help="'auto', 'cuda', or 'cpu'.")
    parser.add_argument(
        "--enable-cpu-offload",
        action="store_true",
        help="Enable sequential CPU offload instead of loading fully on GPU.",
    )
    return parser.parse_args()


def resolve_device(device_arg: str) -> str:
    if device_arg and device_arg != "auto":
        return device_arg
    return "cuda" if torch.cuda.is_available() else "cpu"


def resolve_dtype(device: str) -> torch.dtype:
    if device == "cuda":
        return torch.bfloat16
    return torch.float32


def normalize_frames(duration_sec: float, fps: int) -> int:
    # Wan performs best with frame counts shaped as (4n + 1).
    raw_frames = max(9, int(math.ceil(duration_sec * fps)))
    n = max(2, round((raw_frames - 1) / 4))
    return n * 4 + 1


def normalize_size(width: int, height: int) -> Tuple[int, int]:
    # Keep dimensions divisible by 16 for stable video latent grids.
    norm_w = max(320, int(round(width / 16) * 16))
    norm_h = max(320, int(round(height / 16) * 16))
    return norm_w, norm_h


def main() -> None:
    args = parse_args()
    output_path = Path(args.output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    device = resolve_device(args.device)
    dtype = resolve_dtype(device)
    num_frames = normalize_frames(args.duration_sec, args.fps)
    width, height = normalize_size(args.width, args.height)

    vae_dtype = torch.float32 if device == "cuda" else torch.float32
    vae = AutoencoderKLWan.from_pretrained(args.model_id, subfolder="vae", torch_dtype=vae_dtype)
    pipe = WanPipeline.from_pretrained(args.model_id, vae=vae, torch_dtype=dtype)

    if device == "cuda":
        if args.enable_cpu_offload:
            pipe.enable_model_cpu_offload()
        else:
            pipe.to("cuda")
    else:
        pipe.to("cpu")

    generator = None
    resolved_seed = args.seed
    if args.seed is not None and args.seed >= 0:
        generator = torch.Generator(device="cpu").manual_seed(args.seed)
    else:
        resolved_seed = int(torch.randint(0, 2**31 - 1, (1,)).item())
        generator = torch.Generator(device="cpu").manual_seed(resolved_seed)

    result = pipe(
        prompt=args.prompt,
        negative_prompt=args.negative_prompt,
        height=height,
        width=width,
        num_frames=num_frames,
        guidance_scale=args.guidance_scale,
        num_inference_steps=args.num_inference_steps,
        generator=generator,
    )
    frames = result.frames[0]
    export_to_video(frames, str(output_path), fps=args.fps)

    payload = {
        "ok": True,
        "output": str(output_path),
        "modelId": args.model_id,
        "device": device,
        "dtype": str(dtype).replace("torch.", ""),
        "numFrames": num_frames,
        "fps": args.fps,
        "seed": resolved_seed,
        "width": width,
        "height": height,
    }
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
