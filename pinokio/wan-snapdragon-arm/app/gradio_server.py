"""
Interface Gradio Wan 2.1 — Snapdragon X Elite / sans NVIDIA.
Contournement Pinokio : CPU ARM local (0 €) ou lien Colab GPU gratuit.
"""

from __future__ import annotations

import os
import time
import traceback
import uuid
from pathlib import Path

import gradio as gr

from wan_engine import (
    RESOLUTION_PRESETS,
    check_environment,
    format_check_message,
    generate_video,
    is_snapdragon_pc,
)

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "outputs"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

COLAB_URL = os.environ.get(
    "WAN_SNAPDRAGON_COLAB_URL",
    "https://colab.research.google.com/github/urdirditfurd/mon-site/blob/main/colab/text-to-video-gratuit.ipynb",
)

_env = check_environment()
_IS_SNAPDRAGON = is_snapdragon_pc()


def _status_header() -> str:
    mode = "Snapdragon X Elite (CPU ARM)" if _IS_SNAPDRAGON else "CPU / sans NVIDIA"
    return (
        f"### Wan 2.1 T2V 1.3B — mode {mode}\n"
        f"```\n{format_check_message()}\n```\n"
        "**Astuce :** génération locale = 5–15 min/scène. Pour aller vite : onglet **Colab gratuit**."
    )


