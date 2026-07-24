"""Gradio lip-sync — image + audio → MP4 (port 7870)."""

from __future__ import annotations

import os
from pathlib import Path

import gradio as gr

from lipsync_engine import generate_video

PORT = int(os.environ.get("GRADIO_SERVER_PORT", "7870"))


def run(image, audio, prompt=""):
    if image is None or audio is None:
        raise gr.Error("Image et audio requis")
    out = Path(__file__).resolve().parent / "outputs"
    out.mkdir(parents=True, exist_ok=True)
    dest = out / f"talk_{Path(str(audio)).stem}.mp4"
    result = generate_video(
        image=str(image),
        audio=str(audio),
        output_path=str(dest),
        prompt=prompt or "",
        fps=24,
    )
    return str(result["outputPath"]), result.get("mode", "?")


demo = gr.Interface(
    fn=run,
    inputs=[
        gr.Image(type="filepath", label="Portrait personnage"),
        gr.Audio(type="filepath", label="Audio replique"),
        gr.Textbox(
            label="Prompt motion",
            value="The character is talking happily, subtle head movement, blinking naturally",
        ),
    ],
    outputs=[
        gr.Video(label="Clip lip-sync"),
        gr.Textbox(label="Mode"),
    ],
    title="video ia — Lip-sync (Wav2Lip / fallback)",
    description="Gratuit local. Installe Wav2Lip+checkpoint pour vraie bouche sync.",
)

if __name__ == "__main__":
    import socket
    import sys
    import urllib.request

    def _port_open(host: str, port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.5)
            return sock.connect_ex((host, port)) == 0

    def _http_ok(url: str) -> bool:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                return 200 <= int(resp.status) < 500
        except Exception:
            return False

    if _http_ok(f"http://127.0.0.1:{PORT}/"):
        print(f"Lip-sync deja pret sur http://127.0.0.1:{PORT} — rien a relancer.")
        sys.exit(0)

    if _port_open("127.0.0.1", PORT):
        print(
            f"Port {PORT} occupe par un autre processus. "
            f"Ferme l'ancienne fenetre lip-sync ou: "
            f"netstat -ano | findstr :{PORT}"
        )
        sys.exit(2)

    demo.queue(default_concurrency_limit=1).launch(
        server_name="127.0.0.1",
        server_port=PORT,
        share=False,
    )
