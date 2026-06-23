/**
 * Client génération d'images via Hugging Face Inference (crédits gratuits mensuels).
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { resolveHfImageModel } = require("./hf-image-models");

const HF_ROUTER_BASE = "https://router.huggingface.co/hf-inference/models";
const HF_FALLBACK_ORDER = ["fluxSchnell", "sdxlTurbo", "sd15"];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveHfToken(explicit) {
  return String(
    explicit || process.env.HF_TOKEN || process.env.HUGGINGFACE_HUB_TOKEN || ""
  ).trim();
}

function isImageBuffer(buf) {
  if (!buf || buf.length < 4) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8) return true;
  if (buf[0] === 0x89 && buf[1] === 0x50) return true;
  if (buf[0] === 0x47 && buf[1] === 0x49) return true;
  return false;
}

async function requestHfImage({ modelId, prompt, hfToken, width, height, steps }) {
  const token = resolveHfToken(hfToken);
  if (!token) {
    throw new Error(
      "Token Hugging Face requis — créez-en un gratuit sur https://huggingface.co/settings/tokens (lecture)"
    );
  }

  const body = {
    inputs: prompt,
    parameters: {
      width: Number(width) || 768,
      height: Number(height) || 1344,
      num_inference_steps: Number(steps) || 4,
      guidance_scale: modelId.includes("schnell") ? 0 : 7.5
    }
  };

  const res = await fetch(`${HF_ROUTER_BASE}/${modelId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "image/png"
    },
    body: JSON.stringify(body)
  });

  const contentType = String(res.headers.get("content-type") || "").toLowerCase();

  if (res.status === 503) {
    const errJson = await res.json().catch(() => ({}));
    const estimated = Number(errJson.estimated_time || 20);
    throw new Error(`HF_MODEL_LOADING:${estimated}`);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HF image (${modelId}): ${res.status} ${errText.slice(0, 280)}`);
  }

  if (contentType.includes("application/json")) {
    const json = await res.json();
    if (json.error) throw new Error(String(json.error));
    if (json.estimated_time) throw new Error(`HF_MODEL_LOADING:${json.estimated_time}`);
    throw new Error("Réponse HF inattendue (JSON au lieu d'image)");
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (!isImageBuffer(buffer)) {
    throw new Error("Réponse HF invalide (pas une image PNG/JPEG)");
  }
  return buffer;
}

async function generateHfImageWithRetry(options, maxAttempts = 4) {
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await requestHfImage(options);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("HF_MODEL_LOADING:")) {
        const waitSec = Number(message.split(":")[1]) || 20;
        await sleep(Math.min(60000, (waitSec + 2) * 1000));
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error("Échec génération image HF");
}

async function generateHfImageToFile({
  prompt,
  outputPath,
  modelKey,
  hfToken,
  width,
  height,
  steps
}) {
  const model = resolveHfImageModel(modelKey);
  const buffer = await generateHfImageWithRetry({
    modelId: model.id,
    prompt,
    hfToken,
    width,
    height,
    steps: steps || model.defaultSteps
  });
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, buffer);
  return outputPath;
}

async function generateHfImageWithFallback({
  prompt,
  outputPath,
  modelKey,
  hfToken,
  width,
  height
}) {
  const primary = resolveHfImageModel(modelKey);
  const tryKeys = [primary.key, ...HF_FALLBACK_ORDER.filter((k) => k !== primary.key)];

  let lastError;
  for (const key of tryKeys) {
    const model = resolveHfImageModel(key);
    try {
      await generateHfImageToFile({
        prompt,
        outputPath,
        modelKey: key,
        hfToken,
        width,
        height,
        steps: model.defaultSteps
      });
      return { modelKey: key, modelId: model.id, outputPath };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Aucun modèle HF image disponible");
}

async function saveManualImage({ data, outputPath }) {
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  const raw = String(data || "");
  if (raw.startsWith("data:")) {
    const base64 = raw.split(",")[1] || "";
    await fsp.writeFile(outputPath, Buffer.from(base64, "base64"));
    return outputPath;
  }
  if (fs.existsSync(raw)) {
    await fsp.copyFile(raw, outputPath);
    return outputPath;
  }
  if (/^[A-Za-z0-9+/=]+$/.test(raw.slice(0, 200))) {
    await fsp.writeFile(outputPath, Buffer.from(raw, "base64"));
    return outputPath;
  }
  throw new Error("Image manuelle invalide (base64 ou chemin attendu)");
}

module.exports = {
  resolveHfToken,
  generateHfImageToFile,
  generateHfImageWithFallback,
  saveManualImage,
  HF_FALLBACK_ORDER
};
