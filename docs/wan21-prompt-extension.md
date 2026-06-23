# Enrichissement prompts Wan 2.1 (prompt extension)

ClipForge reproduit le comportement **`--use_prompt_extend`** du dépôt officiel [Wan-Video/Wan2.1](https://github.com/Wan-Video/Wan2.1), sans installer Qwen localement.

## Principe

1. **Planification** (Mistral ou templates) : découpe le script en scènes avec un `visualPrompt` par scène.
2. **Enrichissement Wan** (optionnel) : chaque `visualPrompt` est réécrit en anglais (~80–100 mots) avec le même system prompt que `local_qwen` dans Wan 2.1.
3. **Génération** : Wan 2.1 1.3B (local, Colab ou CPU Snapdragon) reçoit le prompt enrichi.

## Quand c’est actif

| Condition | Enrichissement |
|-----------|----------------|
| Provider `sulphur` + modèle `wan21lite` / `wan22` | Oui (si activé) |
| Clé Mistral présente | Requis |
| Provider FAL cloud | Non (ignoré) |
| Toggle désactivé dans l’UI | Non |

Par défaut : **activé** dès qu’une clé Mistral est fournie.

## Interface

- **Video Factory** (`/studio`) : case « Enrichissement prompts Wan 2.1 »
- **ClipForge** : même préférence dans « Clés API IA » (partagée via `localStorage` `clipforge-ai-keys`)

## API

```json
POST /api/sulphur/jobs/auto
{
  "provider": "sulphur",
  "hfModel": "wan21lite",
  "script": "...",
  "mistralKey": "...",
  "wanPromptExtend": true
}
```

`GET /api/sulphur/health` expose `wanPromptExtension` (description et modèles concernés).

## Variables d’environnement

| Variable | Effet |
|----------|--------|
| `MISTRAL_EXTEND_MODEL` | Modèle Mistral pour l’enrichissement (défaut : `mistral-small-2506`) |
| `SULPHUR_PROMPT_EXTEND_FALLBACK=0` | Échec Mistral = erreur job (pas de repli sur prompt original) |

## Coût

- **Mistral Free Tier** : ~1 requête par scène (gratuit dans les quotas console.mistral.ai).
- **Wan local / Colab** : 0 € GPU (hors quotas Colab).

## Colab

Le notebook `colab/text-to-video-gratuit.ipynb` inclut une fonction `extend_wan_prompt()` optionnelle avant `generate_clip()`.
