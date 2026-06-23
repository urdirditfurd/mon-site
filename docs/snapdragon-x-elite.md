# Snapdragon X Elite — génération vidéo IA

Guide pour PC **Copilot+ / Snapdragon X Elite** (ARM64 Windows, NPU Hexagon).

## Ce que votre puce fait très bien

| Tâche | Composant | Dans ClipForge |
|-------|-----------|----------------|
| Cursor, indexation code, chat IA | **NPU Hexagon** | Automatique (hors de ce projet) |
| Découpage script → scènes | **Mistral cloud** (gratuit) | Champ clé Mistral optionnel |
| Assemblage MP4 | **CPU ARM** | FFmpeg via `npm start` |
| Génération clips vidéo IA | **Pas le NPU** (pour l'instant) | Voir ci-dessous |

Le NPU Snapdragon excelle pour l'IA « bureau ». Les modèles **text-to-video** (Wan, Sulphur) ne tournent pas encore nativement sur le NPU Hexagon en open-source simple.

---

## Meilleur choix pour vous (gratuit + puissant)

### Option A — Recommandée : FAL + interne (rapide)

1. Compte gratuit sur [fal.ai](https://fal.ai) (crédits offerts)
2. Clé `fal_…` dans Video Factory
3. `npm start` dans le dossier `mon-site`
4. Ouvrez `index-video-studio.html` ou `http://localhost:3000/studio`
5. **Générer** → tout reste dans l'app, sans Colab

**Pourquoi :** rapide, qualité Kling, votre Snapdragon reste frais et silencieux.

### Option B — 100 % gratuit : CPU ARM + Wan 2.1

1. Installez Python ARM64 + dépendances :
   ```powershell
   cd mon-site
   .\scripts\setup-video-arm.ps1
   ```
2. `npm start`
3. Video Factory → durée **≤ 1 minute**, scènes **3-4 s**
4. Mode **Automatique** (sans clé FAL)

**Pourquoi :** 0 €, tout en local. **Inconvénient :** ~5-15 min par scène sur CPU.

---

## Installation Windows ARM (PowerShell)

```powershell
cd C:\chemin\vers\mon-site
git pull origin main
npm install
.\scripts\setup-video-arm.ps1
npm start
```

Puis ouvrez :
- `Downloads\index-video-studio.html`
- ou `http://localhost:3000/studio`

---

## Réglages conseillés Snapdragon

| Paramètre | Valeur |
|-----------|--------|
| Durée | 0,5 – 1 min (CPU) · jusqu'à 10 min (FAL) |
| Scène IA | 3–4 secondes |
| Format | 9:16 Shorts ou 16:9 YouTube |
| Modèle auto | Wan 2.1 1.3B (léger) |

---

## FAQ

**Pourquoi pas le NPU pour la vidéo ?**  
Les modèles vidéo open-source ciblent CUDA (NVIDIA) ou des pipelines ONNX/QNN complexes (preuve de concept image SDXL, pas Wan T2V prêt à l'emploi).

**DirectML sur ARM ?**  
Pas encore disponible pour PyTorch sur Windows ARM64.

**Colab ?**  
Secours manuel uniquement — le flux principal est **interne** via `npm start`.

---

## Variables d'environnement

```powershell
$env:SULPHUR_SNAPDRAGON="1"      # activé par défaut sur ARM64 Windows
$env:SULPHUR_ALLOW_CPU="1"       # génération CPU Wan 2.1
$env:SULPHUR_MODEL_CACHE=".\models"
npm start
```
