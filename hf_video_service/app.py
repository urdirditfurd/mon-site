import asyncio
import gc
import os
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional

import torch
from diffusers import DiffusionPipeline
from diffusers.utils import export_to_video
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

try:
    from diffusers import AutoencoderKLWan, WanPipeline
except ImportError:  # pragma: no cover - optional until Wan support is installed
    AutoencoderKLWan = None
    WanPipeline = None


SERVICE_TOKEN = os.getenv("HF_VIDEO_SERVICE_TOKEN", "").strip()
MODEL_DEVICE = os.getenv("HF_VIDEO_DEVICE", "cuda" if torch.cuda.is_available() else "cpu").strip()
TORCH_DTYPE_NAME = os.getenv("HF_VIDEO_TORCH_DTYPE", "bfloat16").strip().lower()
ALLOW_REMOTE_CODE = os.getenv("HF_VIDEO_ALLOW_REMOTE_CODE", "true").strip().lower() not in {"0", "false", "no"}
MAX_CONCURRENCY = max(1, int(os.getenv("HF_VIDEO_MAX_CONCURRENCY", "1")))

TORCH_DTYPES = {
    "float16": torch.float16,
    "fp16": torch.float16,
    "bfloat16": torch.bfloat16,
    "bf16": torch.bfloat16,
    "float32": torch.float32,
    "fp32": torch.float32,
}

DEFAULT_DTYPE = TORCH_DTYPES.get(TORCH_DTYPE_NAME, torch.bfloat16)

SUGGESTED_MODELS = [
    {
        "id": "SulphurAI/Sulphur-2-base",
        "label": "Sulphur 2 Base",
        "reason": "Best throughput for daily bulk generation and long stitched videos.",
    },
    {
        "id": "Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
        "label": "Wan 2.1 T2V 1.3B",
        "reason": "Lightweight option for smaller GPUs.",
    },
    {
        "id": "Wan-AI/Wan2.2-T2V-A14B-Diffusers",
        "label": "Wan 2.2 T2V A14B",
        "reason": "Highest open quality when VRAM is abundant.",
    },
]

app = FastAPI(title="HF Video Service", version="1.0.0")
generation_semaphore = asyncio.Semaphore(MAX_CONCURRENCY)
pipeline_lock = asyncio.Lock()
loaded_model_id: Optional[str] = None
loaded_pipeline: Optional[Any] = None


class GenerateRequest(BaseModel):
    model_id: str = Field(..., min_length=3)
    prompt: str = Field(..., min_length=3, max_length=8000)
    negative_prompt: str = Field(default="", max_length=8000)
    width: int = Field(default=704, ge=128, le=2048)
    height: int = Field(default=1216, ge=128, le=2048)
    num_frames: int = Field(default=81, ge=8, le=241)
    fps: int = Field(default=16, ge=1, le=60)
    num_inference_steps: int = Field(default=24, ge=1, le=80)
    guidance_scale: float = Field(default=4.0, ge=0.0, le=30.0)
    guidance_scale_2: Optional[float] = Field(default=None, ge=0.0, le=30.0)
    seed: Optional[int] = Field(default=None, ge=0, le=2**31 - 1)


def require_auth(authorization: Optional[str]) -> None:
    if not SERVICE_TOKEN:
        return
    expected = f"Bearer {SERVICE_TOKEN}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


def cleanup_file(path: str) -> None:
    try:
        Path(path).unlink(missing_ok=True)
    except OSError:
        pass


