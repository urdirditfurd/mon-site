# Checklist modèles sur le Pod ComfyUI

Une fois ComfyUI ouvert (`…-8188.proxy.runpod.net`) :

## 1. ComfyUI Manager
- Manager → Install Missing Custom Nodes (si demandé)
- Redémarrer ComfyUI si besoin

## 2. Modèles vidéo prioritaires
Installer via Manager / Hugging Face (sur le volume `/workspace`) :

### LTX-2.3 (recommandé volume)
- Checkpoint distilled FP8 (24 Go VRAM OK sur 4090)
- Text encoder Gemma associé (quantisé FP4/FP8)
- Workflows LTX image-to-video

### Wan 2.2 (option qualité / styles)
- Wan 2.2 I2V ou T2V selon workflow
- VAE + text encoder requis par le workflow

### Images clés (storyboard)
- Flux ou SDXL selon style (anime / fantasy / ciné)

## 3. Workflow production
Voir `runpod/workflows/README.md`

## 4. Persistance
Créer un Network Volume RunPod dans le **même datacenter** que le GPU,
le monter sur `/workspace`, pour garder modèles + outputs entre sessions.
