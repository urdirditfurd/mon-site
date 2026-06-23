/**
 * Modèles text-to-image pour Fiction Studio (Hugging Face + local).
 */

const HF_IMAGE_MODELS = {
  fluxSchnell: {
    id: "black-forest-labs/FLUX.1-schnell",
    label: "FLUX.1 Schnell (HF — rapide, qualité)",
    provider: "huggingface",
    license: "Apache-2.0",
    defaultSteps: 4,
    costHint: "Crédits HF gratuits mensuels (~0,10 $/mois compte free)"
  },
  sdxlTurbo: {
    id: "stabilityai/sdxl-turbo",
    label: "SDXL Turbo (HF — fallback léger)",
    provider: "huggingface",
    license: "OpenRAIL",
    defaultSteps: 4,
    costHint: "Crédits HF gratuits"
  },
  sd15: {
    id: "runwayml/stable-diffusion-v1-5",
    label: "Stable Diffusion 1.5 (HF — classique)",
    provider: "huggingface",
    license: "CreativeML Open RAIL-M",
    defaultSteps: 25,
    costHint: "Crédits HF gratuits"
  }
};

const DEFAULT_HF_IMAGE_MODEL = "fluxSchnell";

const VISUAL_STYLES = {
  cinematic: {
    label: "Cinéma / fiction",
    prefix: "Cinematic film still, dramatic lighting, shallow depth of field, professional color grading,"
  },
  anime: {
    label: "Anime",
    prefix: "Anime illustration, vibrant colors, clean linework, detailed background,"
  },
  illustration: {
    label: "Illustration",
    prefix: "Digital illustration, painterly textures, rich details, artistic composition,"
  },
  documentary: {
    label: "Documentaire",
    prefix: "Documentary photography, natural lighting, realistic textures, authentic atmosphere,"
  },
  noir: {
    label: "Film noir",
    prefix: "Film noir style, high contrast, moody shadows, vintage cinematic grain,"
  },
  fantasy: {
    label: "Fantasy",
    prefix: "Epic fantasy concept art, magical atmosphere, volumetric light, highly detailed,"
  }
};

const DEFAULT_VISUAL_STYLE = "cinematic";

const ASPECT_RESOLUTIONS = {
  "9:16": { width: 768, height: 1344 },
  "16:9": { width: 1344, height: 768 },
  "1:1": { width: 1024, height: 1024 }
};

const DEFAULT_FPS = 24;

function resolveHfImageModel(key) {
  const normalized = String(key || DEFAULT_HF_IMAGE_MODEL).trim();
  if (HF_IMAGE_MODELS[normalized]) return { key: normalized, ...HF_IMAGE_MODELS[normalized] };
  const found = Object.entries(HF_IMAGE_MODELS).find(([, m]) => m.id === normalized);
  if (found) return { key: found[0], ...found[1] };
  return { key: normalized, id: normalized, label: normalized, provider: "huggingface" };
}

function resolveVisualStyle(key) {
  const normalized = String(key || DEFAULT_VISUAL_STYLE).toLowerCase();
  return VISUAL_STYLES[normalized] || VISUAL_STYLES[DEFAULT_VISUAL_STYLE];
}

function resolutionForAspect(aspectRatio) {
  return ASPECT_RESOLUTIONS[String(aspectRatio || "9:16")] || ASPECT_RESOLUTIONS["9:16"];
}

function listHfImageModels() {
  return Object.entries(HF_IMAGE_MODELS).map(([key, model]) => ({ key, ...model }));
}

function listVisualStyles() {
  return Object.entries(VISUAL_STYLES).map(([key, style]) => ({ key, label: style.label }));
}

function buildImagePrompt(visualPrompt, visualStyle) {
  const style = resolveVisualStyle(visualStyle);
  const core = String(visualPrompt || "").trim();
  if (!core) return style.prefix;
  if (core.toLowerCase().includes(style.prefix.slice(0, 12).toLowerCase())) return core;
  return `${style.prefix} ${core}`;
}

module.exports = {
  HF_IMAGE_MODELS,
  DEFAULT_HF_IMAGE_MODEL,
  DEFAULT_VISUAL_STYLE,
  DEFAULT_FPS,
  VISUAL_STYLES,
  resolveHfImageModel,
  resolveVisualStyle,
  resolutionForAspect,
  listHfImageModels,
  listVisualStyles,
  buildImagePrompt
};
