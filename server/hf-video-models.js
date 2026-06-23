/**
 * Registre des modèles text-to-video Hugging Face pour Sulphur Studio.
 * Modèle principal : SulphurAI/Sulphur-2-base (#1 téléchargements HF text-to-video).
 */

const HF_MODELS = {
  sulphur2: {
    id: "SulphurAI/Sulphur-2-base",
    label: "Sulphur 2 Base (LTX 2.3)",
    engine: "ltx-single-file",
    weightFile: "sulphur_dev_bf16.safetensors",
    weightFileAlt: "sulphur_dev_fp8mixed.safetensors",
    distillLora: "distill_loras/ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors",
    license: "Apache-2.0",
    maxFrames: 161,
    defaultFps: 24,
    resolutions: {
      "9:16": { width: 704, height: 1280 },
      "16:9": { width: 1280, height: 704 },
      "1:1": { width: 704, height: 704 }
    },
    vramGb: 24,
    clipSecMax: 6
  },
  sulphur2Distilled: {
    id: "SulphurAI/Sulphur-2-base",
    label: "Sulphur 2 Distilled (rapide)",
    engine: "ltx-single-file",
    weightFile: "sulphur_distil_bf16.safetensors",
    distillLora: "distill_loras/ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors",
    license: "Apache-2.0",
    maxFrames: 121,
    defaultFps: 24,
    resolutions: {
      "9:16": { width: 704, height: 1280 },
      "16:9": { width: 1280, height: 704 },
      "1:1": { width: 704, height: 704 }
    },
    vramGb: 16,
    clipSecMax: 5,
    inferenceSteps: 8
  },
  wan22: {
    id: "Wan-AI/Wan2.2-TI2V-5B-Diffusers",
    label: "Wan 2.2 TI2V 5B",
    engine: "wan-diffusers",
    license: "Apache-2.0",
    maxFrames: 121,
    defaultFps: 24,
    resolutions: {
      "9:16": { width: 704, height: 1280 },
      "16:9": { width: 1280, height: 704 },
      "1:1": { width: 704, height: 704 }
    },
    vramGb: 24,
    clipSecMax: 5
  },
  wan21lite: {
    id: "Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
    label: "Wan 2.1 T2V 1.3B (léger)",
    engine: "wan-diffusers",
    license: "Apache-2.0",
    maxFrames: 81,
    defaultFps: 16,
    resolutions: {
      "9:16": { width: 480, height: 832 },
      "16:9": { width: 832, height: 480 },
      "1:1": { width: 480, height: 480 }
    },
    vramGb: 8,
    clipSecMax: 5
  }
};

const DEFAULT_HF_MODEL = "sulphur2";

const NEGATIVE_PROMPT =
  "worst quality, inconsistent motion, blurry, static, text overlay, watermark, logo, " +
  "ugly, deformed, extra limbs, low quality, jpeg artifacts";

function resolveHfModel(modelKey) {
  const key = String(modelKey || DEFAULT_HF_MODEL).trim();
  return HF_MODELS[key] ? { key, ...HF_MODELS[key] } : { key: DEFAULT_HF_MODEL, ...HF_MODELS[DEFAULT_HF_MODEL] };
}

function framesForDuration(model, clipSec) {
  const fps = model.defaultFps || 24;
  const maxFrames = model.maxFrames || 121;
  const requested = Math.max(17, Math.round(clipSec * fps));
  const odd = requested % 2 === 0 ? requested + 1 : requested;
  return Math.min(maxFrames, odd);
}

function resolutionForAspect(model, aspectRatio) {
  const map = model.resolutions || HF_MODELS.sulphur2.resolutions;
  return map[aspectRatio] || map["16:9"];
}

function listHfModels() {
  return Object.entries(HF_MODELS).map(([key, meta]) => ({
    key,
    id: meta.id,
    label: meta.label,
    engine: meta.engine,
    vramGb: meta.vramGb,
    clipSecMax: meta.clipSecMax
  }));
}

module.exports = {
  HF_MODELS,
  DEFAULT_HF_MODEL,
  NEGATIVE_PROMPT,
  resolveHfModel,
  framesForDuration,
  resolutionForAspect,
  listHfModels
};