def unload_pipeline() -> None:
    global loaded_pipeline, loaded_model_id

    if loaded_pipeline is None:
        return
    try:
        if hasattr(loaded_pipeline, "to"):
            loaded_pipeline.to("cpu")
    except Exception:
        pass

    loaded_pipeline = None
    loaded_model_id = None
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def build_pipeline(model_id: str) -> Any:
    lower_model_id = model_id.lower()
    if "wan" in lower_model_id and AutoencoderKLWan is not None and WanPipeline is not None:
        vae = AutoencoderKLWan.from_pretrained(model_id, subfolder="vae", torch_dtype=torch.float32)
        pipe = WanPipeline.from_pretrained(
            model_id,
            vae=vae,
            torch_dtype=DEFAULT_DTYPE,
            trust_remote_code=ALLOW_REMOTE_CODE,
        )
    else:
        pipe = DiffusionPipeline.from_pretrained(
            model_id,
            torch_dtype=DEFAULT_DTYPE,
            trust_remote_code=ALLOW_REMOTE_CODE,
        )

    if hasattr(pipe, "enable_attention_slicing"):
        pipe.enable_attention_slicing()

    if MODEL_DEVICE == "cpu":
        pipe.to("cpu")
    elif hasattr(pipe, "enable_model_cpu_offload"):
        pipe.enable_model_cpu_offload()
    else:
        pipe.to(MODEL_DEVICE)

    return pipe


async def get_pipeline(model_id: str) -> Any:
    global loaded_pipeline, loaded_model_id

    async with pipeline_lock:
        if loaded_pipeline is not None and loaded_model_id == model_id:
            return loaded_pipeline

        unload_pipeline()
        try:
            loaded_pipeline = await asyncio.to_thread(build_pipeline, model_id)
            loaded_model_id = model_id
            return loaded_pipeline
        except Exception as exc:  # pragma: no cover - depends on runtime setup
            unload_pipeline()
            raise HTTPException(status_code=500, detail=f"Unable to load model {model_id}: {exc}") from exc


def run_generation(pipe: Any, request: GenerateRequest, output_path: str) -> None:
    generator = None
    if request.seed is not None:
        generator = torch.Generator(device="cpu").manual_seed(request.seed)

    kwargs: Dict[str, Any] = {
        "prompt": request.prompt,
        "negative_prompt": request.negative_prompt,
        "width": request.width,
        "height": request.height,
        "num_frames": request.num_frames,
        "num_inference_steps": request.num_inference_steps,
        "guidance_scale": request.guidance_scale,
    }
    if request.guidance_scale_2 is not None:
        kwargs["guidance_scale_2"] = request.guidance_scale_2
    if generator is not None:
        kwargs["generator"] = generator

    result = pipe(**kwargs)
    frames = getattr(result, "frames", None)
    if not frames:
        raise RuntimeError("The pipeline did not return video frames.")
    video_frames = frames[0]
    export_to_video(video_frames, output_path, fps=request.fps)


@app.get("/health")
async def health() -> Dict[str, Any]:
    return {
        "ok": True,
        "device": MODEL_DEVICE,
        "dtype": TORCH_DTYPE_NAME,
        "loaded_model_id": loaded_model_id,
        "max_concurrency": MAX_CONCURRENCY,
        "suggested_models": SUGGESTED_MODELS,
    }


@app.get("/models")
async def models() -> Dict[str, Any]:
    return {"models": SUGGESTED_MODELS}


@app.post("/generate")
async def generate_video(
    request: GenerateRequest,
    background_tasks: BackgroundTasks,
    authorization: Optional[str] = Header(default=None),
) -> FileResponse:
    require_auth(authorization)

    async with generation_semaphore:
        pipe = await get_pipeline(request.model_id)
        with tempfile.NamedTemporaryFile(prefix="hf-video-", suffix=".mp4", delete=False) as handle:
            output_path = handle.name

        try:
            await asyncio.to_thread(run_generation, pipe, request, output_path)
        except HTTPException:
            cleanup_file(output_path)
            raise
        except Exception as exc:  # pragma: no cover - depends on runtime setup
            cleanup_file(output_path)
            raise HTTPException(status_code=500, detail=f"Generation failed: {exc}") from exc

    background_tasks.add_task(cleanup_file, output_path)
    return FileResponse(output_path, media_type="video/mp4", filename="generated.mp4")