def run_generation(
    prompt: str,
    resolution: str,
    num_frames: int,
    steps: int,
    seed: int,
    progress=gr.Progress(),
):
    prompt = (prompt or "").strip()
    if not prompt:
        raise gr.Error("Entrez un prompt.")

    if is_snapdragon_pc():
        num_frames = min(int(num_frames), 33)
        steps = min(int(steps), 20)

    # Wan exige un nombre de frames 4n+1
    nf = int(num_frames)
    if nf % 4 != 1:
        nf = max(17, (nf // 4) * 4 + 1)

    out_name = f"wan_{int(time.time())}_{uuid.uuid4().hex[:8]}.mp4"
    out_path = OUTPUT_DIR / out_name
    cache_dir = os.environ.get("WAN_MODEL_CACHE") or str(Path(__file__).resolve().parent.parent / "models")

    def on_progress(value: float, desc: str):
        progress(value, desc=desc)

    try:
        result = generate_video(
            prompt=prompt,
            output_path=str(out_path),
            resolution_key=resolution,
            num_frames=nf,
            fps=16,
            steps=int(steps),
            seed=int(seed) if seed and int(seed) > 0 else None,
            cache_dir=cache_dir,
            progress_callback=on_progress,
        )
    except Exception as exc:
        detail = traceback.format_exc()
        raise gr.Error(f"{exc}\n\n--- détail ---\n{detail}") from exc

    return str(out_path), f"OK — {result['device']} — {result['width']}x{result['height']} — {result['numFrames']} frames"


with gr.Blocks(title="Wan Snapdragon — Pinokio", theme=gr.themes.Soft()) as demo:
    gr.Markdown("# Wan 2.1 sur Snapdragon — sans NVIDIA")
    gr.Markdown(_status_header())

    with gr.Tabs():
        with gr.Tab("Text to Video (local)"):
            gr.Markdown(
                "Génération **100 % gratuite** sur votre Surface. "
                "Branchez le secteur : la génération utilise le CPU (pas le NPU pour l'instant)."
            )
            with gr.Row():
                with gr.Column(scale=2):
                    prompt = gr.Textbox(
                        label="Prompt",
                        lines=6,
                        placeholder="Un chat orange marche sur la plage au coucher du soleil, cinématique…",
                    )
                    resolution = gr.Dropdown(
                        label="Résolution",
                        choices=list(RESOLUTION_PRESETS.keys()),
                        value="480p 16:9",
                    )
                    with gr.Row():
                        num_frames = gr.Slider(17, 49, value=33, step=4, label="Frames (4n+1, ex. 33)")
                        steps = gr.Slider(12, 24, value=20, step=1, label="Steps")
                    seed = gr.Number(label="Seed (0 = aléatoire)", value=0, precision=0)
                    btn = gr.Button("Générer la vidéo", variant="primary")
                with gr.Column(scale=2):
                    status = gr.Textbox(label="Statut", interactive=False)
                    video = gr.Video(label="Résultat")

            btn.click(
                fn=run_generation,
                inputs=[prompt, resolution, num_frames, steps, seed],
                outputs=[video, status],
                api_name="generate",
            )

        with gr.Tab("Colab gratuit (GPU cloud)"):
            gr.Markdown(
                f"""
### Détour technique recommandé pour la vitesse

1. Cliquez le lien ci-dessous → ouvre Google Colab
2. **Exécution → Modifier le type d'exécution → GPU (T4)**
3. **Exécution → Tout exécuter**
4. Collez votre prompt dans le notebook
5. Téléchargez le MP4 généré

C'est le même modèle **Wan 2.1 1.3B**, mais le GPU NVIDIA est **dans le cloud** (gratuit).

[{COLAB_URL}]({COLAB_URL})
"""
            )
            gr.HTML(
                f'<a href="{COLAB_URL}" target="_blank" '
                f'style="display:inline-block;padding:12px 24px;background:#f9ab00;color:#000;'
                f'border-radius:8px;font-weight:bold;text-decoration:none;">'
                f"Ouvrir Colab Wan 2.1 (gratuit)</a>"
            )

        with gr.Tab("À propos"):
            gr.Markdown(
                """
**Pourquoi pas Wan2GP classique ?**  
Wan2GP officiel exige CUDA NVIDIA. Ce script Pinokio est un **pont** pour Snapdragon :

| Mode | Coût | Vitesse |
|------|------|---------|
| Local CPU ARM | 0 € | Lent (5–15 min/scène) |
| Google Colab T4 | 0 € | Rapide (~2–5 min/scène) |
| FAL.ai (optionnel) | Crédits offerts | Très rapide |

**Variables d'environnement (optionnel) :**
- `HF_TOKEN` — accès Hugging Face si modèle gated
- `WAN_MODEL_CACHE` — dossier cache modèles
- `WAN_SNAPDRAGON_COLAB_URL` — lien notebook personnalisé
"""
            )

if __name__ == "__main__":
    import json
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from urllib.parse import parse_qs, urlparse

    port = int(os.environ.get("GRADIO_SERVER_PORT", "7860"))
    http_port = int(os.environ.get("WAN_HTTP_PORT", str(port + 7)))
    host = os.environ.get("GRADIO_SERVER_NAME", "127.0.0.1")

    class WanHttpApi(BaseHTTPRequestHandler):
        """API HTTP stable pour ClipForge /video-ia-qwen (sans clé, local)."""

        def log_message(self, fmt: str, *args) -> None:
            return

        def _send(self, code: int, payload: dict, content_type: str = "application/json"):
            body = json.dumps(payload).encode("utf-8") if content_type == "application/json" else payload
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()

        def do_GET(self):
            parsed = urlparse(self.path)
            if parsed.path in ("/health", "/api/health"):
                self._send(200, {"ok": True, "engine": "wan-snapdragon", "gradioPort": port})
                return
            if parsed.path == "/api/download":
                qs = parse_qs(parsed.query)
                file_path = (qs.get("path") or [""])[0]
                if not file_path or ".." in file_path:
                    self._send(400, {"error": "path invalide"})
                    return
                target = Path(file_path).resolve()
                if not str(target).startswith(str(OUTPUT_DIR.resolve())) or not target.is_file():
                    self._send(404, {"error": "fichier introuvable"})
                    return
                data = target.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            self._send(404, {"error": "not found"})

        def do_POST(self):
            parsed = urlparse(self.path)
            if parsed.path not in ("/api/t2v", "/generate"):
                self._send(404, {"error": "not found"})
                return
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            try:
                body = json.loads(raw.decode("utf-8") or "{}")
            except json.JSONDecodeError:
                self._send(400, {"error": "JSON invalide"})
                return

            prompt = str(body.get("prompt") or "").strip()
            if not prompt:
                self._send(400, {"error": "prompt requis"})
                return

            aspect = str(body.get("aspectRatio") or "16:9")
            resolution = {
                "16:9": "480p 16:9",
                "9:16": "480p 9:16",
                "1:1": "480p 1:1",
            }.get(aspect, "480p 16:9")

            duration = float(body.get("durationSec") or 3)
            # 16 fps ; Wan Snapdragon plafonne à 33 frames (~2 s)
            frames = int(round(duration * 16))
            frames = max(17, min(33, frames))
            if frames % 4 != 1:
                frames = max(17, (frames // 4) * 4 + 1)

            out_name = f"wan_api_{int(time.time())}_{uuid.uuid4().hex[:8]}.mp4"
            out_path = OUTPUT_DIR / out_name
            cache_dir = os.environ.get("WAN_MODEL_CACHE") or str(
                Path(__file__).resolve().parent.parent / "models"
            )

            try:
                result = generate_video(
                    prompt=prompt,
                    output_path=str(out_path),
                    resolution_key=resolution,
                    num_frames=frames,
                    fps=16,
                    steps=int(body.get("steps") or 20),
                    seed=int(body["seed"]) if body.get("seed") else None,
                    cache_dir=cache_dir,
                )
            except Exception as exc:
                self._send(500, {"error": str(exc)})
                return

            download = f"http://{host}:{http_port}/api/download?path={out_path}"
            self._send(
                200,
                {
                    "ok": True,
                    "path": str(out_path),
                    "downloadUrl": download,
                    "width": result.get("width"),
                    "height": result.get("height"),
                    "numFrames": result.get("numFrames"),
                    "device": result.get("device"),
                },
            )

    def _serve_http():
        server = ThreadingHTTPServer((host, http_port), WanHttpApi)
        print(f"[wan-http] API locale http://{host}:{http_port}/api/t2v (health /api/health)")
        server.serve_forever()

    threading.Thread(target=_serve_http, daemon=True).start()

    demo.queue(default_concurrency_limit=1).launch(
        server_name=host,
        server_port=port,
        share=os.environ.get("GRADIO_SHARE", "").lower() in ("1", "true", "yes"),
        show_error=True,
    )
