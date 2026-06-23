#!/usr/bin/env python3
import gc
import inspect
import json
import os
import sys
import time
import traceback
from typing import Any, Dict, Optional


DEFAULT_MODEL_ID = os.environ.get("HF_T2V_MODEL", "Wan-AI/Wan2.1-T2V-1.3B-Diffusers")


def _write_message(payload: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


class WorkerState:
    def __init__(self) -> None:
        self.torch = None
        self.pipeline = None
        self.pipeline_signature = None
        self.model_id = ""
        self.device = "cpu"
        self.diffusers = None
        self.export_to_video = None

    def ensure_imports(self) -> None:
        if self.torch is not None:
            return

        try:
            import torch
            from diffusers import DiffusionPipeline
            from diffusers.utils import export_to_video
        except Exception as err:  # pragma: no cover
            raise RuntimeError(
                "Dépendances HF manquantes. Installez: "
                "pip3 install --break-system-packages 'torch>=2.3' 'diffusers>=0.35.0' "
                "'transformers>=4.48.0' 'accelerate>=1.9.0' 'safetensors>=0.6.0' "
                "'sentencepiece>=0.2.0' 'imageio[ffmpeg]>=2.37.0'"
            ) from err

        self.torch = torch
        self.diffusers = DiffusionPipeline
        self.export_to_video = export_to_video
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

    def _teardown_pipeline(self) -> None:
        if self.pipeline is not None:
            self.pipeline = None
            self.pipeline_signature = None
            gc.collect()
            if self.torch is not None and self.torch.cuda.is_available():
                self.torch.cuda.empty_cache()

    def load_model(self, model_id: str) -> None:
        self.ensure_imports()
        target_model_id = (model_id or DEFAULT_MODEL_ID).strip()
        if self.pipeline is not None and self.model_id == target_model_id:
            return

        self._teardown_pipeline()
        dtype = self.torch.float16 if self.device == "cuda" else self.torch.float32
        base_kwargs: Dict[str, Any] = {
            "torch_dtype": dtype,
            "trust_remote_code": True,
        }

        pipeline = None
        if self.device == "cuda":
            try:
                pipeline = self.diffusers.from_pretrained(target_model_id, variant="fp16", **base_kwargs)
            except Exception:
                pipeline = self.diffusers.from_pretrained(target_model_id, **base_kwargs)
        else:
            pipeline = self.diffusers.from_pretrained(target_model_id, **base_kwargs)

        if self.device == "cuda":
            pipeline = pipeline.to("cuda")
        else:
            pipeline = pipeline.to("cpu")

        if hasattr(pipeline, "enable_attention_slicing"):
            pipeline.enable_attention_slicing()
        if hasattr(pipeline, "vae") and hasattr(pipeline.vae, "enable_slicing"):
            pipeline.vae.enable_slicing()
        if hasattr(pipeline, "set_progress_bar_config"):
            pipeline.set_progress_bar_config(disable=True)

        self.pipeline = pipeline
        self.pipeline_signature = inspect.signature(self.pipeline.__call__)
        self.model_id = target_model_id

    def _build_call_kwargs(self, req: Dict[str, Any]) -> Dict[str, Any]:
        kwargs: Dict[str, Any] = {}
        parameters = self.pipeline_signature.parameters

        prompt = str(req.get("prompt") or "").strip()
        if not prompt:
            raise ValueError("prompt requis")

        negative_prompt = str(req.get("negativePrompt") or "").strip()
        num_inference_steps = max(8, min(80, int(req.get("numInferenceSteps") or 30)))
        guidance_scale = float(req.get("guidanceScale") or 5.0)
        fps = max(4, min(24, int(req.get("fps") or 12)))
        num_frames = int(req.get("numFrames") or max(16, min(240, fps * int(req.get("durationSec") or 6))))
        width = int(req.get("width") or 832)
        height = int(req.get("height") or 480)
        seed = req.get("seed")

        kwargs["prompt"] = prompt

        if "negative_prompt" in parameters and negative_prompt:
            kwargs["negative_prompt"] = negative_prompt
        if "num_inference_steps" in parameters:
            kwargs["num_inference_steps"] = num_inference_steps
        if "guidance_scale" in parameters:
            kwargs["guidance_scale"] = guidance_scale
        if "num_frames" in parameters:
            kwargs["num_frames"] = num_frames
        elif "video_length" in parameters:
            kwargs["video_length"] = num_frames
        if "height" in parameters:
            kwargs["height"] = height
        if "width" in parameters:
            kwargs["width"] = width

        if seed is not None and "generator" in parameters:
            seed_value = int(seed)
            kwargs["generator"] = self.torch.Generator(device=self.device).manual_seed(seed_value)

        kwargs["_meta"] = {
            "fps": fps,
            "numFrames": num_frames,
            "steps": num_inference_steps,
            "guidanceScale": guidance_scale,
            "width": width,
            "height": height,
        }
        return kwargs

    def generate(self, req: Dict[str, Any]) -> Dict[str, Any]:
        output_path = str(req.get("outputPath") or "").strip()
        if not output_path:
            raise ValueError("outputPath requis")

        model_id = str(req.get("modelId") or DEFAULT_MODEL_ID).strip()
        self.load_model(model_id)

        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        kwargs = self._build_call_kwargs(req)
        meta = kwargs.pop("_meta")

        started_at = time.time()
        result = self.pipeline(**kwargs)
        frames = result.frames
        if isinstance(frames, list) and frames and isinstance(frames[0], list):
            frames = frames[0]
        self.export_to_video(frames, output_path, fps=meta["fps"])
        elapsed_ms = int((time.time() - started_at) * 1000)

        return {
            "outputPath": output_path,
            "modelId": model_id,
            "device": self.device,
            "elapsedMs": elapsed_ms,
            **meta,
        }


def main() -> int:
    worker = WorkerState()

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        request_id: Optional[str] = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            action = str(request.get("action") or "generate")

            if action == "ping":
                _write_message({"id": request_id, "ok": True, "result": {"status": "ready"}})
                continue

            if action == "shutdown":
                _write_message({"id": request_id, "ok": True, "result": {"status": "bye"}})
                return 0

            if action != "generate":
                raise ValueError(f"Action inconnue: {action}")

            result = worker.generate(request)
            _write_message({"id": request_id, "ok": True, "result": result})
        except Exception as err:
            _write_message(
                {
                    "id": request_id,
                    "ok": False,
                    "error": str(err),
                    "trace": traceback.format_exc(limit=2),
                }
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
