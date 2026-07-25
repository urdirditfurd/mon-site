"""
I2V rapide pour RTX 3080 10 Go — cible <90 s / scène apres 1er chargement.

Backend : LTX-Video (defaut) ou Wan Fun 1.3B.
IMPORTANT : utiliser `batch` pour N scenes = 1 seul chargement modele
(sinon chaque CLI recharge le modele = 10+ min/scene).

Plafonds vitesse :
  - steps ≤ 8 (max 10)
  - resolution 704×384 (upscale 1080p au montage)
  - frames = 33 (~1.4 s @ 24 fps, boucle sur l'audio)
  - lowvram + SDPA
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback
from pathlib import Path

import torch
from PIL import Image

DEFAULT_NEGATIVE = (
    "deformed face, blurry, distortion, bad anatomy, morphing, melted face, "
    "glitch, artifacts, morphing face, face warp, warped face, asymmetric eyes, "
    "extra limbs, mutated hands, static image, still photo, frozen frame, "
    "slideshow, ken burns only, motion blur, heavy blur, smearing, ghosting, "
    "flicker, worst quality, text overlay, watermark, logo, ugly, deformed, "
    "low quality, jpeg artifacts"
)

MOTION_SUFFIX = (
    "VERY subtle motion only: soft breathing, tiny head tilt, gentle eye blink, "
    "stable identity, same face locked, sharp facial features, no camera whip, "
    "almost still body, preserve original face exactly"
)

BACKEND = (os.environ.get("WAN_I2V_BACKEND") or "ltx").strip().lower()
WAN_MODEL_ID = os.environ.get(
    "WAN_I2V_MODEL",
    "engineerA314/Wan2.1-Fun-V1.1-1.3B-InP-Diffusers",
)
LTX_MODEL_ID = os.environ.get("LTX_I2V_MODEL", "Lightricks/LTX-Video")

# Anti-deformation visage : CFG bas, motion tres subtil, res native alignee
MAX_STEPS = int(os.environ.get("PINOKIO_I2V_STEPS", "22"))
MAX_FRAMES = int(os.environ.get("PINOKIO_I2V_FRAMES", "33"))
DEFAULT_WIDTH = int(os.environ.get("PINOKIO_I2V_WIDTH", "848"))
DEFAULT_HEIGHT = int(os.environ.get("PINOKIO_I2V_HEIGHT", "480"))
GUIDANCE = float(os.environ.get("PINOKIO_I2V_GUIDANCE", "3.5"))
MOTION_SCALE = float(os.environ.get("PINOKIO_I2V_MOTION_SCALE", "0.3"))
SCHEDULER_NAME = (os.environ.get("PINOKIO_I2V_SCHEDULER") or "default").strip().lower()
EXPORT_FPS = int(os.environ.get("PINOKIO_I2V_FPS", "24"))

RESOLUTION_PRESETS = {
    "480p 16:9": (848, 480),
    "848p 16:9": (848, 480),
    "576p 16:9": (1024, 576),
    "1024p 16:9": (1024, 576),
    "704p 16:9": (704, 384),
    "480p 9:16": (384, 704),
    "480p 1:1": (384, 384),
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
        print(safe, flush=True, file=sys.stderr)
    except UnicodeEncodeError:
        print(safe.encode("ascii", "replace").decode("ascii"), flush=True, file=sys.stderr)


def hf_token() -> str | None:
    return os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")


def pick_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _cuda_dtype() -> torch.dtype:
    override = (os.environ.get("WAN_DTYPE") or "").strip().lower()
    if override in ("bfloat16", "bf16"):
        return torch.bfloat16
    if override in ("float32", "fp32"):
        return torch.float32
    # RTX 30xx : float16 plus rapide que bf16
    return torch.float16 if torch.cuda.is_available() else torch.float32


def _vram_gb() -> tuple[float, float]:
    if not torch.cuda.is_available():
        return 0.0, 0.0
    free, total = torch.cuda.mem_get_info(0)
    return free / 1e9, total / 1e9


def _lowvram() -> bool:
    env = (os.environ.get("CONTE_I2V_LOWVRAM") or os.environ.get("SULPHUR_CPU_OFFLOAD") or "1")
    return env.strip().lower() in ("1", "true", "yes", "on", "medvram", "lowvram")


def _tune_cuda() -> None:
    if not torch.cuda.is_available():
        return
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    torch.backends.cudnn.benchmark = True
    try:
        torch.backends.cuda.enable_flash_sdp(True)
        torch.backends.cuda.enable_mem_efficient_sdp(True)
        torch.backends.cuda.enable_math_sdp(True)
    except Exception:
        pass
    try:
        torch.set_float32_matmul_precision("high")
    except Exception:
        pass


def _clamp_steps(steps: int) -> int:
    # Qualite : 20-25 (jamais sous 12 apres warm)
    return max(12, min(int(steps), 25))


def _align_frames_wan(n: int) -> int:
    n = max(17, int(n))
    if n % 4 != 1:
        n = (n // 4) * 4 + 1
    return min(n, 81)


def _align_frames_ltx(n: int) -> int:
    n = max(9, int(n))
    if (n - 1) % 8 != 0:
        n = ((n - 1) // 8) * 8 + 1
    return min(n, 81)


def _motion_prompt_scale(prompt: str, scale: float) -> str:
    """Motion tres subtil (0.2-0.4) pour garder le visage net."""
    s = max(0.15, min(0.45, float(scale)))
    if s <= 0.25:
        tag = (
            "almost still, micro breathing only, locked face identity, "
            "no camera move, sharp crisp face"
        )
    elif s <= 0.35:
        tag = (
            "very subtle motion, soft blink and tiny head tilt, "
            "stable face, no morphing, sharp facial details"
        )
    else:
        tag = (
            "subtle gentle motion, calm breathing, preserve face exactly, "
            "minimal movement, no smear"
        )
    base = (prompt or "").strip()
    if "locked face" in base.lower() or "preserve face" in base.lower():
        return base
    return f"{base}, {tag}".strip(", ")


def _clamp_guidance(value: float) -> float:
    """CFG 3.5-4.0 MAX — au-dela le visage se deforme."""
    return max(3.0, min(4.0, float(value)))


def _apply_scheduler(pipe, name: str) -> str:
    """
    LTX / Wan utilisent des schedulers a sigmas custom.
    NE PAS remplacer par DPMSolverMultistep (crash set_timesteps).
    Defaut = garder le scheduler natif du pipeline.
    """
    key = (name or "default").strip().lower()
    if key in {"", "default", "auto", "native", "none", "keep"}:
        cls = type(pipe.scheduler).__name__
        _log(f"[i2v_engine] scheduler=native ({cls})")
        return f"native:{cls}"

    # Snapshot pour rollback si incompatible
    original = pipe.scheduler
    try:
        if key in {"euler", "euler_a", "euler_ancestral"}:
            from diffusers import EulerAncestralDiscreteScheduler

            pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(
                original.config
            )
            return "euler_ancestral"
        if key in {"euler_discrete", "euler_d"}:
            from diffusers import EulerDiscreteScheduler

            pipe.scheduler = EulerDiscreteScheduler.from_config(original.config)
            return "euler"
        # dpmpp_2m / dpm = IGNORE pour I2V LTX/Wan (sigmas custom)
        _log(
            f"[i2v_engine] scheduler '{key}' ignore (incompatible LTX/Wan) "
            f"— garde {type(original).__name__}"
        )
        return f"native:{type(original).__name__}"
    except Exception as exc:
        pipe.scheduler = original
        _log(f"[i2v_engine] scheduler skip ({key}): {exc}")
        return f"native:{type(original).__name__}"


def _align_dim(value: int, multiple: int = 32) -> int:
    return max(multiple, (int(value) // multiple) * multiple)


def _prepare_image(image_path: str | Path, width: int, height: int) -> Image.Image:
    img = Image.open(image_path).convert("RGB")
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


def _enable_attention(pipe) -> None:
    """SDPA / xformers si dispo — accélère sans coûter de VRAM."""
    for name in ("enable_xformers_memory_efficient_attention",):
        fn = getattr(pipe, name, None)
        if callable(fn):
            try:
                fn()
                _log(f"[i2v_engine] {name} OK")
                return
            except Exception as exc:
                _log(f"[i2v_engine] {name} skip: {exc}")
    # Diffusers utilise SDPA par défaut sur torch 2.x
    _log("[i2v_engine] attention=sdpa (torch)")


def _place_pipe(pipe, device: str, total_b: float) -> str:
    if device == "cpu":
        pipe.to("cpu")
        return "cpu"
    if _lowvram() or (total_b > 0 and total_b <= 12.5):
        # lowvram / medvram : modules GPU un à un
        if hasattr(pipe, "enable_model_cpu_offload"):
            pipe.enable_model_cpu_offload()
            _log(f"[i2v_engine] lowvram=model_cpu_offload (GPU {total_b:.0f}Go)")
            placement = "cuda+cpu_offload"
        else:
            pipe.to(device)
            placement = "cuda_full"
    else:
        pipe.to(device)
        placement = "cuda_full"
    for enabler in ("enable_vae_slicing", "enable_vae_tiling", "enable_attention_slicing"):
        fn = getattr(pipe, enabler, None)
        if callable(fn):
            try:
                fn("auto") if enabler == "enable_attention_slicing" else fn()
            except Exception:
                pass
    _enable_attention(pipe)
    return placement


def get_pipe(cache_dir: str | None, device: str, backend: str | None = None):
    global _PIPE, _PIPE_META
    backend = (backend or BACKEND or "ltx").lower()
    if _PIPE is not None and (_PIPE_META or {}).get("backend") == backend:
        return _PIPE

    _tune_cuda()
    dtype = _cuda_dtype() if device == "cuda" else torch.float32
    free_b, total_b = _vram_gb()
    _log(
        f"[i2v_engine] backend={backend} device={device} dtype={dtype} "
        f"VRAM={free_b:.1f}/{total_b:.1f}Go steps<={_clamp_steps(MAX_STEPS)} "
        f"frames={MAX_FRAMES} res={DEFAULT_WIDTH}x{DEFAULT_HEIGHT}"
    )

    pipe = None
    model_id = WAN_MODEL_ID
    used_backend = backend

    if backend in {"ltx", "ltx-video", "lightricks", "auto"}:
        try:
            from diffusers import LTXImageToVideoPipeline

            model_id = LTX_MODEL_ID
            # LTX préfère bf16 si dispo, sinon fp16
            ltx_dtype = torch.bfloat16 if dtype == torch.bfloat16 else torch.float16
            if device == "cpu":
                ltx_dtype = torch.float32
            pipe = LTXImageToVideoPipeline.from_pretrained(
                model_id,
                torch_dtype=ltx_dtype,
                cache_dir=cache_dir,
                token=hf_token(),
            )
            used_backend = "ltx"
            dtype = ltx_dtype
        except Exception as exc:
            _log(f"[i2v_engine] LTX indisponible ({exc}) — fallback Wan 1.3B")
            pipe = None
            used_backend = "wan"

    if pipe is None:
        from diffusers import WanImageToVideoPipeline

        model_id = WAN_MODEL_ID
        pipe = WanImageToVideoPipeline.from_pretrained(
            model_id,
            torch_dtype=dtype,
            cache_dir=cache_dir,
            token=hf_token(),
        )
        used_backend = "wan"

    placement = _place_pipe(pipe, device, total_b)
    sched = _apply_scheduler(pipe, SCHEDULER_NAME)
    _PIPE = pipe
    _PIPE_META = {
        "device": device,
        "dtype": str(dtype).replace("torch.", ""),
        "placement": placement,
        "model": model_id,
        "backend": used_backend,
        "scheduler": sched,
    }
    return _PIPE


def generate_i2v(
    *,
    image_path: str,
    prompt: str,
    output_path: str,
    resolution_key: str = "848p 16:9",
    num_frames: int | None = None,
    fps: int | None = None,
    steps: int | None = None,
    guidance: float | None = None,
    negative_prompt: str = DEFAULT_NEGATIVE,
    cache_dir: str | None = None,
    seed: int | None = None,
    progress_callback=None,
) -> dict:
    """Image + prompt → MP4 : visage stable (CFG<=4, motion subtil)."""
    device = pick_device()
    width, height = RESOLUTION_PRESETS.get(
        resolution_key, (DEFAULT_WIDTH, DEFAULT_HEIGHT)
    )
    if resolution_key not in RESOLUTION_PRESETS:
        width, height = DEFAULT_WIDTH, DEFAULT_HEIGHT
    width = _align_dim(width, 32)
    height = _align_dim(height, 32)

    steps = _clamp_steps(steps if steps is not None else MAX_STEPS)
    fps = int(fps or EXPORT_FPS)
    guidance = _clamp_guidance(guidance if guidance is not None else GUIDANCE)
    motion = max(0.2, min(0.4, MOTION_SCALE))

    num_frames = int(num_frames if num_frames is not None else MAX_FRAMES)

    full_prompt = _motion_prompt_scale(prompt or "", motion)
    if MOTION_SUFFIX.lower() not in full_prompt.lower():
        full_prompt = f"{full_prompt}, {MOTION_SUFFIX}".strip(", ")
    neg = negative_prompt or DEFAULT_NEGATIVE
    for token in (
        "deformed face",
        "melted face",
        "morphing",
        "bad anatomy",
        "distortion",
    ):
        if token not in neg.lower():
            neg = f"{token}, {neg}"

    if progress_callback:
        progress_callback(0.05, "Chargement I2V anti-deformation visage…")

    pipe = get_pipe(cache_dir, device)
    backend = (_PIPE_META or {}).get("backend", "wan")
    scheduler = (_PIPE_META or {}).get("scheduler", SCHEDULER_NAME)
    if backend == "ltx":
        num_frames = _align_frames_ltx(num_frames)
        guidance = min(guidance, 3.5)
    else:
        num_frames = _align_frames_wan(num_frames)

    # Resize EXACT a la resolution native du modele (evite warp visage)
    image = _prepare_image(image_path, width, height)
    if image.size != (width, height):
        image = image.resize((width, height), Image.Resampling.LANCZOS)

    generator = None
    if seed is not None:
        generator = torch.Generator(device="cpu").manual_seed(int(seed))

    dtype_label = (_PIPE_META or {}).get("dtype", "?")
    placement = (_PIPE_META or {}).get("placement", "?")
    model_id = (_PIPE_META or {}).get("model", "?")

    if progress_callback:
        progress_callback(
            0.15,
            f"{backend}/{scheduler} {num_frames}f x {steps}s @ {width}x{height} "
            f"cfg={guidance:.1f} motion={motion:.2f}",
        )

    _log(
        f"[i2v_engine] START backend={backend} sched={scheduler} frames={num_frames} "
        f"steps={steps} cfg={guidance} motion={motion:.2f} {width}x{height} "
        f"placement={placement} face-safe"
    )

    kwargs: dict = {
        "image": image,
        "prompt": full_prompt,
        "negative_prompt": neg,
        "height": height,
        "width": width,
        "num_frames": num_frames,
        "num_inference_steps": steps,
        "guidance_scale": guidance,
    }
    if backend == "ltx":
        kwargs["frame_rate"] = fps
    if generator is not None:
        kwargs["generator"] = generator

    t0 = time.perf_counter()
    with torch.inference_mode():
        result = pipe(**kwargs)
    frames = result.frames[0]
    elapsed = time.perf_counter() - t0
    per_step = elapsed / max(1, steps)

    if progress_callback:
        progress_callback(0.9, "Export MP4…")

    from diffusers.utils import export_to_video

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    export_to_video(frames, str(out), fps=fps)

    if progress_callback:
        progress_callback(1.0, "Termine.")

    _log(
        f"[i2v_engine] DONE {elapsed:.1f}s ({per_step:.1f}s/step) "
        f"face-safe cfg={guidance} motion={motion:.2f}"
    )

    return {
        "ok": True,
        "outputPath": str(out.resolve()),
        "mode": f"{backend}_i2v_face_safe",
        "model": model_id,
        "backend": backend,
        "scheduler": scheduler,
        "device": device,
        "dtype": dtype_label,
        "placement": placement,
        "width": width,
        "height": height,
        "numFrames": num_frames,
        "fps": fps,
        "steps": steps,
        "guidance": guidance,
        "motionScale": motion,
        "seconds": round(elapsed, 1),
        "secondsPerStep": round(per_step, 2),
        "clipDurationSec": round(num_frames / max(1, fps), 2),
    }


def generate_i2v_batch(
    jobs: list[dict],
    *,
    resolution_key: str = "848p 16:9",
    num_frames: int | None = None,
    fps: int | None = None,
    steps: int | None = None,
    cache_dir: str | None = None,
) -> dict:
    """Genere N clips avec UN SEUL chargement modele (critique pour la vitesse)."""
    if not jobs:
        return {"ok": True, "results": [], "loadedOnce": True}

    device = pick_device()
    # Force le chargement une fois
    get_pipe(cache_dir, device)
    results: list[dict] = []
    t_all = time.perf_counter()
    for i, job in enumerate(jobs):
        image = str(job.get("image") or "")
        prompt = str(job.get("prompt") or "")
        output = str(job.get("output") or "")
        seed = job.get("seed")
        _log(f"[i2v_engine] batch {i + 1}/{len(jobs)} → {output}")
        try:
            results.append(
                generate_i2v(
                    image_path=image,
                    prompt=prompt,
                    output_path=output,
                    resolution_key=resolution_key,
                    num_frames=num_frames,
                    fps=fps,
                    steps=steps,
                    seed=int(seed) if seed is not None else None,
                    cache_dir=cache_dir,
                )
            )
        except Exception as exc:
            results.append(
                {
                    "ok": False,
                    "outputPath": output,
                    "error": str(exc)[:500],
                    "trace": traceback.format_exc()[-800:],
                }
            )
    return {
        "ok": all(r.get("ok") for r in results),
        "results": results,
        "loadedOnce": True,
        "seconds": round(time.perf_counter() - t_all, 1),
        "count": len(results),
    }


def check_environment() -> dict:
    free_b, total_b = _vram_gb()
    device = pick_device()
    info = {
        "ok": True,
        "mode": "i2v_fast",
        "backendDefault": BACKEND,
        "wanModel": WAN_MODEL_ID,
        "ltxModel": LTX_MODEL_ID,
        "device": device,
        "cuda": torch.cuda.is_available(),
        "dtype": str(_cuda_dtype()).replace("torch.", "") if device == "cuda" else "float32",
        "vramFreeGb": round(free_b, 2),
        "vramTotalGb": round(total_b, 2),
        "lowvram": _lowvram(),
        "maxSteps": _clamp_steps(MAX_STEPS),
        "maxFrames": MAX_FRAMES,
        "resolution": f"{DEFAULT_WIDTH}x{DEFAULT_HEIGHT}",
        "guidance": GUIDANCE,
        "motionScale": MOTION_SCALE,
        "scheduler": SCHEDULER_NAME,
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
        info["hasLTX"] = hasattr(
            __import__("diffusers", fromlist=["LTXImageToVideoPipeline"]),
            "LTXImageToVideoPipeline",
        )
        info["hasWanI2V"] = hasattr(
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
    gen.add_argument("--resolution", default="848p 16:9")
    gen.add_argument("--frames", type=int, default=MAX_FRAMES)
    gen.add_argument("--fps", type=int, default=EXPORT_FPS)
    gen.add_argument("--steps", type=int, default=MAX_STEPS)
    gen.add_argument("--seed", type=int, default=None)
    bat = sub.add_parser("batch")
    bat.add_argument("--jobs", required=True, help="JSON file: [{image,prompt,output,seed}]")
    bat.add_argument("--resolution", default="848p 16:9")
    bat.add_argument("--frames", type=int, default=MAX_FRAMES)
    bat.add_argument("--fps", type=int, default=EXPORT_FPS)
    bat.add_argument("--steps", type=int, default=MAX_STEPS)
    args = parser.parse_args()

    if args.cmd == "check":
        print(json.dumps(check_environment(), ensure_ascii=False))
    elif args.cmd == "batch":
        try:
            jobs = json.loads(Path(args.jobs).read_text(encoding="utf-8"))
            if not isinstance(jobs, list):
                raise ValueError("jobs JSON must be a list")
            print(
                json.dumps(
                    generate_i2v_batch(
                        jobs,
                        resolution_key=args.resolution,
                        num_frames=args.frames,
                        fps=args.fps,
                        steps=args.steps,
                    ),
                    ensure_ascii=False,
                )
            )
        except Exception as exc:
            print(
                json.dumps(
                    {"ok": False, "error": str(exc), "trace": traceback.format_exc()}
                )
            )
            raise SystemExit(1) from exc
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
                    ensure_ascii=False,
                )
            )
        except Exception as exc:
            print(
                json.dumps(
                    {"ok": False, "error": str(exc), "trace": traceback.format_exc()}
                )
            )
            raise SystemExit(1) from exc
