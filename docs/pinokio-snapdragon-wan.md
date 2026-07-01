# Pinokio + Wan sur Snapdragon X Elite (sans NVIDIA)

Guide pour utiliser la **génération vidéo IA** sur Surface Copilot+ via Pinokio, sans carte NVIDIA.

## Le détour technique

Wan2GP officiel ne démarre pas sur Snapdragon (`torch.cuda` requis).  
Solution : app Pinokio dédiée **`wan-snapdragon-arm`** incluse dans ce repo.

```
Surface Snapdragon
       │
       ├─► Wan2GP classique (Pinokio)     ❌ CUDA requis
       │
       └─► wan-snapdragon-arm (ce repo)    ✅
              ├─ Run  → Wan 2.1 CPU local (0 €, lent)
              └─ Colab → Wan 2.1 GPU T4 (0 €, rapide)
```

## Installation Pinokio (5 minutes de config)

1. **Pinokio** → ajouter l’app custom :
   - URL : `https://github.com/urdirditfurd/mon-site/tree/main/pinokio/wan-snapdragon-arm`
   - ou copier le dossier vers `C:\pinokio\api\wan-snapdragon-arm.git\`

2. **Install** — attendre la fin (PyTorch ARM + modèle Wan)

3. **Run** — l’interface s’ouvre (Gradio, port 7860)

4. Pour aller **vite** : bouton **Colab GPU gratuit**

## Usage quotidien recommandé

| Moment | Outil | Mode |
|--------|-------|------|
| Journée | Cursor | NPU Snapdragon (autonomie) |
| Création vidéo rapide | Pinokio → Colab | GPU cloud gratuit |
| Création vidéo offline | Pinokio → Run | CPU local (secteur branché) |

## Alternative sans Pinokio

```powershell
cd mon-site
.\scripts\setup-video-arm.ps1
npm start
# → http://localhost:3000/studio
```

## FAL.ai (optionnel, crédits offerts)

Si Colab est saturé : clé FAL dans Video Factory — voir `docs/fal-ai-limites.md`.

## Fichiers

| Chemin | Rôle |
|--------|------|
| `pinokio/wan-snapdragon-arm/` | App Pinokio complète |
| `pinokio/wan-snapdragon-arm/app/wan_engine.py` | Moteur Wan CPU ARM |
| `pinokio/wan-snapdragon-arm/app/gradio_server.py` | Interface type Wan2GP |
| `colab/text-to-video-gratuit.ipynb` | Notebook Colab gratuit |
