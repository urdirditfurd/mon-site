# FAL.ai — limites et intégration ClipForge Studio

FAL.ai est intégré dans **ClipForge Studio** via deux modes :

| Mode | Usage |
|------|--------|
| **Remix IA viral** | YouTube → Mistral (scripts) → FAL (clips) → shorts |
| **Vidéo depuis script** | Votre texte → Mistral (scènes) → FAL (clips) → MP4 long |
| **Video Factory** (`/studio`) | Même pipeline, interface dédiée |

Clés stockées dans le navigateur (`clipforge-ai-keys`), partagées entre les pages.

---

## Limites officielles (résumé)

Source : [fal.ai FAQ](https://fal.ai/docs/documentation/model-apis/faq) et [pricing](https://fal.ai/docs/documentation/model-apis/pricing)

### Pas de forfait gratuit illimité

- **Modèle : crédits prépayés** — vous achetez des crédits à l'avance.
- **À l'inscription** : crédits promotionnels offerts (montant **variable**, souvent ~1–10 $, parfois plus avec email pro).
- **Pas de renouvellement mensuel gratuit** : une fois les crédits épuisés, il faut recharger (minimum **~5 $**).

### Expiration des crédits

| Type | Durée |
|------|--------|
| Crédits achetés | **365 jours** après l'achat |
| Crédits gratuits / coupons | **Variable** (1 semaine à 1 an) |

Vérifiez votre solde : [fal.ai/dashboard](https://fal.ai/dashboard)

### Parallélisme (concurrence)

| Profil | Requêtes simultanées |
|--------|----------------------|
| Nouveau compte | **2** en parallèle |
| Compte avec crédits | Augmente automatiquement (jusqu'à ~**40**) |

Les requêtes au-delà de la limite sont **mises en file d'attente** (l'attente n'est **pas facturée**).

### Ce qui n'est pas facturé

- Erreurs serveur FAL (HTTP **5xx**)
- Temps passé **en file d'attente** avant le début du calcul

### Verrouillage du compte

Si le solde descend sous le seuil de verrouillage, l'API refuse les requêtes jusqu'à recharge.

---

## Coûts estimés dans ClipForge (Kling 1.6 Standard)

Modèle par défaut : `fal-ai/kling-video/v1.6/standard/text-to-video`

| Usage | Scènes | Estimation |
|-------|--------|------------|
| 4 shorts × 45 s | ~36 scènes | ~10–15 € |
| Vidéo 1 min | ~12 scènes | ~3–4 € |
| Vidéo 10 min | ~120 scènes | ~30–40 € |

L'estimation s'affiche dans l'interface avant génération. Les tarifs réels peuvent varier — consultez [fal.ai/pricing](https://fal.ai/pricing).

---

## Snapdragon X Elite

Sans GPU NVIDIA, **FAL est la option rapide recommandée** :

1. Compte [fal.ai](https://fal.ai)
2. Clé dans ClipForge → **Clés API IA**
3. Mode **Automatique** ou **Vidéo depuis script**

---

## API ClipForge

| Endpoint | Description |
|----------|-------------|
| `GET /api/fal/limits` | Limites et modèles FAL |
| `POST /api/fal/estimate` | Estimation coût (`clipsCount`, `clipDurationSec` ou `durationMin`) |
| `POST /api/sulphur/jobs/auto` | Génération vidéo (`provider: "fal"`) |

---

## Bonnes pratiques

1. **Testez** avec une vidéo courte (30 s – 1 min) pour évaluer les crédits restants.
2. **Surveillez** le dashboard FAL pendant les gros batchs.
3. **Mistral** reste gratuit (Free Tier) pour la planification des scènes.
4. Pour du **100 % gratuit** sans FAL : mode CPU local (Snapdragon) ou Colab — beaucoup plus lent.
