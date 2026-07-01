# Guide complet — Pinokio + IA vidéo sur Surface Snapdragon (sans NVIDIA)

Ce guide explique **étape par étape** comment accéder à Wan et aux autres modèles Pinokio depuis un **Surface Copilot+ / Snapdragon X Elite**.

---

## Comprendre le détour (2 minutes)

Pinokio installe par défaut des apps qui appellent **CUDA NVIDIA**. Sur Snapdragon :

```
torch 2.x+cpu  →  CUDA: False  →  Wan2GP / Hunyuan plantent
```

**3 détours possibles :**

| Détour | Coût | Vitesse | Modèles |
|--------|------|---------|---------|
| **A — App Pinokio ARM** | 0 € | Lent (CPU) | Wan 2.1 1.3B seulement |
| **B — Colab GPU cloud** | 0 € | Rapide | Wan, et modèles légers |
| **C — FAL.ai cloud** | Crédits offerts | Très rapide | Kling, Minimax, etc. |
| **D — Hugging Face Spaces** | 0 € (file d’attente) | Variable | Wan, démos communautaires |

**On ne peut pas** recoder tous les modèles Pinokio en local CPU ARM (Hunyuan 14B sur CPU = des heures par clip).

---

## Tableau : modèles Pinokio sur votre Surface

| App Pinokio | Local Snapdragon | Détour recommandé |
|-------------|------------------|-------------------|
| **Wan2GP** (`pinokiofactory/wan`) | ❌ | **wan-snapdragon-arm** + Colab |
| **Wan2GP AMD** | ❌ (pas GPU AMD) | Colab ou FAL |
| **HunyuanVideo** | ❌ | Colab / FAL / PC NVIDIA loué |
| **FramePack** | ❌ | Colab / GPU cloud |
| **CogStudio / CogVideo** | ❌ | Hugging Face Spaces |
| **ComfyUI** | ❌ (trop lourd) | ComfyUI sur Colab |
| **Phosphene** | ❌ (Mac only) | — |
| **VideoCrafter 2** | ❌ | Colab |
| **Allegro, Hallo, EchoMimic** | ❌ | FAL / services cloud |
| **ai-video-composer** | ✅ | Install direct (montage FFmpeg) |
| **FreeCut** | ✅ | Install direct (montage navigateur) |
| **LingBot-World NF4** | ❌ (20 Go VRAM) | GPU cloud loué |

---

# PARTIE 1 — Wan 2.1 via Pinokio (détour officiel du repo)

## Étape 1 — Installer Pinokio

