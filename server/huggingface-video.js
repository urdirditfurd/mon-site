const fsp = require("fs/promises");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const HF_INFERENCE_BASE = "https://api-inference.huggingface.co/models";
const DEFAULT_HF_MODEL = "SulphurAI/Sulphur-2-base";

const HF_MODELS = {
  sulphur: DEFAULT_HF_MODEL,
  wanLite: "Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
  wanTurbo: "IPostYellow/TurboWan2.1-T2V-1.3B-Diffusers",
  wanPro: "Wan-AI/Wan2.2-TI2V-5B-Diffusers",
  legacy: "ali-vilab/text-to-video-ms-1.7b"
};

const ASPECT_DIMENSIONS = {
  "9:16": { width: 480, height: 854 },
  "16:9": { width: 854, height: 480 },
  "1:1": { width: 640, height: 640 }
};

function resolveHfModel(modelKey) {
  return HF_MODELS[modelKey] || modelKey || DEFAULT_HF_MODEL;
}

function getVideoExtension(mimeType) {
  const clean = String(mimeType || "").split(";")[0].trim().toLowerCase();
  if (clean === "video/webm") return "webm";
  if (clean === "image/gif") return "gif";
  return "mp4";
}

function makeSafeFileName(prefix, mimeType) {
  const cleanPrefix = String(prefix || "hf-clip").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 60);
  return `${cleanPrefix}-${uuidv4()}.${getVideoExtension(mimeType)}`;
}

function buildHfPayload({ prompt, duration, aspectRatio }) {
  const dims = ASPECT_DIMENSIONS[aspectRatio] || ASPECT_DIMENSIONS["9:16"];
  const seconds = Math.max(1, Number(duration) || 5);
  const numFrames = Math.max(16, Math.min(241, Math.round(seconds * 16)));

  return {
    inputs: prompt,
    parameters: {
      width: dims.width,
      height: dims.height,
      num_frames: numFrames,
      num_inference_steps: 25,
      guidance_scale: 5
    },
    options: {
      wait_for_model: true,
      use_cache: false
    }
  };
}

async function parseJsonResponse(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function extractVideoUrl(value) {
  if (!value) return null;
  if (typeof value === "string") {
    return /^https?:\/\//i.test(value) ? value : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractVideoUrl(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;

  const direct =
    value.url ||
    value.video_url ||
    value.output_url ||
    value.generated_video ||
    value?.video?.url ||
    value?.data?.video?.url ||
    value?.output?.video?.url;
  if (direct) {
    const found = extractVideoUrl(direct);
    if (found) return found;
  }

  for (const nested of Object.values(value)) {
    const found = extractVideoUrl(nested);
    if (found) return found;
  }
  return null;
}

function buildHfEndpointUrl({ endpointUrl, modelId }) {
  const cleanEndpoint = String(endpointUrl || "").trim();
  if (cleanEndpoint) return cleanEndpoint;
  return `${HF_INFERENCE_BASE}/${encodeURIComponent(modelId).replace(/%2F/g, "/")}`;
}

async function invokeHfTextToVideo({
  hfToken,
  modelId,
  prompt,
  duration,
  aspectRatio,
  endpointUrl
}) {
  const url = buildHfEndpointUrl({ endpointUrl, modelId });
  const headers = { "Content-Type": "application/json" };
  if (hfToken) headers.Authorization = `Bearer ${hfToken}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(buildHfPayload({ prompt, duration, aspectRatio }))
  });

  const contentType = res.headers.get("content-type") || "";
  if (res.ok && /^video\//i.test(contentType)) {
    return {
      type: "binary",
      mimeType: contentType,
      buffer: Buffer.from(await res.arrayBuffer())
    };
  }

  if (res.ok && contentType.includes("application/octet-stream")) {
    return {
      type: "binary",
      mimeType: "video/mp4",
      buffer: Buffer.from(await res.arrayBuffer())
    };
  }

  const body = await parseJsonResponse(res);
  if (!res.ok) {
    const msg = body?.error || body?.message || body?.detail || body?.raw || res.statusText;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }

  const urlFromJson = extractVideoUrl(body);
  if (urlFromJson) return { type: "url", url: urlFromJson, raw: body };

  throw new Error("Réponse Hugging Face sans vidéo exploitable");
}

async function writeHfVideoBuffer({ buffer, mimeType, destDir, filePrefix }) {
  await fsp.mkdir(destDir, { recursive: true });
  const fileName = makeSafeFileName(filePrefix, mimeType);
  const filePath = path.join(destDir, fileName);
  await fsp.writeFile(filePath, buffer);
  return { fileName, filePath };
}

async function generateHfClip({
  hfToken,
  modelId,
  prompt,
  duration,
  aspectRatio,
  endpointUrl,
  destDir,
  baseUrl,
  filePrefix
}) {
  const resolvedModel = resolveHfModel(modelId);
  const result = await invokeHfTextToVideo({
    hfToken,
    modelId: resolvedModel,
    prompt,
    duration,
    aspectRatio,
    endpointUrl
  });

  if (result.type === "url") {
    return {
      provider: "huggingface",
      modelId: resolvedModel,
      url: result.url,
      remote: true
    };
  }

  const saved = await writeHfVideoBuffer({
    buffer: result.buffer,
    mimeType: result.mimeType,
    destDir,
    filePrefix
  });
  const publicUrl = baseUrl ? `${baseUrl.replace(/\/$/, "")}/api/voanh/hf/clips/${saved.fileName}` : null;

  return {
    provider: "huggingface",
    modelId: resolvedModel,
    url: publicUrl,
    localPath: saved.filePath,
    fileName: saved.fileName,
    mimeType: result.mimeType,
    remote: false
  };
}

module.exports = {
  HF_INFERENCE_BASE,
  DEFAULT_HF_MODEL,
  HF_MODELS,
  resolveHfModel,
  buildHfPayload,
  generateHfClip,
  invokeHfTextToVideo
};
