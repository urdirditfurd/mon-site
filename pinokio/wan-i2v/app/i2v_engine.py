"""
Wan 2.1 Fun 1.3B InP — Image-to-Video (vraie animation) pour RTX 3080 10 Go.

Pas de portrait fixe + Wav2Lip : image scène → clip MP4 animé (tête, caméra, décor).
Modèle : engineerA314/Wan2.1-Fun-V1.1-1.3B-InP-Diffusers (~8 Go VRAM + CPU offload).
"""

from __future__ import annotations

import json
import os
import time
import traceback
from pathlib import Path

import torch
from PIL import Image

DEFAULT_NEGATIVE = (
    "static image, still photo, frozen frame, no motion, slideshow, ken burns only, "
    "worst quality, blurry, text overlay, watermark, logo, ugly, deformed, "
    "extra limbs, low quality, jpeg artifacts, morphing face, flicker"
)

MOTION_SUFFIX = (
    "character natural movement, breathing, blinking eyes, gentle head tilt, "
    "cinematic camera pan, lively background, smooth 24fps animation, "
    "continuous motion, not a still image"
)

# I2V 1.3B — tient en ~8–10 Go avec offload (pas le 14B)
MODEL_ID = os.environ.get(
    "WAN_I2V_MODEL",
    "engineerA314/Wan2.1-Fun-V1.1-1.3B-InP-Diffusers",
)

RESOLUTION_PRESETS = {
    "480p 16:9": (832, 480),
    "480p 9:16": (480, 832),
    "480p 1:1": (480, 480),
}

_PIPE = None
_PIPE_META: dict | None = None


def _log(msg: str) -> None:
    safe = (
        msg.replace("≤", "<=")
        .replace("≥", ">=")
        .replace("—", "-")
        .replace("…", "...")
        .replace("×", "x")
    )
    try:
        print(safe, flush=True)
    except UnicodeEncodeError:
        print(safe.encode("ascii", "replace").decode("ascii"), flush=True)


def hf_token() -> str | None:
    return os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")


def pick_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _cuda_dtype() -> torch.dtype:
    override = (os.environ.get("WAN_DTYPE") or "").strip().lower()
    if override in ("float16", "fp16", "half"):
        return torch.float16
    if override in ("bfloat16", "bf16"):
        return torch.bfloat16
    if override in ("float32", "fp32"):
        return torch.float32
    return torch.float16 if torch.cuda.is_available() else torch.float32


def _vram_gb() -> tuple[float, float]:
    if not torch.cuda.is_available():
        return 0.0, 0.0
    free, total = torch.cuda.mem_get_info(0)
    return free / 1e9, total / 1e9


def _want_cpu_offload(total_gb: float) -> bool:
    env = (os.environ.get("SULPHUR_CPU_OFFLOAD") or "").strip().lower()
    if env in ("0", "false", "no", "off"):
        return False
    if env in ("1", "true", "yes", "on"):
        return True
    return total_gb > 0 and total_gb <= 12.5


def _tune_cuda() -> None:
    if not torch.cuda.is_available():
        return
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    torch.backends.cudnn.benchmark = True


