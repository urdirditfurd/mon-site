import json
import os
import sys


def emit_error(message: str) -> None:
    sys.stderr.write(f"{message}\n")
    sys.stderr.flush()


def load_payload() -> dict:
    raw = sys.stdin.read()
    if not raw.strip():
        raise ValueError("Payload JSON manquant sur stdin.")
    return json.loads(raw)


def choose_dtype(torch_module, device: str):
    if device != "cuda":
        return torch_module.float32
    if hasattr(torch_module, "bfloat16"):
        return torch_module.bfloat16
    return torch_module.float16


def load_pipeline(model_id: str, torch_module, dtype, hf_token: str):
    model_key = model_id.lower()

    if "wan" in model_key:
        from diffusers import AutoencoderKLWan, WanPipeline

        vae = AutoencoderKLWan.from_pretrained(
            model_id,
            subfolder="vae",
            torch_dtype=torch_module.float32,
            token=hf_token or None,
        )
        pipe = WanPipeline.from_pretrained(
            model_id,
            vae=vae,
            torch_dtype=dtype,
            token=hf_token or None,
        )
        return pipe

    if "ltx" in model_key or "sulphur" in model_key:
        from diffusers import LTXPipeline

        return LTXPipeline.from_pretrained(
            model_id,
            torch_dtype=dtype,
            token=hf_token or None,
        )

    from diffusers import DiffusionPipeline

    return DiffusionPipeline.from_pretrained(
        model_id,
        torch_dtype=dtype,
        token=hf_token or None,
    )


def main() -> int:
    try:
        payload = load_payload()
    except Exception as exc:  # pragma: no cover - startup guard
        emit_error(f"Chargement payload impossible: {exc}")
        return 2

    try:
        import torch
        from diffusers.utils import export_to_video
    except Exception as exc:  # pragma: no cover - dependency guard
        emit_error(
            "Dépendances Python manquantes pour la génération vidéo Hugging Face. "
            f"Erreur: {exc}"
        )
        return 3

    model_id = str(payload.get("model_id") or "").strip()
    prompt = str(payload.get("prompt") or "").strip()
    output_path = str(payload.get("output_path") or "").strip()
    negative_prompt = str(payload.get("negative_prompt") or "").strip()
    hf_token = str(payload.get("hf_token") or os.environ.get("HF_TOKEN") or "").strip()

    if not model_id:
        emit_error("model_id requis.")
        return 4
    if not prompt:
        emit_error("prompt requis.")
        return 4
    if not output_path:
        emit_error("output_path requis.")
        return 4

    width = int(payload.get("width") or 480)
    height = int(payload.get("height") or 832)
    fps = int(payload.get("fps") or 15)
    num_frames = int(payload.get("num_frames") or 81)
    num_inference_steps = int(payload.get("num_inference_steps") or 24)
    guidance_scale = float(payload.get("guidance_scale") or 5.5)
    seed = int(payload.get("seed") or 1)
    enable_model_cpu_offload = bool(payload.get("enable_model_cpu_offload"))

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = choose_dtype(torch, device)

    try:
        pipe = load_pipeline(model_id, torch, dtype, hf_token)
        if device == "cuda":
            if enable_model_cpu_offload and hasattr(pipe, "enable_model_cpu_offload"):
                pipe.enable_model_cpu_offload()
            else:
                pipe.to("cuda")
        elif hasattr(pipe, "to"):
            pipe.to(device)

        generator_device = "cuda" if device == "cuda" else "cpu"
        generator = torch.Generator(generator_device).manual_seed(seed)

        result = pipe(
            prompt=prompt,
            negative_prompt=negative_prompt,
            width=width,
            height=height,
            num_frames=num_frames,
            num_inference_steps=num_inference_steps,
            guidance_scale=guidance_scale,
            generator=generator,
        )

        frames = result.frames[0] if hasattr(result, "frames") else result.images
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        export_to_video(frames, output_path, fps=fps)

        sys.stdout.write(
            json.dumps(
                {
                    "ok": True,
                    "model_id": model_id,
                    "output_path": output_path,
                    "fps": fps,
                    "num_frames": num_frames,
                    "device": device,
                }
            )
        )
        sys.stdout.flush()
        return 0
    except Exception as exc:  # pragma: no cover - runtime guard
        emit_error(f"Génération Hugging Face impossible: {exc}")
        return 5


if __name__ == "__main__":
    raise SystemExit(main())
