"""
Moteur Wan 2.1 pour Snapdragon X Elite / Windows ARM64 — sans NVIDIA.
Utilise PyTorch CPU + diffusers (WanPipeline).
"""

from __future__ import annotations

import json
import os
import platform
import traceback
from pathlib import Path

import torch

DEFAULT_NEGATIVE = (
    "worst quality, inconsistent motion, blurry, static, text overlay, watermark, logo, "
    "ugly, deformed, extra limbs, low quality, jpeg artifacts"
)

MODEL_ID = "Wan-AI/Wan2.1-T2V-1.3B-Diffusers"

RESOLUTION_PRESETS = {
    "480p 16:9": (832, 480),
    "480p 9:16": (480, 832),
    "480p 1:1": (480, 480),
}


def platform_profile() -> dict:
    machine = platform.machine().lower()
    system = platform.system().lower()
    is_arm = machine in ("aarch64", "arm64")
    return {
        "machine": machine,
        "system": system,
        "arm64": is_arm,
        "snapdragon": is_arm and system == "windows",
        "processor": platform.processor() or "",
    }


def hf_token() -> str | None:
    return os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")


def pick_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def device_label(device: str) -> str:
    if device == "cuda":
        return "cuda"
    if device == "mps":
        return "mps"
    if platform_profile()["snapdragon"]:
        return "snapdragon-cpu"
    return "cpu"


_PIPE = None


def get_pipe(cache_dir: str | None, device: str):
    global _PIPE
    if _PIPE is not None:
        return _PIPE

    from diffusers import AutoencoderKLWan, UniPCMultistepScheduler, WanPipeline

    dtype = torch.bfloat16 if device != "cpu" else torch.float32
    vae = AutoencoderKLWan.from_pretrained(
        MODEL_ID,
        subfolder="vae",
        torch_dtype=torch.float32,
        cache_dir=cache_dir,
        token=hf_token(),
    )
    pipe = WanPipeline.from_pretrained(
        MODEL_ID,
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

    _PIPE = pipe
    return _PIPE


def generate_video(
    *,
    prompt: str,
    output_path: str,
    resolution_key: str = "480p 16:9",
    num_frames: int = 49,
    fps: int = 16,
    steps: int = 24,
    guidance: float = 6.0,
    negative_prompt: str = DEFAULT_NEGATIVE,
    cache_dir: str | None = None,
    seed: int | None = None,
    progress_callback=None,
) -> dict:
    device = pick_device()
    width, height = RESOLUTION_PRESETS.get(resolution_key, RESOLUTION_PRESETS["480p 16:9"])

    if platform_profile()["snapdragon"]:
        num_frames = min(num_frames, 49)
        steps = min(steps, 24)

    if progress_callback:
        progress_callback(0.05, "Chargement du modèle Wan 2.1 1.3B…")

    pipe = get_pipe(cache_dir, device)
    generator = None
    if seed is not None:
        generator = torch.Generator(device="cpu").manual_seed(seed)

    if progress_callback:
        progress_callback(0.15, f"Génération sur {device_label(device)} (patience sur Snapdragon)…")

    kwargs = {
        "prompt": prompt,
        "negative_prompt": negative_prompt or DEFAULT_NEGATIVE,
        "width": width,
        "height": height,
        "num_frames": num_frames,
        "num_inference_steps": steps,
        "guidance_scale": guidance,
    }
    if generator is not None:
        kwargs["generator"] = generator

    result = pipe(**kwargs)
    frames = result.frames[0]

    if progress_callback:
        progress_callback(0.9, "Export MP4…")

    from diffusers.utils import export_to_video

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    export_to_video(frames, str(out), fps=fps)

    if progress_callback:
        progress_callback(1.0, "Terminé.")

    return {
        "ok": True,
        "outputPath": str(out.resolve()),
        "device": device_label(device),
        "width": width,
        "height": height,
        "numFrames": num_frames,
        "fps": fps,
        "model": MODEL_ID,
    }


def check_environment() -> dict:
    profile = platform_profile()
    device = pick_device()
    info = {
        "ok": True,
        "device": device_label(device),
        "cuda": torch.cuda.is_available(),
        "snapdragon": profile["snapdragon"],
        "arm64": profile["arm64"],
        "torch": torch.__version__,
        "model": MODEL_ID,
        "hfToken": bool(hf_token()),
        "platform": profile,
    }
    try:
        import diffusers

        info["diffusers"] = diffusers.__version__
    except Exception as exc:
        info["diffusers"] = None
        info["diffusersError"] = str(exc)
    return info


def format_check_message() -> str:
    info = check_environment()
    lines = [
        f"PyTorch: {info['torch']}",
        f"Appareil: {info['device']}",
        f"Snapdragon ARM64: {'oui' if info['snapdragon'] else 'non'}",
        f"CUDA: {'oui' if info['cuda'] else 'non (normal sur Surface)'}",
        f"Modèle: Wan 2.1 T2V 1.3B",
        f"Token Hugging Face: {'configuré' if info['hfToken'] else 'optionnel'}",
    ]
    if info.get("diffusers"):
        lines.append(f"Diffusers: {info['diffusers']}")
    return "\n".join(lines)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check")
    gen = sub.add_parser("generate")
    gen.add_argument("--prompt", required=True)
    gen.add_argument("--output", required=True)
    gen.add_argument("--resolution", default="480p 16:9")
    gen.add_argument("--frames", type=int, default=49)
    gen.add_argument("--fps", type=int, default=16)
    gen.add_argument("--seed", type=int, default=None)
    args = parser.parse_args()

    if args.cmd == "check":
        print(json.dumps(check_environment(), indent=2))
    else:
        try:
            print(json.dumps(generate_video(
                prompt=args.prompt,
                output_path=args.output,
                resolution_key=args.resolution,
                num_frames=args.frames,
                fps=args.fps,
                seed=args.seed,
            ), indent=2))
        except Exception as exc:
            print(json.dumps({"ok": False, "error": str(exc), "trace": traceback.format_exc()}))
            raise SystemExit(1) from exc
