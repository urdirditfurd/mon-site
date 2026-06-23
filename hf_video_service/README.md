# HF Video Service

Microservice FastAPI pour servir un modele text-to-video Hugging Face en local au backend Node.js de ClipForge/VOANH.

## Pourquoi ce service

- charge le pipeline Diffusers une seule fois en memoire
- expose une API HTTP simple pour le backend Node
- permet de privilegier un moteur local auto-heberge pour la production en volume
- garde FAL.ai comme fallback cloud, sans bloquer le projet dessus

## Modeles recommandes

- `SulphurAI/Sulphur-2-base` : meilleur compromis debit / qualite / scenes longues
- `Wan-AI/Wan2.1-T2V-1.3B-Diffusers` : option legere pour GPU plus modestes
- `Wan-AI/Wan2.2-T2V-A14B-Diffusers` : qualite maximale si VRAM abondante

## Installation

1. Creez un environnement Python dedie.
2. Installez PyTorch avec la roue adaptee a votre GPU/CUDA.
3. Installez les dependances du service.

Exemple :

```bash
python3 -m venv .venv-hf-video
source .venv-hf-video/bin/activate
pip install --upgrade pip
# Installer ici la bonne roue torch/torchvision selon votre GPU
pip install -r hf_video_service/requirements.txt
```

## Lancement

```bash
source .venv-hf-video/bin/activate
export HF_VIDEO_DEVICE=cuda
export HF_VIDEO_TORCH_DTYPE=bfloat16
export HF_VIDEO_ALLOW_REMOTE_CODE=true
export HF_VIDEO_SERVICE_TOKEN="change-me"
uvicorn hf_video_service.app:app --host 0.0.0.0 --port 7861
```

## Variables utiles

- `HF_VIDEO_SERVICE_TOKEN` : protege l'API locale si vous exposez le service au reseau
- `HF_VIDEO_DEVICE` : `cuda`, `cuda:0`, `cpu`, etc.
- `HF_VIDEO_TORCH_DTYPE` : `bfloat16`, `float16`, `float32`
- `HF_VIDEO_ALLOW_REMOTE_CODE` : `true` / `false`
- `HF_VIDEO_MAX_CONCURRENCY` : nombre max de generations simultanees

## Integration backend Node

Le backend principal attend ces variables d'environnement :

```bash
export VIDEO_PROVIDER=huggingface-local
export HF_VIDEO_SERVICE_URL=http://127.0.0.1:7861
export HF_VIDEO_SERVICE_TOKEN=change-me
export HF_VIDEO_DEFAULT_MODEL=SulphurAI/Sulphur-2-base
```

Une fois ces variables definies :

- les shorts IA utilisent le provider HF local par defaut
- le studio long format VOANH utilise aussi HF local par defaut
- FAL reste disponible comme fallback manuel dans l'interface
