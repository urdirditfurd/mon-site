"""
Interface Gradio Wan 2.1 — Snapdragon X Elite / sans NVIDIA.
Contournement Pinokio : CPU ARM local (0 €) ou lien Colab GPU gratuit.
"""

from __future__ import annotations

import os
import time
import uuid
from pathlib import Path

import gradio as gr

from wan_engine import (
    RESOLUTION_PRESETS,
    check_environment,
    format_check_message,
    generate_video,
    platform_profile,
)

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "outputs"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

COLAB_URL = os.environ.get(
    "WAN_SNAPDRAGON_COLAB_URL",
    "https://colab.research.google.com/github/urdirditfurd/mon-site/blob/main/colab/text-to-video-gratuit.ipynb",
)

_env = check_environment()
_IS_SNAPDRAGON = platform_profile()["snapdragon"]


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

    if _IS_SNAPDRAGON:
        num_frames = min(int(num_frames), 49)
        steps = min(int(steps), 24)

    out_name = f"wan_{int(time.time())}_{uuid.uuid4().hex[:8]}.mp4"
    out_path = OUTPUT_DIR / out_name
    cache_dir = os.environ.get("WAN_MODEL_CACHE") or str(Path(__file__).resolve().parent.parent / "models")

    def on_progress(value: float, desc: str):
        progress(value, desc=desc)

    result = generate_video(
        prompt=prompt,
        output_path=str(out_path),
        resolution_key=resolution,
        num_frames=int(num_frames),
        fps=16,
        steps=int(steps),
        seed=int(seed) if seed and int(seed) > 0 else None,
        cache_dir=cache_dir,
        progress_callback=on_progress,
    )

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
                        num_frames = gr.Slider(17, 81, value=49, step=4, label="Frames (pair+1)")
                        steps = gr.Slider(12, 40, value=24, step=1, label="Steps")
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
    port = int(os.environ.get("GRADIO_SERVER_PORT", "7860"))
    demo.queue(default_concurrency_limit=1).launch(
        server_name=os.environ.get("GRADIO_SERVER_NAME", "127.0.0.1"),
        server_port=port,
        share=os.environ.get("GRADIO_SHARE", "").lower() in ("1", "true", "yes"),
        show_error=True,
    )
