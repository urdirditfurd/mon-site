/**
 * Limites et estimations FAL.ai pour ClipForge Studio.
 * Sources : https://fal.ai/docs/documentation/model-apis/faq
 *           https://fal.ai/docs/documentation/model-apis/pricing
 */

const FAL_MODELS = {
  "fal-ai/kling-video/v1.6/standard/text-to-video": {
    key: "kling16",
    label: "Kling 1.6 Standard (économique)",
    clipSecOptions: [5, 10],
    usdPerClip: { 5: 0.28, 10: 0.55 },
    recommended: true
  },
  "fal-ai/kling-video/v2/master/text-to-video": {
    key: "kling20",
    label: "Kling 2.0 Master (qualité max)",
    clipSecOptions: [5, 10],
    usdPerClip: { 5: 0.45, 10: 0.85 }
  }
};

const DEFAULT_FAL_MODEL = "fal-ai/kling-video/v1.6/standard/text-to-video";

const FAL_LIMITS = {
  billingModel: "Crédits prépayés — pas d'abonnement gratuit récurrent",
  signupCredits: {
    summary: "Crédits offerts à l'inscription (montant variable, souvent ~1–10 $)",
    note: "Vérifiez votre solde sur fal.ai/dashboard/billing"
  },
  creditExpiry: {
    purchased: "365 jours après achat",
    freeGrants: "Variable (1 semaine à 1 an selon l'offre)"
  },
  minTopUpUsd: 5,
  concurrency: {
    newAccount: 2,
    note: "Requêtes supplémentaires mises en file d'attente (gratuit en attente)",
    higherLimits: "Augmente avec les achats de crédits (jusqu'à ~40 parallèles)"
  },
  notBilled: [
    "Erreurs serveur (HTTP 5xx)",
    "Temps passé en file d'attente avant exécution"
  ],
  accountLock: "Compte bloqué si le solde passe sous le seuil — rechargez sur le dashboard",
  officialDocs: "https://fal.ai/docs/documentation/model-apis/faq"
};

function falClipUsd(modelPath, clipSec) {
  const model = FAL_MODELS[modelPath] || FAL_MODELS[DEFAULT_FAL_MODEL];
  const sec = clipSec <= 7 ? 5 : 10;
  return model.usdPerClip[sec] || model.usdPerClip[5];
}

function estimateFalJob({
  sceneCount,
  clipSec = 5,
  modelPath = DEFAULT_FAL_MODEL,
  clipsCount,
  clipDurationSec
}) {
  let scenes = Number(sceneCount) || 0;
  if (!scenes && clipsCount && clipDurationSec) {
    const falSec = clipSec <= 7 ? 5 : 10;
    const scenesPerClip = Math.max(1, Math.ceil(clipDurationSec / falSec));
    scenes = Number(clipsCount) * scenesPerClip;
  }
  scenes = Math.max(1, scenes);
  const usdPerClip = falClipUsd(modelPath, clipSec);
  const totalUsd = scenes * usdPerClip;
  const totalEur = totalUsd * 0.92;

  return {
    sceneCount: scenes,
    clipSec: clipSec <= 7 ? 5 : 10,
    modelPath,
    modelLabel: (FAL_MODELS[modelPath] || FAL_MODELS[DEFAULT_FAL_MODEL]).label,
    usdPerClip,
    totalUsd: Math.round(totalUsd * 100) / 100,
    totalEur: Math.round(totalEur * 100) / 100,
    limits: FAL_LIMITS
  };
}

function listFalModels() {
  return Object.entries(FAL_MODELS).map(([path, meta]) => ({
    path,
    ...meta
  }));
}

module.exports = {
  FAL_MODELS,
  FAL_LIMITS,
  DEFAULT_FAL_MODEL,
  falClipUsd,
  estimateFalJob,
  listFalModels
};
