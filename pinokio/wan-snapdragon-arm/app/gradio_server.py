"""
Interface Gradio Wan 2.1 — NVIDIA CUDA ou CPU/Snapdragon.
"""

from __future__ import annotations

import os
import time
import traceback
import uuid
from pathlib import Path

import gradio as gr
import torch

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
_HAS_CUDA = bool(_env.get("cuda")) or torch.cuda.is_available()
_IS_SNAPDRAGON = is_snapdragon_pc() and not _HAS_CUDA
_GPU_NAME = ""
if _HAS_CUDA:
    try:
        _GPU_NAME = torch.cuda.get_device_name(0)
    except Exception:
        _GPU_NAME = "NVIDIA GPU"


def _status_header() -> str:
    if _HAS_CUDA:
        mode = f"NVIDIA CUDA — {_GPU_NAME}"
        tip = (
            "**Mode GPU actif.** Sur RTX 3080, compte ~30 s à 2 min par clip court. "
            "Tu peux monter Frames jusqu’à 49."
        )
    elif _IS_SNAPDRAGON:
        mode = "Snapdragon X Elite (CPU ARM)"
        tip = "**Astuce :** génération locale = 5–15 min/scène. Pour aller vite : onglet **Colab gratuit**."
    else:
        mode = "CPU (sans GPU détecté)"
        tip = "**Astuce :** sans NVIDIA local, préfère Colab GPU ou une carte NVIDIA."
    return (
        f"### Wan 2.1 T2V 1.3B — mode {mode}\n"
        f"```\n{format_check_message()}\n```\n"
        f"{tip}"
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

    # Limites CPU / Snapdragon seulement
    if _IS_SNAPDRAGON or not _HAS_CUDA:
        num_frames = min(int(num_frames), 33)
        steps = min(int(steps), 20)

    nf = int(num_frames)
    if nf % 4 != 1:
        nf = max(17, (nf // 4) * 4 + 1)

    out_name = f"wan_{int(time.time())}_{uuid.uuid4().hex[:8]}.mp4"
    out_path = OUTPUT_DIR / out_name
    cache_dir = os.environ.get("WAN_MODEL_CACHE") or str(
        Path(__file__).resolve().parent.parent / "models"
    )

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

    return (
        str(out_path),
        f"OK — {result['device']} — {result['width']}x{result['height']} — {result['numFrames']} frames",
    )


_title = "Wan 2.1 NVIDIA" if _HAS_CUDA else "Wan 2.1 (CPU / Snapdragon)"
_heading = (
    f"# Wan 2.1 — NVIDIA ({_GPU_NAME})"
    if _HAS_CUDA
    else "# Wan 2.1 — mode CPU / Snapdragon"
)
_local_help = (
    f"Génération **locale sur {_GPU_NAME}** (CUDA). "
    "Première génération = téléchargement du modèle (~3–5 Go)."
    if _HAS_CUDA
    else "Génération locale CPU. Plus lent — branche le secteur. Colab = plus rapide."
)
_default_frames = 49 if _HAS_CUDA else 33
_default_steps = 24 if _HAS_CUDA else 20

with gr.Blocks(title=_title, theme=gr.themes.Soft()) as demo:
    gr.Markdown(_heading)
    gr.Markdown(_status_header())

    with gr.Tabs():
        with gr.Tab("Text to Video (local)"):
            gr.Markdown(_local_help)
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
                        num_frames = gr.Slider(
                            17, 49, value=_default_frames, step=4, label="Frames (4n+1)"
                        )
                        steps = gr.Slider(
                            12, 30 if _HAS_CUDA else 24, value=_default_steps, step=1, label="Steps"
                        )
                    seed = gr.Number(label="Seed (0 = aléatoire)", value=0, precision=0)
                    btn = gr.Button("Générer la vidéo", variant="primary")
                with gr.Column(scale=2):
                    status = gr.Textbox(label="Statut", interactive=False)
                    video = gr.Video(label="Résultat")

            btn.click(
                fn=run_generation,
                inputs=[prompt, resolution, num_frames, steps, seed],
                outputs=[video, status],
            )

        with gr.Tab("Colab gratuit (GPU cloud)"):
            gr.Markdown(
                f"""
### Option cloud (si besoin)

Utile surtout **sans** carte NVIDIA locale.

1. Lien ci-dessous → Google Colab  
2. Exécution → GPU T4 → Tout exécuter  

[{COLAB_URL}]({COLAB_URL})
"""
            )
            gr.HTML(
                f'<a href="{COLAB_URL}" target="_blank" '
                f'style="display:inline-block;padding:12px 24px;background:#f9ab00;color:#000;'
                f'border-radius:8px;font-weight:bold;text-decoration:none;">'
                f"Ouvrir Colab Wan 2.1</a>"
            )

        with gr.Tab("À propos"):
            gr.Markdown(
                """
| Mode | Vitesse |
|------|---------|
| **NVIDIA local (ton cas)** | Rapide |
| CPU / Snapdragon | Lent |
| Colab T4 | Moyen / gratuit |

Variables optionnelles : `HF_TOKEN`, `WAN_MODEL_CACHE`, `GRADIO_SERVER_PORT`
"""
            )

if __name__ == "__main__":
    port = int(os.environ.get("GRADIO_SERVER_PORT", "7860"))
    demo.queue(default_concurrency_limit=1).launch(
        server_name=os.environ.get("GRADIO_SERVER_NAME", "127.0.0.1"),
        server_port=port,
        share=os.environ.get("GRADIO_SHARE", "").lower() in ("1", "true", "yes"),
        show_error=True,
    )
