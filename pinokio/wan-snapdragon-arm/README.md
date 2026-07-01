# Wan 2.1 sur Snapdragon — Pinokio sans NVIDIA

Application Pinokio pour **Surface Copilot+ / Snapdragon X Elite** et tout PC **sans GPU NVIDIA**.

## Ce que ça fait

| Bouton Pinokio | Action |
|----------------|--------|
| **Install** | PyTorch **CPU ARM64** (pas CUDA) + Wan 2.1 1.3B |
| **Run** | Interface Gradio (style Wan2GP) sur `http://127.0.0.1:7860` |
| **Colab GPU gratuit** | Ouvre le notebook Wan 2.1 avec GPU T4 cloud |
| **Check** | Vérifie PyTorch / diffusers |

## Installation dans Pinokio (Surface Snapdragon)

1. Ouvrez **Pinokio** → **Discover** ou **+ Custom URL**
2. Collez l’URL du dossier :
   ```
   https://github.com/urdirditfurd/mon-site/tree/main/pinokio/wan-snapdragon-arm
   ```
   Ou copiez le dossier `pinokio/wan-snapdragon-arm` dans :
   ```
   C:\pinokio\api\wan-snapdragon-arm.git\
   ```
3. Cliquez **Install** (10–20 min la 1ère fois — téléchargement modèle ~3–5 Go)
4. Cliquez **Run** → interface Wan dans le navigateur

## Modes de génération

### Mode A — Local gratuit (CPU ARM)
- 0 €, tout sur votre Surface
- ~5–15 min par clip court (480p, 49 frames)
- Branchez le secteur

### Mode B — Colab gratuit (recommandé pour la vitesse)
- Bouton **Colab GPU gratuit** dans Pinokio
- GPU NVIDIA T4 dans le cloud (gratuit)
- ~2–5 min par clip

## Prérequis

- **Python 3.12 ARM64** (installé par Pinokio / miniconda)
- **Windows 11 ARM64** (Snapdragon X Elite)
- **32 Go RAM** recommandé
- **15 Go d’espace disque** (modèles)

## Variables d’environnement (optionnel)

| Variable | Usage |
|----------|--------|
| `HF_TOKEN` | Token Hugging Face si accès restreint |
| `WAN_MODEL_CACHE` | Dossier cache modèles (défaut: `./models`) |
| `GRADIO_SERVER_PORT` | Port interface (défaut: 7860) |

## Pourquoi ce détour ?

Wan2GP officiel (`pinokiofactory/wan`) appelle `torch.cuda` au démarrage → **impossible sans NVIDIA**.

Ce script :
- installe `torch+cpu` ARM64 au lieu de `torch+cu130`
- utilise **diffusers WanPipeline** (pas le code Wan2GP CUDA)
- propose **Colab** pour le même modèle avec GPU gratuit

## Dépannage

**Install échoue sur torch :**
```powershell
cd C:\pinokio\api\wan-snapdragon-arm.git\app
..\env\Scripts\activate
pip install --pre torch --index-url https://download.pytorch.org/whl/nightly/cpu
```

**Run affiche une URL mais page blanche :** ouvrez manuellement `http://127.0.0.1:7860`

**Trop lent :** utilisez **Colab GPU gratuit** (bouton dédié)
