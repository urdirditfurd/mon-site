"""Gradio I2V rapide — LTX / Wan 1.3B (port 7861). API explicite /generate."""

from __future__ import annotations

import os
import time
import uuid
from pathlib import Path

import gradio as gr

from i2v_engine import MAX_FRAMES, MAX_STEPS, check_environment, generate_i2v

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "outputs"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PORT = int(os.environ.get("GRADIO_SERVER_PORT", "7861"))


def run(image, prompt, num_frames, steps, seed, progress=gr.Progress()):
    if image is None:
        raise gr.Error("Image de depart requise")
    prompt = (prompt or "").strip() or (
        "cute Pixar 3D character, natural movement, breathing, blinking, "
        "gentle head tilt, cinematic camera pan, lively background"
    )
    out = OUTPUT_DIR / f"i2v_{int(time.time())}_{uuid.uuid4().hex[:8]}.mp4"
    cache = os.environ.get("WAN_MODEL_CACHE") or str(
        Path(__file__).resolve().parent.parent / "models"
    )

    def on_progress(value: float, desc: str):
        progress(value, desc=desc)

    result = generate_i2v(
        image_path=str(image),
        prompt=prompt,
        output_path=str(out),
        resolution_key="480p 16:9",
        num_frames=int(num_frames or 81),
        fps=24,
        steps=int(steps or 16),
        seed=int(seed) if seed is not None else None,
        cache_dir=cache,
        progress_callback=on_progress,
    )
    return (
        str(result["outputPath"]),
        f"{result.get('backend')}/{result.get('mode')}",
        f"{result.get('seconds')}s · {result.get('clipDurationSec')}s clip",
    )


_env = check_environment()
_header = (
    f"### video ia — I2V RAPIDE (cible <2 min/scene)\n"
    f"Backend: `{_env.get('backendDefault')}` · GPU: {_env.get('gpu') or _env.get('device')} · "
    f"VRAM {_env.get('vramFreeGb')}/{_env.get('vramTotalGb')} Go · "
    f"{_env.get('maxSteps')} steps · {_env.get('resolution')} · {_env.get('maxFrames')} frames\n"
    f"**API:** `/generate` · lowvram + SDPA — upscale 1080p au montage."
)

with gr.Blocks(title="video ia — I2V Fast") as demo:
    gr.Markdown(_header)
    with gr.Row():
        image = gr.Image(type="filepath", label="Image scene (storyboard)")
        with gr.Column():
            prompt = gr.Textbox(
                label="Prompt motion",
                value=(
                    "cute Pixar style character speaking happily, natural movement, "
                    "breathing, blinking eyes, gentle head tilt, cinematic camera pan, "
                    "lively background, smooth animation"
                ),
            )
            num_frames = gr.Slider(
                17, 97, value=min(81, MAX_FRAMES), step=8, label="Frames (81 ~ 3.4s @24fps)"
            )
            steps = gr.Slider(8, 20, value=min(16, MAX_STEPS), step=1, label="Steps (max 20)")
            seed = gr.Number(value=42, label="Seed", precision=0)
            btn = gr.Button("Generer clip I2V", variant="primary")
    video = gr.Video(label="Clip I2V anime")
    mode = gr.Textbox(label="Backend")
    timing = gr.Textbox(label="Temps")
    # api_name="run" = compatible Gradio+queue (observe sur Windows)
    btn.click(
        fn=run,
        inputs=[image, prompt, num_frames, steps, seed],
        outputs=[video, mode, timing],
        api_name="run",
    )

if __name__ == "__main__":
    import socket
    import sys
    import urllib.request

    def _http_ok(url: str) -> bool:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                return 200 <= int(resp.status) < 500
        except Exception:
            return False

    def _port_open(host: str, port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.5)
            return sock.connect_ex((host, port)) == 0

    if _http_ok(f"http://127.0.0.1:{PORT}/"):
        print(f"I2V deja pret sur http://127.0.0.1:{PORT}")
        sys.exit(0)
    if _port_open("127.0.0.1", PORT):
        print(f"Port {PORT} occupe — ferme l'ancienne instance I2V.")
        sys.exit(2)

    demo.queue(default_concurrency_limit=1).launch(
        server_name="127.0.0.1",
        server_port=PORT,
        share=False,
    )