def _align_frames(n: int) -> int:
    """Wan attend souvent num_frames = 4k+1."""
    n = max(17, int(n))
    if n % 4 != 1:
        n = (n // 4) * 4 + 1
    return n


def _prepare_image(image_path: str | Path, width: int, height: int) -> Image.Image:
    img = Image.open(image_path).convert("RGB")
    # Cover crop 16:9 / preset
    src_w, src_h = img.size
    target_ratio = width / height
    src_ratio = src_w / max(1, src_h)
    if src_ratio > target_ratio:
        new_w = int(round(src_h * target_ratio))
        left = (src_w - new_w) // 2
        img = img.crop((left, 0, left + new_w, src_h))
    else:
        new_h = int(round(src_w / target_ratio))
        top = (src_h - new_h) // 2
        img = img.crop((0, top, src_w, top + new_h))
    return img.resize((width, height), Image.Resampling.LANCZOS)


def get_pipe(cache_dir: str | None, device: str):
    global _PIPE, _PIPE_META
    if _PIPE is not None:
        return _PIPE

    from diffusers import WanImageToVideoPipeline

    _tune_cuda()
    dtype = _cuda_dtype() if device == "cuda" else torch.float32
    free_b, total_b = _vram_gb()
    _log(
        f"[i2v_engine] load {MODEL_ID} device={device} dtype={dtype} "
        f"VRAM={free_b:.1f}/{total_b:.1f}Go"
    )

    pipe = WanImageToVideoPipeline.from_pretrained(
        MODEL_ID,
        torch_dtype=dtype,
        cache_dir=cache_dir,
        token=hf_token(),
    )

    placement = "cpu"
    if device == "cpu":
        pipe.to("cpu")
    else:
        use_offload = _want_cpu_offload(total_b)
        if use_offload:
            pipe.enable_model_cpu_offload()
            placement = "cuda+cpu_offload"
            _log(f"[i2v_engine] enable_model_cpu_offload (GPU {total_b:.0f}Go)")
        else:
            pipe = pipe.to(device)
            placement = "cuda_full"
        for enabler in ("enable_vae_slicing", "enable_vae_tiling", "enable_attention_slicing"):
            fn = getattr(pipe, enabler, None)
            if callable(fn):
                try:
                    fn("auto") if enabler == "enable_attention_slicing" else fn()
                except Exception:
                    pass

    _PIPE = pipe
    _PIPE_META = {
        "device": device,
        "dtype": str(dtype).replace("torch.", ""),
        "placement": placement,
        "model": MODEL_ID,
    }
    return _PIPE


def generate_i2v(
    *,
    image_path: str,
    prompt: str,
    output_path: str,
    resolution_key: str = "480p 16:9",
    num_frames: int = 49,
    fps: int = 16,
    steps: int = 20,
    guidance: float = 5.0,
    negative_prompt: str = DEFAULT_NEGATIVE,
    cache_dir: str | None = None,
    seed: int | None = None,
    progress_callback=None,
) -> dict:
    """Image + prompt motion → MP4 animé (pas un diaporama)."""
    device = pick_device()
    width, height = RESOLUTION_PRESETS.get(resolution_key, RESOLUTION_PRESETS["480p 16:9"])

    # ~3–5 s @ 16 fps : 49f≈3.0s, 65f≈4.0s, 81f≈5.0s
    if device == "cuda":
        _, total_b = _vram_gb()
        if total_b and total_b <= 12.5:
            num_frames = min(int(num_frames), 65)  # ~4 s max confort 10 Go
            steps = min(int(steps), 24)
    num_frames = _align_frames(num_frames)

    full_prompt = (prompt or "").strip()
    if MOTION_SUFFIX.lower() not in full_prompt.lower():
        full_prompt = f"{full_prompt}, {MOTION_SUFFIX}".strip(", ")

    if progress_callback:
        progress_callback(0.05, "Chargement Wan I2V 1.3B…")

    pipe = get_pipe(cache_dir, device)
    image = _prepare_image(image_path, width, height)

    generator = None
    if seed is not None:
        generator = torch.Generator(device="cpu").manual_seed(int(seed))

    dtype_label = (_PIPE_META or {}).get("dtype", "?")
    placement = (_PIPE_META or {}).get("placement", "?")
    if progress_callback:
        progress_callback(
            0.15,
            f"I2V {num_frames}f × {steps} steps ({width}x{height})…",
        )

    _log(
        f"[i2v_engine] generate image={image_path} frames={num_frames} "
        f"steps={steps} placement={placement}"
    )

    kwargs = {
        "image": image,
        "prompt": full_prompt,
        "negative_prompt": negative_prompt or DEFAULT_NEGATIVE,
        "height": height,
        "width": width,
        "num_frames": num_frames,
        "num_inference_steps": int(steps),
        "guidance_scale": float(guidance),
    }
    if generator is not None:
        kwargs["generator"] = generator

    t0 = time.perf_counter()
    with torch.inference_mode():
        result = pipe(**kwargs)
    frames = result.frames[0]
    elapsed = time.perf_counter() - t0

    if progress_callback:
        progress_callback(0.9, "Export MP4…")

    from diffusers.utils import export_to_video

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    export_to_video(frames, str(out), fps=int(fps))

    if progress_callback:
        progress_callback(1.0, "Termine.")

    return {
        "ok": True,
        "outputPath": str(out.resolve()),
        "mode": "wan_i2v",
        "model": MODEL_ID,
        "device": device,
        "dtype": dtype_label,
        "placement": placement,
        "width": width,
        "height": height,
        "numFrames": num_frames,
        "fps": fps,
        "steps": steps,
        "seconds": round(elapsed, 1),
        "clipDurationSec": round(num_frames / max(1, fps), 2),
    }


def check_environment() -> dict:
    free_b, total_b = _vram_gb()
    device = pick_device()
    info = {
        "ok": True,
        "mode": "i2v",
        "model": MODEL_ID,
        "device": device,
        "cuda": torch.cuda.is_available(),
        "dtype": str(_cuda_dtype()).replace("torch.", "") if device == "cuda" else "float32",
        "vramFreeGb": round(free_b, 2),
        "vramTotalGb": round(total_b, 2),
        "cpuOffloadDefault": _want_cpu_offload(total_b),
        "torch": torch.__version__,
        "hfToken": bool(hf_token()),
    }
    if torch.cuda.is_available():
        try:
            info["gpu"] = torch.cuda.get_device_name(0)
        except Exception:
            info["gpu"] = None
    try:
        import diffusers

        info["diffusers"] = diffusers.__version__
        info["hasWanImageToVideo"] = hasattr(
            __import__("diffusers", fromlist=["WanImageToVideoPipeline"]),
            "WanImageToVideoPipeline",
        )
    except Exception as exc:
        info["diffusers"] = None
        info["diffusersError"] = str(exc)
    return info


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check")
    gen = sub.add_parser("generate")
    gen.add_argument("--image", required=True)
    gen.add_argument("--prompt", required=True)
    gen.add_argument("--output", required=True)
    gen.add_argument("--resolution", default="480p 16:9")
    gen.add_argument("--frames", type=int, default=49)
    gen.add_argument("--fps", type=int, default=16)
    gen.add_argument("--steps", type=int, default=20)
    gen.add_argument("--seed", type=int, default=None)
    args = parser.parse_args()

    if args.cmd == "check":
        print(json.dumps(check_environment(), indent=2))
    else:
        try:
            print(
                json.dumps(
                    generate_i2v(
                        image_path=args.image,
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
            print(
                json.dumps(
                    {"ok": False, "error": str(exc), "trace": traceback.format_exc()}
                )
            )
            raise SystemExit(1) from exc
