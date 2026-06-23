# Text-to-video gratuit sans GPU NVIDIA (Google Colab)

Vous n'avez pas de carte NVIDIA chez vous ? **Google Colab** fournit un GPU gratuit (souvent T4, ~15 Go VRAM). C'est suffisant pour **Wan 2.1 1.3B**, le modèle le plus léger du pipeline Sulphur Studio.

## Ce que vous obtenez (0 €)

| Étape | Outil | Coût |
|-------|-------|------|
| Idées / scènes | Mistral Free Tier **ou** templates | 0 € |
| Génération clips | Wan 2.1 sur GPU Colab | 0 € |
| Assemblage vidéo longue | FFmpeg dans le notebook | 0 € |

Pas besoin d'installer Python, CUDA ni `npm` sur votre PC : tout tourne dans le navigateur.

---

## Étapes rapides (15 min la première fois)

### 1. Compte Google

1. Allez sur [colab.research.google.com](https://colab.research.google.com)
2. Connectez-vous avec un compte Google

### 2. Ouvrir le notebook

**Méthode Video Factory (script → Colab en 1 clic) :**

1. Téléchargez [index-video-studio.html](https://github.com/urdirditfurd/mon-site/raw/main/downloads/index-video-studio.html) ou ouvrez `http://localhost:3000/studio`
2. Collez votre script, durée, format → **Générer** (copie auto) ou **Config Colab**
3. Ouvrez Colab → collez dans la cellule **Configuration**

**Lien direct Colab :** [Ouvrir le notebook](https://colab.research.google.com/github/urdirditfurd/mon-site/blob/main/colab/text-to-video-gratuit.ipynb)

**Via GitHub dans Colab :**

1. Dans Colab : **Fichier → Ouvrir un notebook**
2. Onglet **GitHub** → `urdirditfurd/mon-site` → `colab/text-to-video-gratuit.ipynb`

*(Ou téléchargez le fichier `.ipynb` depuis le repo et uploadez-le dans Colab.)*

### 3. Activer le GPU

1. Menu **Exécution → Modifier le type d'exécution**
2. **Accélérateur matériel** : **GPU** (T4)
3. Enregistrer

### 4. Clé Mistral (optionnel mais recommandé)

Pour des scripts/scènes plus intelligents, gratuit sans carte bancaire :

1. [console.mistral.ai](https://console.mistral.ai) → créer un compte
2. **API Keys** → **Create new key**
3. Dans le notebook, cellule **Configuration**, collez la clé dans `MISTRAL_API_KEY`

Sans clé : le notebook utilise des **templates** automatiques (toujours 0 €).

### 5. Lancer le notebook

1. **Exécution → Tout exécuter** (ou `Ctrl+F9`)
2. La première fois : téléchargement du modèle (~3–5 Go) → **10–20 min**
3. Les fois suivantes (même session Colab) : beaucoup plus rapide

### 6. Configurer votre vidéo

Dans la cellule **Configuration**, modifiez — ou collez la config exportée depuis Video Factory :

```python
TOPIC = "Les secrets de la productivité"
SCRIPT = """Collez ici votre script complet (prioritaire)"""
DURATION_MIN = 1
CLIP_SEC = 4
ASPECT = "9:16"
```

### 7. Récupérer les MP4

À la fin, le notebook propose le téléchargement des fichiers dans `/content/output/`.

---

## Vidéo courte vs longue

| Type | Réglage | Résultat |
|------|---------|----------|
| **Courte** | `DURATION_MIN = 0.5` à `1`, `CLIP_SEC = 4` | 1 fichier MP4 (~15–30 s) |
| **Longue** | `DURATION_MIN = 2` à `5`, plusieurs scènes | clips générés puis **concaténés** en 1 MP4 |
| **Production** | `BATCH_COUNT = 10` ou plus | plusieurs sujets à la suite |

Chaque scène = 1 appel GPU. Sur Colab gratuit, comptez **~2–5 min par clip** (Wan 1.3B, 4 s).

---

## Limites Colab (gratuit)

- Session **~12 h max**, puis tout s'efface → retéléchargez vos MP4 avant de fermer
- GPU pas toujours disponible aux heures de pointe → réessayez plus tard
- **Pas illimité** au sens strict : quotas Google, mais largement suffisant pour des dizaines de clips/jour si vous enchaînez les sessions
- Modèle **Sulphur 2** (~24 Go) : **trop lourd** pour T4 → utilisez **`wan21lite`** (défaut dans le notebook)

---

## Alternative : Kaggle (si Colab est saturé)

1. [kaggle.com](https://www.kaggle.com) → **Notebooks** → **New Notebook**
2. **Settings** → **GPU** (P100 ou T4)
3. Importez le même notebook `colab/text-to-video-gratuit.ipynb`
4. ~30 h GPU/semaine gratuites

---

## Et le site VOANH / mon-site en local ?

Sans GPU, **ne lancez pas** `npm run setup:video` pour la génération : le moteur Sulphur a besoin de CUDA.

Vous pouvez quand même :

- Utiliser **Colab** pour produire les MP4
- Garder **mon-site** pour l'interface ClipForge (shorts YouTube, sous-titres, etc.) sur un PC sans GPU

Quand vous aurez un VPS ou PC avec GPU NVIDIA, le même projet bascule sur `POST /api/sulphur/batch` en local.

---

## Dépannage

| Problème | Solution |
|----------|----------|
| `CUDA not available` | Vérifiez **GPU** dans le type d'exécution |
| `Out of memory` | Baissez résolution (`ASPECT = "9:16"`), `CLIP_SEC = 3`, ou redémarrez la session |
| Téléchargement HF lent | Ajoutez `HF_TOKEN` (compte gratuit [huggingface.co](https://huggingface.co)) |
| Mistral erreur 401 | Vérifiez la clé API |
| Session coupée | Relancez ; les modèles en cache accélèrent le redémarrage |

---

## Résumé en 5 lignes

1. Colab + GPU T4  
2. Ouvrir `colab/text-to-video-gratuit.ipynb`  
3. (Optionnel) clé Mistral gratuite  
4. Modifier `TOPIC` / `DURATION_MIN` / `BATCH_COUNT`  
5. Tout exécuter → télécharger les MP4  
