"""
Moteur Wan 2.1 — NVIDIA CUDA (prioritaire) ou CPU/Snapdragon.
"""

from __future__ import annotations

import json
import os
import platform
import time
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
    processor = platform.processor() or ""
    # Pinokio utilise souvent Python x64 émulé sur Surface ARM : machine() = amd64
    # mais le processeur contient toujours "Qualcomm".
    qualcomm = "qualcomm" in processor.lower()
    snapdragon = (is_arm and system == "windows") or (
        system == "windows" and qualcomm
    )
    return {
        "machine": machine,
        "system": system,
        "arm64": is_arm,
        "qualcomm": qualcomm,
        "snapdragon": snapdragon,
        "processor": processor,
    }


def is_snapdragon_pc() -> bool:
    if os.environ.get("SULPHUR_SNAPDRAGON", "").lower() in ("1", "true", "yes"):
        return True
    return platform_profile()["snapdragon"]


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
    if is_snapdragon_pc():
        return "snapdragon-cpu"
    return "cpu"


_PIPE = None
_PIPE_META: dict | None = None


def _cuda_dtype() -> torch.dtype:
    """RTX 30xx : float16 >> bfloat16 (BF16 peut être 10–50× plus lent)."""
    override = (os.environ.get("WAN_DTYPE") or "").strip().lower()
    if override in ("float16", "fp16", "half"):
        return torch.float16
    if override in ("bfloat16", "bf16"):
        return torch.bfloat16
    if override in ("float32", "fp32"):
        return torch.float32
    if not torch.cuda.is_available():
        return torch.float32
    return torch.float16


def _tune_cuda() -> None:
    if not torch.cuda.is_available():
        return
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    torch.backends.cudnn.benchmark = True
    try:
        torch.set_float32_matmul_precision("high")
    except Exception:
        pass


def get_pipe(cache_dir: str | None, device: str):
    global _PIPE, _PIPE_META
    if _PIPE is not None:
        return _PIPE

    from diffusers import AutoencoderKLWan, UniPCMultistepScheduler, WanPipeline

    _tune_cuda()
    dtype = _cuda_dtype() if device == "cuda" else torch.float32
    print(
        f"[wan_engine] device={device} dtype={dtype} "
        f"cuda={torch.cuda.is_available()} "
        f"gpu={torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'n/a'}",
        flush=True,
    )

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
    pipe.scheduler = UniPCMultistepScheduler.from_config(
        pipe.scheduler.config,
        flow_shift=3.0,
    )

    if device == "cpu":
        # Sur CPU pur (Surface Snapdragon) : pas de cpu_offload (bug diffusers 0.38+)
        pipe.to("cpu")
        if hasattr(pipe, "enable_attention_slicing"):
            pipe.enable_attention_slicing("max")
    else:
        pipe = pipe.to(device)
        if os.environ.get("SULPHUR_CPU_OFFLOAD", "").lower() in ("1", "true", "yes"):
            pipe.enable_model_cpu_offload()
        if hasattr(pipe, "enable_vae_tiling"):
            try:
                pipe.enable_vae_tiling()
            except Exception:
                pass

    _PIPE = pipe
    _PIPE_META = {"device": device, "dtype": str(dtype).replace("torch.", "")}
    return _PIPE


def generate_video(
    *,
    prompt: str,
    output_path: str,
    resolution_key: str = "480p 16:9",
    num_frames: int = 17,
    fps: int = 16,
    steps: int = 12,
    guidance: float = 5.0,
    negative_prompt: str = DEFAULT_NEGATIVE,
    cache_dir: str | None = None,
    seed: int | None = None,
    progress_callback=None,
) -> dict:
    device = pick_device()
    width, height = RESOLUTION_PRESETS.get(resolution_key, RESOLUTION_PRESETS["480p 16:9"])

    if is_snapdragon_pc() and device == "cpu":
        num_frames = min(num_frames, 33)
        steps = min(steps, 20)
    if num_frames % 4 != 1:
        num_frames = max(17, (num_frames // 4) * 4 + 1)

    if progress_callback:
        progress_callback(0.05, "Chargement du modèle Wan 2.1 1.3B…")

    pipe = get_pipe(cache_dir, device)
    generator = None
    if seed is not None:
        generator = torch.Generator(device="cpu").manual_seed(seed)

    dtype_label = (_PIPE_META or {}).get("dtype", "?")
    if progress_callback:
        progress_callback(
            0.15,
            f"Génération {device_label(device)}/{dtype_label} — {num_frames}f × {steps} steps…",
        )

    print(
        f"[wan_engine] generate start device={device_label(device)} dtype={dtype_label} "
        f"{width}x{height} frames={num_frames} steps={steps}",
        flush=True,
    )
    if device == "cuda":
        free, total = torch.cuda.mem_get_info(0)
        print(
            f"[wan_engine] VRAM free={free / 1e9:.1f}Go / total={total / 1e9:.1f}Go",
            flush=True,
        )

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

    t0 = time.perf_counter()
    with torch.inference_mode():
        result = pipe(**kwargs)
    frames = result.frames[0]
    elapsed = time.perf_counter() - t0
    per_step = elapsed / max(1, steps)
    print(
        f"[wan_engine] denoising done in {elapsed:.1f}s "
        f"({per_step:.1f}s/step) — cible <8s/step sur RTX 3080",
        flush=True,
    )

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
        "dtype": dtype_label,
        "width": width,
        "height": height,
        "numFrames": num_frames,
        "fps": fps,
        "steps": steps,
        "seconds": round(elapsed, 1),
        "secondsPerStep": round(per_step, 2),
        "model": MODEL_ID,
    }


def check_environment() -> dict:
    profile = platform_profile()
    device = pick_device()
    info = {
        "ok": True,
        "device": device_label(device),
        "cuda": torch.cuda.is_available(),
        "dtype": str(_cuda_dtype()).replace("torch.", "") if device == "cuda" else "float32",
        "snapdragon": is_snapdragon_pc(),
        "arm64": profile["arm64"],
        "torch": torch.__version__,
        "model": MODEL_ID,
        "hfToken": bool(hf_token()),
        "platform": profile,
    }
    if torch.cuda.is_available():
        try:
            info["gpu"] = torch.cuda.get_device_name(0)
        except Exception:
            info["gpu"] = None
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
        f"Dtype: {info.get('dtype', '?')}",
        f"Snapdragon ARM64: {'oui' if info['snapdragon'] else 'non'}",
        f"CUDA: {'oui' if info['cuda'] else 'non (normal sur Surface)'}",
        f"Modèle: Wan 2.1 T2V 1.3B",
        f"Token Hugging Face: {'configuré' if info['hfToken'] else 'optionnel'}",
    ]
    if info.get("gpu"):
        lines.insert(2, f"GPU: {info['gpu']}")
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
    gen.add_argument("--frames", type=int, default=17)
    gen.add_argument("--fps", type=int, default=16)
    gen.add_argument("--steps", type=int, default=12)
    gen.add_argument("--seed", type=int, default=None)
    args = parser.parse_args()

    if args.cmd == "check":
        print(json.dumps(check_environment(), indent=2))
    else:
        try:
            print(
                json.dumps(
                    generate_video(
                        prompt=args.prompt,
                        output_path=args.output,
                        resolution_key=args.resolution,
                        num_frames=args.frames,
                        fps=args.fps,
                        steps=args.steps,
                        seed=args.seed,
                    ),
                    indent=2,
                )
            )
        except Exception as exc:
            print(json.dumps({"ok": False, "error": str(exc), "trace": traceback.format_exc()}))
            raise SystemExit(1) from exc