1. Allez sur [pinokio.computer](https://pinokio.computer)
2. Téléchargez **Pinokio pour Windows**
3. Installez et lancez Pinokio
4. Laissez Pinokio installer **Miniconda** (automatique au premier lancement)

---

## Étape 2 — Récupérer l’app `wan-snapdragon-arm`

### Méthode A — URL custom (recommandée)

1. Dans Pinokio, ouvrez **Discover** ou le champ **Custom URL**
2. Collez :
   ```
   https://github.com/urdirditfurd/mon-site/tree/main/pinokio/wan-snapdragon-arm
   ```
3. Validez → l’app **Wan Snapdragon ARM** apparaît dans votre liste

### Méthode B — Copie manuelle

1. Clonez ou téléchargez le repo :
   ```powershell
   git clone https://github.com/urdirditfurd/mon-site.git
   ```
2. Copiez le dossier :
   ```
   mon-site\pinokio\wan-snapdragon-arm\
   ```
   vers :
   ```
   C:\pinokio\api\wan-snapdragon-arm.git\
   ```
3. Redémarrez Pinokio

---

## Étape 3 — Installer l’environnement (bouton Install)

1. Cliquez sur **Wan Snapdragon ARM** dans Pinokio
2. Cliquez **Install** (icône power / menu Install)
3. Attendez **10 à 25 minutes** (première fois)
4. Pinokio exécute automatiquement :
   - création du venv Python ARM64
   - `torch` **CPU** (pas CUDA)
   - `diffusers`, `gradio`, etc.
   - vérification `wan_engine.py check`

### Vérification manuelle (si doute)

```bat
cd C:\pinokio\api\wan-snapdragon-arm.git\app
..\env\Scripts\activate
python wan_engine.py check
```

**OK si vous voyez :**
```json
"device": "snapdragon-cpu",
"cuda": false,
"snapdragon": true
```

---

## Étape 4 — Lancer l’interface (bouton Run)

1. Cliquez **Run** dans Pinokio
2. Attendez le message avec une URL, ex. :
   ```
   Running on http://127.0.0.1:7860
   ```
3. Pinokio ouvre le navigateur automatiquement
4. Sinon, ouvrez manuellement : **http://127.0.0.1:7860**

---

## Étape 5 — Générer votre première vidéo (local, 0 €)

1. Onglet **Text to Video (local)**
2. Entrez un prompt, ex. :
   ```
   Un chat orange marche sur la plage au coucher du soleil, style cinématique
   ```
3. Résolution : **480p 16:9**
4. Frames : **49** (recommandé Snapdragon)
5. Cliquez **Générer la vidéo**
6. **Branchez le secteur** — comptez **5 à 15 minutes**
7. La vidéo apparaît dans le lecteur à droite

**Premier lancement :** téléchargement du modèle Wan 2.1 (~3–5 Go) en plus du temps de génération.

---

## Étape 6 — Mode rapide gratuit (Colab GPU)

1. Dans Pinokio, cliquez **Colab GPU gratuit**
   - ou dans l’interface Gradio → onglet **Colab gratuit**
2. Le notebook s’ouvre dans Chrome/Edge
3. **Exécution → Modifier le type d’exécution → GPU (T4)**
4. **Exécution → Tout exécuter**
5. Dans la cellule **Configuration**, modifiez :
   ```python
   TOPIC = "Votre sujet"
   SCRIPT = "Votre texte ou scène"
   DURATION_MIN = 1
   CLIP_SEC = 4
   ASPECT = "9:16"
   ```
6. À la fin : téléchargez les MP4 depuis `/content/output/`

**Lien direct notebook :**
https://colab.research.google.com/github/urdirditfurd/mon-site/blob/main/colab/text-to-video-gratuit.ipynb

---

## Étape 7 — Workflow quotidien recommandé

```
Matin / journée     → Cursor sur Surface (NPU, batterie)
Création vidéo      → Pinokio → Colab GPU gratuit (rapide)
Soir / offline      → Pinokio → Run (local CPU, secteur)
Montage             → FreeCut dans Pinokio ou DaVinci
```

---

# PARTIE 2 — Les « autres » modèles Pinokio (sans recoder chaque app)

Pour Hunyuan, FramePack, CogVideo, etc., le même **principe** s’applique, mais pas la même **app ARM** (trop lourds pour CPU).

## Détour B — Colab pour d’autres modèles

| Modèle | Notebook / Space Colab | Étapes |
|--------|------------------------|--------|
| **Wan 2.1** | [notebook du repo](../colab/text-to-video-gratuit.ipynb) | GPU T4 → Tout exécuter |
| **ComfyUI** | Chercher « ComfyUI Colab » sur Google | GPU → workflow |
| **Hunyuan** | Chercher « HunyuanVideo Colab » | GPU A100/T4 si dispo |
| **CogVideo** | Hugging Face Spaces THUDM | Navigateur |

**Étapes génériques Colab :**
1. Ouvrir le notebook
2. **Exécution → Modifier le type d’exécution → GPU**
3. **Exécution → Tout exécuter**
4. Télécharger le résultat

---

## Détour C — FAL.ai (qualité pro, crédits offerts)

Pour Kling, Minimax et pipelines « type studio » :

### Étape 1 — Compte FAL
1. [fal.ai](https://fal.ai) → créer un compte
2. **Dashboard → API Keys → Create**
3. Copier la clé `fal_...`

### Étape 2 — Video Factory (sans Pinokio)
```powershell
cd C:\chemin\vers\mon-site
npm install
npm start
```
Ouvrir : http://localhost:3000/studio

### Étape 3 — Coller la clé FAL
1. Section **Clés API IA**
2. Collez `fal_...`
3. Mode **Vidéo depuis script** ou **Automatique**
4. Générez → les clips passent par le cloud FAL (pas votre GPU)

Voir : [`docs/fal-ai-limites.md`](fal-ai-limites.md)

---

## Détour D — Hugging Face Spaces (navigateur, 0 €)

1. Allez sur [huggingface.co/spaces](https://huggingface.co/spaces)
2. Cherchez : `Wan text-to-video`, `Hunyuan Video`, etc.
3. Ouvrez un Space avec GPU
4. Entrez le prompt → générez (parfois file d’attente)

**Avantage :** rien à installer sur le Surface.

---

## Détour E — Louer un GPU cloud (vrai Pinokio + toutes les apps)

Si vous voulez **tous** les modèles Pinokio officiels (Wan2GP 14B, Hunyuan, FramePack) :

1. Louez un PC cloud avec **RTX 4090 / A100** :
   - [RunPod](https://runpod.io)
   - [Vast.ai](https://vast.ai)
2. Installez Pinokio sur la machine cloud (Windows ou Linux)
3. Installez `wan`, `hunyuanvideo`, etc. normalement
4. Accédez à l’interface Gradio via l’URL fournie par le cloud
5. Votre Surface sert de **terminal + Cursor** ; le GPU est dans le cloud

**Coût :** ~0,20–0,80 €/heure selon le GPU.

---

# PARTIE 3 — Apps Pinokio qui marchent directement sur Snapdragon

## FreeCut (montage vidéo)

1. Pinokio → Discover → **FreeCut**
2. **Install** → **Run**
3. Éditeur vidéo dans le navigateur, pas besoin de GPU

## ai-video-composer (montage FFmpeg)

1. Pinokio → Discover → **ai-video-composer**
2. **Install** → **Run**
3. Montage par langage naturel + FFmpeg

---

# PARTIE 4 — Dépannage

| Problème | Solution |
|----------|----------|
| `Found no NVIDIA driver` sur wan.git | Normal — utilisez **wan-snapdragon-arm**, pas wan.git |
| `c10.dll WinError 1114` | Installez [Visual C++ Redistributable x64](https://learn.microsoft.com/fr-fr/cpp/windows/latest-supported-vc-redist) + redémarrage |
| `torch 2.x+cpu` sur hunyuan | Hunyuan ne tourne pas en CPU — utilisez Colab ou FAL |
| Install Pinokio très lent | Connexion stable, 15+ Go libres sur C: |
| Génération locale bloquée | Secteur branché, fermez Cursor lourd pendant la génération |
| Colab « GPU non disponible » | Réessayez plus tard ou compte Colab Pro |

---

# PARTIE 5 — Checklist finale

```
[ ] Pinokio installé
[ ] App wan-snapdragon-arm installée (Install terminé)
[ ] python wan_engine.py check → snapdragon-cpu OK
[ ] Run → http://127.0.0.1:7860 accessible
[ ] Compte Google pour Colab (mode rapide)
[ ] (Optionnel) Clé FAL pour Kling / modèles pro
[ ] Ne plus utiliser pinokiofactory/wan sur ce PC
```

---

## Résumé une page

| Besoin | Faites ceci |
|--------|-------------|
| **Wan dans Pinokio** | `wan-snapdragon-arm` → Install → Run |
| **Wan rapide gratuit** | Bouton Colab ou notebook du repo |
| **Hunyuan / FramePack / Cog** | Colab, FAL, HF Spaces, ou GPU cloud loué |
| **Montage** | FreeCut dans Pinokio |
| **Cursor toute la journée** | Surface Snapdragon (comme maintenant) |

**Prochaine évolution possible :** apps Pinokio dédiées ARM pour d’autres modèles **légers** uniquement (pas Hunyuan 14B en local CPU).
