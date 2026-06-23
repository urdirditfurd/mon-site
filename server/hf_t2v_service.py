"""
HF Text-to-Video Service — microservice FastAPI local pour ClipForge Studio.

Modèles supportés (triés par téléchargements HuggingFace) :
  - wan-1.3b  : Wan-AI/Wan2.1-T2V-1.3B-Diffusers  (~8 GB VRAM, ~2-4 min/clip)
  - wan-14b   : Wan-AI/Wan2.1-T2V-14B-Diffusers    (~18 GB VRAM, meilleure qualité)
  - ltx       : Lightricks/LTX-Video-2.1            (base de Sulphur-2, ~8 GB VRAM, rapide)
  - ltx-fast  : Lightricks/LTX-Video-2.1 + distill  (encore plus rapide)

Démarrage :
  python3 server/hf_t2v_service.py [--port 7860] [--model wan-1.3b] [--device cuda|cpu|mps]
"""

import argparse
import asyncio
import gc
import json
import logging
import os
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from queue import Empty, Queue
from typing import Any, Dict, List, Optional

logging.basicConfig(level=logging.INFO, format="%(asctime)s [T2V] %(levelname)s %(message)s")
log = logging.getLogger("hf_t2v")

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

SUPPORTED_MODELS: Dict[str, Dict[str, Any]] = {
    "wan-1.3b": {
        "repo": "Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
        "pipeline_class": "WanPipeline",
        "vae_dtype": "float32",
        "dtype": "bfloat16",
        "vram_gb": 8.2,
        "description": "Wan 2.1 1.3B — léger, idéal génération en masse (< 8 GB VRAM)",
    },
    "wan-14b": {
        "repo": "Wan-AI/Wan2.1-T2V-14B-Diffusers",
        "pipeline_class": "WanPipeline",
        "vae_dtype": "float32",
        "dtype": "bfloat16",
        "vram_gb": 18,
        "description": "Wan 2.1 14B — haute qualité (18 GB VRAM min.)",
    },
    "ltx": {
        "repo": "Lightricks/LTX-Video-2.1",
        "pipeline_class": "LTXPipeline",
        "vae_dtype": "bfloat16",
        "dtype": "bfloat16",
        "vram_gb": 8,
        "description": "LTX-Video 2.1 — base de Sulphur-2, rapide (< 8 GB VRAM)",
    },
}

DEFAULT_MODEL = os.environ.get("HF_T2V_MODEL", "wan-1.3b")
DEFAULT_PORT = int(os.environ.get("HF_T2V_PORT", "7860"))
STORAGE_DIR = Path(os.environ.get("HF_T2V_STORAGE", Path(__file__).parent.parent / "storage" / "hf-videos"))
MODELS_CACHE_DIR = Path(os.environ.get("HF_T2V_CACHE", Path.home() / ".cache" / "hf-t2v-models"))

NEGATIVE_PROMPT = (
    "Bright tones, overexposed, static, blurred details, subtitles, paintings, "
    "images, still picture, messy background, deformed, disfigured, JPEG artifacts, "
    "ugly, incomplete, extra fingers, poorly drawn hands, worst quality, low quality"
)

# ---------------------------------------------------------------------------
# Job store (thread-safe)
# ---------------------------------------------------------------------------

_jobs: Dict[str, Dict] = {}
_jobs_lock = threading.Lock()
_work_queue: Queue = Queue()


def _job_get(job_id: str) -> Optional[Dict]:
    with _jobs_lock:
        return _jobs.get(job_id)


def _job_set(job_id: str, data: Dict) -> None:
    with _jobs_lock:
        _jobs[job_id] = data


