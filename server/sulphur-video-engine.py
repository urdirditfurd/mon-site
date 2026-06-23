#!/usr/bin/env python3
"""
Moteur text-to-video local pour Sulphur Studio.
Modèles supportés :
  - SulphurAI/Sulphur-2-base (LTXPipeline.from_single_file)
  - Wan-AI/Wan2.2-TI2V-5B-Diffusers (WanPipeline)
  - Wan-AI/Wan2.1-T2V-1.3B-Diffusers (WanPipeline)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from pathlib import Path

import torch

DEFAULT_NEGATIVE = (
    "worst quality, inconsistent motion, blurry, static, text overlay, watermark, logo, "
    "ugly, deformed, extra limbs, low quality, jpeg artifacts"
)

MODEL_PRESETS = {
    "sulphur2": {
        "repo": "SulphurAI/Sulphur-2-base",
        "engine": "ltx-single-file",
        "weight": "sulphur_dev_bf16.safetensors",
        "steps": 30,
        "guidance": 4.0,
    },
    "sulphur2-distilled": {
        "repo": "SulphurAI/Sulphur-2-base",
        "engine": "ltx-single-file",
        "weight": "sulphur_distil_bf16.safetensors",
        "steps": 8,
        "guidance": 1.0,
    },
    "wan22": {
        "repo": "Wan-AI/Wan2.2-TI2V-5B-Diffusers",
        "engine": "wan-diffusers",
        "steps": 30,
        "guidance": 5.0,
    },
    "wan21lite": {
        "repo": "Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
        "engine": "wan-diffusers",
        "steps": 40,
        "guidance": 6.0,
    },
}


def pick_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def hf_token() -> str | None:
    return os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")


def resolve_model_path(repo: str, filename: str, cache_dir: str | None) -> str:
    from huggingface_hub import hf_hub_download

    return hf_hub_download(
        repo_id=repo,
        filename=filename,
        cache_dir=cache_dir,
        token=hf_token(),
    )


def load_ltx_pipe(preset: dict, cache_dir: str | None, device: str):
    from diffusers import LTXPipeline

    weight_path = resolve_model_path(preset["repo"], preset["weight"], cache_dir)
    dtype = torch.bfloat16 if device != "cpu" else torch.float32
    pipe = LTXPipeline.from_single_file(weight_path, torch_dtype=dtype)

    if device == "cpu":
        pipe.enable_model_cpu_offload()
    else:
        pipe = pipe.to(device)
        if os.environ.get("SULPHUR_CPU_OFFLOAD", "").lower() in ("1", "true", "yes"):
            pipe.enable_model_cpu_offload(device=device)

    pipe.enable_vae_slicing()
    return pipe


def load_wan_pipe(preset: dict, cache_dir: str | None, device: str):
    from diffusers import AutoencoderKLWan, UniPCMultistepScheduler, WanPipeline

    model_id = preset["repo"]
    dtype = torch.bfloat16 if device != "cpu" else torch.float32
    vae = AutoencoderKLWan.from_pretrained(
        model_id,
        subfolder="vae",
        torch_dtype=torch.float32,
        cache_dir=cache_dir,
        token=hf_token(),
    )
    pipe = WanPipeline.from_pretrained(
        model_id,
        vae=vae,
        torch_dtype=dtype,
        cache_dir=cache_dir,
        token=hf_token(),
    )
    pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config)

    if device == "cpu":
        pipe.enable_model_cpu_offload()
    else:
        pipe = pipe.to(device)
        if os.environ.get("SULPHUR_CPU_OFFLOAD", "").lower() in ("1", "true", "yes"):
            pipe.enable_model_cpu_offload(device=device)

    return pipe


_PIPE_CACHE: dict[str, object] = {}


def get_pipe(model_key: str, cache_dir: str | None, device: str):
    cache_key = f"{model_key}:{device}:{cache_dir or 'default'}"
    if cache_key in _PIPE_CACHE:
        return _PIPE_CACHE[cache_key], MODEL_PRESETS[model_key]

    preset = MODEL_PRESETS.get(model_key)
    if not preset:
        raise ValueError(f"Modèle inconnu: {model_key}. Choix: {', '.join(MODEL_PRESETS)}")

    if preset["engine"] == "ltx-single-file":
        pipe = load_ltx_pipe(preset, cache_dir, device)
    elif preset["engine"] == "wan-diffusers":
        pipe = load_wan_pipe(preset, cache_dir, device)
    else:
        raise ValueError(f"Moteur inconnu: {preset['engine']}")

    _PIPE_CACHE[cache_key] = pipe
    return pipe, preset


def generate_clip(
    *,
    model_key: str,
    prompt: str,
    output_path: str,
    width: int,
    height: int,
    num_frames: int,
    fps: int,
    negative_prompt: str,
    cache_dir: str | None,
    seed: int | None,
) -> dict:
    device = pick_device()
    if device == "cpu" and os.environ.get("SULPHUR_ALLOW_CPU", "").lower() not in ("1", "true", "yes"):
        raise RuntimeError(
            "Aucun GPU détecté. Installez CUDA ou définissez SULPHUR_ALLOW_CPU=1 (très lent)."
        )

    pipe, preset = get_pipe(model_key, cache_dir, device)
    generator = None
    if seed is not None:
        generator = torch.Generator(device=device if device != "mps" else "cpu").manual_seed(seed)

    kwargs = {
        "prompt": prompt,
        "negative_prompt": negative_prompt or DEFAULT_NEGATIVE,
        "width": width,
        "height": height,
        "num_frames": num_frames,
        "num_inference_steps": preset.get("steps", 30),
        "guidance_scale": preset.get("guidance", 4.0),
    }
    if generator is not None:
        kwargs["generator"] = generator

    result = pipe(**kwargs)
    frames = result.frames[0]

    from diffusers.utils import export_to_video

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    export_to_video(frames, str(out), fps=fps)

    return {
        "ok": True,
        "outputPath": str(out.resolve()),
        "model": model_key,
        "device": device,
        "width": width,
        "height": height,
        "numFrames": num_frames,
        "fps": fps,
    }


def cmd_generate(args: argparse.Namespace) -> int:
    result = generate_clip(
        model_key=args.model,
        prompt=args.prompt,
        output_path=args.output,
        width=args.width,
        height=args.height,
        num_frames=args.frames,
        fps=args.fps,
        negative_prompt=args.negative_prompt or DEFAULT_NEGATIVE,
        cache_dir=args.cache_dir,
        seed=args.seed,
    )
    print(json.dumps(result))
    return 0


def cmd_check(_args: argparse.Namespace) -> int:
    device = pick_device()
    info = {
        "ok": True,
        "device": device,
        "cuda": torch.cuda.is_available(),
        "cudaDevices": torch.cuda.device_count() if torch.cuda.is_available() else 0,
        "models": list(MODEL_PRESETS.keys()),
        "hfToken": bool(hf_token()),
        "torch": torch.__version__,
    }
    try:
        import diffusers

        info["diffusers"] = diffusers.__version__
    except Exception as exc:
        info["diffusers"] = None
        info["diffusersError"] = str(exc)

    print(json.dumps(info))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Sulphur Studio — moteur text-to-video HF")
    sub = parser.add_subparsers(dest="command", required=True)

    gen = sub.add_parser("generate", help="Générer un clip MP4")
    gen.add_argument("--model", default="sulphur2", choices=list(MODEL_PRESETS.keys()))
    gen.add_argument("--prompt", required=True)
    gen.add_argument("--output", required=True)
    gen.add_argument("--width", type=int, default=1280)
    gen.add_argument("--height", type=int, default=704)
    gen.add_argument("--frames", type=int, default=121)
    gen.add_argument("--fps", type=int, default=24)
    gen.add_argument("--negative-prompt", default=DEFAULT_NEGATIVE)
    gen.add_argument("--cache-dir", default=os.environ.get("SULPHUR_MODEL_CACHE", ""))
    gen.add_argument("--seed", type=int, default=None)
    gen.set_defaults(func=cmd_generate)

    chk = sub.add_parser("check", help="Vérifier l'environnement GPU/Python")
    chk.set_defaults(func=cmd_check)

    return parser


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == "--stdin-json":
        payload = json.load(sys.stdin)
        try:
            result = generate_clip(
                model_key=payload.get("model", "sulphur2"),
                prompt=payload["prompt"],
                output_path=payload["output"],
                width=int(payload.get("width", 1280)),
                height=int(payload.get("height", 704)),
                num_frames=int(payload.get("frames", 121)),
                fps=int(payload.get("fps", 24)),
                negative_prompt=payload.get("negativePrompt", DEFAULT_NEGATIVE),
                cache_dir=payload.get("cacheDir") or os.environ.get("SULPHUR_MODEL_CACHE"),
                seed=payload.get("seed"),
            )
            print(json.dumps(result))
            return 0
        except Exception as exc:
            print(json.dumps({"ok": False, "error": str(exc), "trace": traceback.format_exc()}))
            return 1

    parser = build_parser()
    args = parser.parse_args()
    if args.cache_dir == "":
        args.cache_dir = None
    try:
        return args.func(args)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc), "trace": traceback.format_exc()}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
