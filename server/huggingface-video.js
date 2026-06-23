const fsp = require("fs/promises");

const HF_INFERENCE_BASE = "https://api-inference.huggingface.co/models";
const DEFAULT_HF_TEXT_TO_VIDEO_MODEL = "SulphurAI/Sulphur-2-base";

const HF_TEXT_TO_VIDEO_MODELS = {
  sulphur2: DEFAULT_HF_TEXT_TO_VIDEO_MODEL,
  wan21Small: "Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
  wan22Ti2v: "Wan-AI/Wan2.2-TI2V-5B-Diffusers",
  modelScope: "ali-vilab/text-to-video-ms-1.7b"
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveHfTextToVideoModel(modelKey) {
  return HF_TEXT_TO_VIDEO_MODELS[modelKey] || modelKey || DEFAULT_HF_TEXT_TO_VIDEO_MODEL;
}

function sanitizeEndpointUrl(endpointUrl) {
  const value = String(endpointUrl || "").trim();
  return value ? value.replace(/\/+$/, "") : "";
}

function buildHfInferenceUrl({ modelId, endpointUrl }) {
  const customEndpoint = sanitizeEndpointUrl(endpointUrl);
  if (customEndpoint) return customEndpoint;
  return `${HF_INFERENCE_BASE}/${resolveHfTextToVideoModel(modelId)}`;
}

function dimensionsForAspectRatio(aspectRatio) {
  switch (aspectRatio) {
    case "16:9":
      return { width: 1024, height: 576 };
    case "1:1":
      return { width: 768, height: 768 };
    case "9:16":
    default:
      return { width: 576, height: 1024 };
  }
}

function hfParametersForScene({ durationSec, aspectRatio }) {
  const duration = Math.max(3, Math.min(12, Math.round(Number(durationSec) || 5)));
  const frameRate = 8;
  const { width, height } = dimensionsForAspectRatio(aspectRatio);
  return {
    duration,
    fps: frameRate,
    num_frames: Math.max(16, Math.min(96, duration * frameRate)),
    width,
    height,
    guidance_scale: 6,
    num_inference_steps: 30
  };
}

function findUrlInPayload(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.url === "string") return payload.url;
  if (typeof payload.video === "string") return payload.video;
  if (typeof payload.output === "string") return payload.output;
  if (typeof payload.generated_video === "string") return payload.generated_video;
  if (payload.video && typeof payload.video.url === "string") return payload.video.url;
  if (payload.output && typeof payload.output.url === "string") return payload.output.url;
  if (Array.isArray(payload) && payload.length > 0) return findUrlInPayload(payload[0]);
  return "";
}

function findBase64VideoInPayload(payload) {
  if (!payload || typeof payload !== "object") return "";
  const direct =
    payload.video_base64 ||
    payload.generated_video_base64 ||
    payload.base64 ||
    payload.output_base64 ||
    payload.video?.base64 ||
    payload.output?.base64;
  if (typeof direct === "string") return direct;
  if (Array.isArray(payload) && payload.length > 0) return findBase64VideoInPayload(payload[0]);
  return "";
}

async function writeRemoteVideo(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Téléchargement HF impossible (${res.status}): ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(destPath, buf);
  return destPath;
}

async function parseHfJsonResponse(res, text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text, status: res.status };
  }
}

async function generateHfTextToVideoClip({
  hfKey,
  hfEndpointUrl,
  modelId,
  prompt,
  durationSec,
  aspectRatio,
  destPath,
  maxAttempts = 4
}) {
  const token = String(hfKey || "").trim();
  const endpointUrl = buildHfInferenceUrl({ modelId, endpointUrl: hfEndpointUrl });
  const headers = {
    Accept: "video/mp4,application/json",
    "Content-Type": "application/json"
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const body = JSON.stringify({
    inputs: prompt,
    parameters: hfParametersForScene({ durationSec, aspectRatio }),
    options: { wait_for_model: true, use_cache: false }
  });

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const res = await fetch(endpointUrl, {
      method: "POST",
      headers,
      body
    });

    const contentType = String(res.headers.get("content-type") || "").toLowerCase();
    if (res.ok && (contentType.startsWith("video/") || contentType.includes("application/octet-stream"))) {
      const buf = Buffer.from(await res.arrayBuffer());
      await fsp.writeFile(destPath, buf);
      return { path: destPath, provider: "huggingface", modelId: resolveHfTextToVideoModel(modelId) };
    }

    const text = await res.text();
    const payload = await parseHfJsonResponse(res, text);
    if (res.ok) {
      const url = findUrlInPayload(payload);
      if (url) {
        await writeRemoteVideo(url, destPath);
        return { path: destPath, provider: "huggingface", modelId: resolveHfTextToVideoModel(modelId) };
      }
      const base64Video = findBase64VideoInPayload(payload);
      if (base64Video) {
        await fsp.writeFile(destPath, Buffer.from(base64Video, "base64"));
        return { path: destPath, provider: "huggingface", modelId: resolveHfTextToVideoModel(modelId) };
      }
    }

    const estimatedTime = Number(payload.estimated_time);
    const shouldRetry = res.status === 503 && attempt < maxAttempts - 1;
    if (shouldRetry) {
      await sleep(Math.max(2000, Math.min(30000, (estimatedTime || 4) * 1000)));
      continue;
    }

    const message = payload.error || payload.message || payload.raw || res.statusText;
    throw new Error(`Hugging Face text-to-video: ${typeof message === "string" ? message : JSON.stringify(message)}`);
  }

  throw new Error("Hugging Face text-to-video: génération non terminée");
}

module.exports = {
  DEFAULT_HF_TEXT_TO_VIDEO_MODEL,
  HF_TEXT_TO_VIDEO_MODELS,
  generateHfTextToVideoClip,
  resolveHfTextToVideoModel
};