def _job_patch(job_id: str, patch: Dict) -> None:
    with _jobs_lock:
        if job_id in _jobs:
            _jobs[job_id].update(patch)
            _jobs[job_id]["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# ---------------------------------------------------------------------------
# Pipeline loader (lazy, singleton)
# ---------------------------------------------------------------------------

_loaded_model_key: Optional[str] = None
_pipe = None
_pipe_lock = threading.Lock()


def _ensure_dependencies() -> None:
    """Installe les dépendances manquantes au premier démarrage."""
    try:
        import torch  # noqa: F401
        import diffusers  # noqa: F401
    except ImportError:
        log.info("Installation des dépendances HF (torch, diffusers, accelerate)…")
        subprocess.check_call([
            sys.executable, "-m", "pip", "install", "--quiet",
            "torch", "torchvision", "torchaudio",
            "--index-url", "https://download.pytorch.org/whl/cpu"
        ])
        subprocess.check_call([
            sys.executable, "-m", "pip", "install", "--quiet",
            "diffusers>=0.32.0", "accelerate>=0.26.0", "transformers>=4.40.0",
            "sentencepiece", "imageio[ffmpeg]", "huggingface_hub"
        ])


def _detect_device() -> str:
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
    except ImportError:
        pass
    return "cpu"


def _load_pipeline(model_key: str, device: str):
    global _loaded_model_key, _pipe

    if _loaded_model_key == model_key and _pipe is not None:
        return _pipe

    _ensure_dependencies()

    import torch
    from diffusers import AutoencoderKLWan, WanPipeline

    cfg = SUPPORTED_MODELS[model_key]
    repo = cfg["repo"]
    dtype_map = {"float32": torch.float32, "bfloat16": torch.bfloat16, "float16": torch.float16}
    pipe_dtype = dtype_map.get(cfg["dtype"], torch.bfloat16)
    vae_dtype = dtype_map.get(cfg["vae_dtype"], torch.float32)

    log.info(f"Chargement du modèle {repo} sur {device}…")
    MODELS_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    if cfg["pipeline_class"] == "WanPipeline":
        vae = AutoencoderKLWan.from_pretrained(
            repo, subfolder="vae", torch_dtype=vae_dtype,
            cache_dir=str(MODELS_CACHE_DIR)
        )
        pipe = WanPipeline.from_pretrained(
            repo, vae=vae, torch_dtype=pipe_dtype,
            cache_dir=str(MODELS_CACHE_DIR)
        )
    elif cfg["pipeline_class"] == "LTXPipeline":
        from diffusers import LTXPipeline
        pipe = LTXPipeline.from_pretrained(
            repo, torch_dtype=pipe_dtype,
            cache_dir=str(MODELS_CACHE_DIR)
        )
    else:
        raise ValueError(f"Pipeline inconnu: {cfg['pipeline_class']}")

    if device == "cpu":
        pipe.enable_model_cpu_offload()
    else:
        pipe = pipe.to(device)

    _loaded_model_key = model_key
    _pipe = pipe
    log.info(f"Modèle {repo} chargé sur {device}")
    return _pipe


# ---------------------------------------------------------------------------
# Génération vidéo
# ---------------------------------------------------------------------------

def _frames_for_duration(duration_sec: float, fps: int = 15) -> int:
    """Nombre de frames pour une durée donnée (multiple de 4 + 1 requis par Wan)."""
    raw = int(duration_sec * fps)
    raw = max(raw, 17)
    r = (raw - 1) % 4
    if r != 0:
        raw = raw + (4 - r)
    return raw


def _generate_clip(
    prompt: str,
    output_path: Path,
    model_key: str,
    device: str,
    duration_sec: float = 5.0,
    width: int = 832,
    height: int = 480,
    fps: int = 15,
    guidance_scale: float = 5.0,
    num_inference_steps: int = 50,
    negative_prompt: str = NEGATIVE_PROMPT,
    seed: Optional[int] = None,
) -> Path:
    import torch
    from diffusers.utils import export_to_video

    with _pipe_lock:
        pipe = _load_pipeline(model_key, device)

        generator = torch.Generator(device=device).manual_seed(seed) if seed is not None else None
        num_frames = _frames_for_duration(duration_sec, fps)

        log.info(f"Génération: {num_frames} frames ({duration_sec}s) — {width}x{height} — '{prompt[:80]}…'")

        kwargs: Dict[str, Any] = {
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "height": height,
            "width": width,
            "num_frames": num_frames,
            "guidance_scale": guidance_scale,
            "num_inference_steps": num_inference_steps,
        }
        if generator is not None:
            kwargs["generator"] = generator

        result = pipe(**kwargs)
        frames = result.frames[0]

    output_path.parent.mkdir(parents=True, exist_ok=True)
    export_to_video(frames, str(output_path), fps=fps)
    log.info(f"Clip exporté → {output_path}")
    return output_path


# ---------------------------------------------------------------------------
# Worker thread
# ---------------------------------------------------------------------------

def _worker_loop(model_key: str, device: str) -> None:
    """Boucle de traitement des jobs en arrière-plan."""
    log.info(f"Worker T2V démarré (modèle={model_key}, device={device})")
    while True:
        try:
            job_id = _work_queue.get(timeout=5)
        except Empty:
            continue

        job = _job_get(job_id)
        if job is None:
            continue

        try:
            _job_patch(job_id, {"status": "running", "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
            log.info(f"[{job_id}] Début génération: {job['prompt'][:60]}")

            output_path = STORAGE_DIR / job_id / "output.mp4"
            _generate_clip(
                prompt=job["prompt"],
                output_path=output_path,
                model_key=job.get("model", model_key),
                device=device,
                duration_sec=float(job.get("durationSec", 5)),
                width=int(job.get("width", 832)),
                height=int(job.get("height", 480)),
                fps=int(job.get("fps", 15)),
                guidance_scale=float(job.get("guidanceScale", 5.0)),
                num_inference_steps=int(job.get("steps", 50)),
                negative_prompt=job.get("negativePrompt", NEGATIVE_PROMPT),
                seed=job.get("seed"),
            )

            _job_patch(job_id, {
                "status": "completed",
                "outputPath": str(output_path),
                "downloadUrl": f"/api/hf-t2v/jobs/{job_id}/download",
                "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })
            log.info(f"[{job_id}] Terminé → {output_path}")

        except Exception as exc:
            log.error(f"[{job_id}] Erreur: {exc}", exc_info=True)
            _job_patch(job_id, {"status": "failed", "error": str(exc)})
        finally:
            gc.collect()
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except ImportError:
                pass
            _work_queue.task_done()


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

def _create_app(model_key: str, device: str):
    try:
        from fastapi import FastAPI, HTTPException
        from fastapi.responses import FileResponse, JSONResponse
        from pydantic import BaseModel
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", "fastapi", "uvicorn[standard]", "pydantic"])
        from fastapi import FastAPI, HTTPException
        from fastapi.responses import FileResponse, JSONResponse
        from pydantic import BaseModel

    app = FastAPI(title="HF Text-to-Video Service", version="1.0.0")

    class GenerateRequest(BaseModel):
        prompt: str
        durationSec: float = 5.0
        width: int = 832
        height: int = 480
        fps: int = 15
        guidanceScale: float = 5.0
        steps: int = 50
        negativePrompt: str = NEGATIVE_PROMPT
        model: str = model_key
        seed: Optional[int] = None

    class BulkGenerateRequest(BaseModel):
        prompts: List[str]
        durationSec: float = 5.0
        width: int = 832
        height: int = 480
        fps: int = 15
        guidanceScale: float = 5.0
        steps: int = 50
        model: str = model_key

    @app.get("/health")
    def health():
        return {
            "status": "ok",
            "model": model_key,
            "device": device,
            "queue_size": _work_queue.qsize(),
            "jobs_count": len(_jobs),
        }

    @app.get("/models")
    def list_models():
        return [{"key": k, **{kk: vv for kk, vv in v.items() if kk != "pipeline_class"}}
                for k, v in SUPPORTED_MODELS.items()]

    @app.post("/generate")
    def generate(req: GenerateRequest):
        job_id = str(uuid.uuid4())
        job = {
            "id": job_id,
            "status": "queued",
            "prompt": req.prompt,
            "durationSec": req.durationSec,
            "width": req.width,
            "height": req.height,
            "fps": req.fps,
            "guidanceScale": req.guidanceScale,
            "steps": req.steps,
            "negativePrompt": req.negativePrompt,
            "model": req.model if req.model in SUPPORTED_MODELS else model_key,
            "seed": req.seed,
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        _job_set(job_id, job)
        _work_queue.put(job_id)
        log.info(f"Job {job_id} mis en file ({_work_queue.qsize()} en attente)")
        return {"id": job_id, "status": "queued"}

    @app.post("/generate/bulk")
    def generate_bulk(req: BulkGenerateRequest):
        if len(req.prompts) > 500:
            raise HTTPException(status_code=400, detail="Maximum 500 prompts par lot")
        job_ids = []
        for prompt in req.prompts:
            job_id = str(uuid.uuid4())
            job = {
                "id": job_id,
                "status": "queued",
                "prompt": prompt,
                "durationSec": req.durationSec,
                "width": req.width,
                "height": req.height,
                "fps": req.fps,
                "guidanceScale": req.guidanceScale,
                "steps": req.steps,
                "negativePrompt": NEGATIVE_PROMPT,
                "model": req.model if req.model in SUPPORTED_MODELS else model_key,
                "seed": None,
                "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            _job_set(job_id, job)
            _work_queue.put(job_id)
            job_ids.append(job_id)
        log.info(f"Lot de {len(job_ids)} jobs ajoutés — file: {_work_queue.qsize()}")
        return {"jobIds": job_ids, "count": len(job_ids)}

    @app.get("/jobs")
    def list_jobs(limit: int = 50):
        with _jobs_lock:
            jobs_list = list(_jobs.values())
        jobs_list.sort(key=lambda j: j.get("createdAt", ""), reverse=True)
        return jobs_list[:limit]

    @app.get("/jobs/{job_id}")
    def get_job(job_id: str):
        job = _job_get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job introuvable")
        return job

    @app.delete("/jobs/{job_id}")
    def cancel_job(job_id: str):
        job = _job_get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job introuvable")
        if job.get("status") == "queued":
            _job_patch(job_id, {"status": "cancelled"})
        return {"id": job_id, "status": _job_get(job_id)["status"]}

    @app.get("/jobs/{job_id}/download")
    def download_job(job_id: str):
        job = _job_get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job introuvable")
        if job.get("status") != "completed":
            raise HTTPException(status_code=409, detail=f"Vidéo non prête (status={job.get('status')})")
        output_path = job.get("outputPath", "")
        if not output_path or not Path(output_path).exists():
            raise HTTPException(status_code=404, detail="Fichier vidéo introuvable")
        return FileResponse(output_path, media_type="video/mp4", filename=f"hf-t2v-{job_id[:8]}.mp4")

    @app.get("/queue")
    def queue_status():
        return {"size": _work_queue.qsize(), "active_model": _loaded_model_key, "device": device}

    @app.post("/queue/clear")
    def clear_queue():
        cleared = 0
        while not _work_queue.empty():
            try:
                job_id = _work_queue.get_nowait()
                _job_patch(job_id, {"status": "cancelled"})
                _work_queue.task_done()
                cleared += 1
            except Empty:
                break
        return {"cleared": cleared}

    return app


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="HF Text-to-Video microservice")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--model", default=DEFAULT_MODEL, choices=list(SUPPORTED_MODELS.keys()))
    parser.add_argument("--device", default=None, help="cuda|cpu|mps (auto-détecté si absent)")
    parser.add_argument("--workers", type=int, default=1, help="Nombre de workers GPU simultanés")
    parser.add_argument("--preload", action="store_true", help="Précharger le modèle au démarrage")
    args = parser.parse_args()

    device = args.device or _detect_device()
    log.info(f"Device: {device} | Modèle: {args.model} | Port: {args.port}")

    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    MODELS_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    _ensure_dependencies()

    if args.preload:
        log.info("Préchargement du modèle…")
        _load_pipeline(args.model, device)

    for i in range(args.workers):
        t = threading.Thread(target=_worker_loop, args=(args.model, device), daemon=True, name=f"t2v-worker-{i}")
        t.start()

    try:
        import uvicorn
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", "uvicorn[standard]"])
        import uvicorn

    app = _create_app(args.model, device)
    uvicorn.run(app, host="0.0.0.0", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
