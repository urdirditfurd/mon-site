"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

const HF_API_BASE = "https://huggingface.co/api";
const FAL_QUEUE_BASE = "https://queue.fal.run";
const REPLICATE_API_BASE = "https://api.replicate.com/v1";
const NOVITA_API_BASE = "https://api.novita.ai/v3";

const PROVIDER_FAL = "fal";
const PROVIDER_REPLICATE = "replicate";
const PROVIDER_NOVITA = "novita";
const PROVIDER_LOCAL = "local";

/**
 * Catalogue des modèles text-to-video supportés, ordonnés par téléchargements
 * sur Hugging Face (au moment de l'intégration) et adaptés à un usage massif.
 *
 * Pour chaque modèle on déclare :
 *  - sa famille HF (référence du `modelId` officiel)
 *  - une liste de providers qui peuvent l'exécuter, dans l'ordre de préférence
 *  - les paramètres par défaut (durée max, ratios, etc.)
 */
const MODEL_CATALOG = {
  // Modèle "marque" du projet : SulphurAI/Sulphur-2-base (top téléchargements HF).
  // Pas d'inference provider officiel pour le poids brut → on utilise sa base
  // (Lightricks/LTX-2.3 / LTX-Video) via fal-ai/replicate, et le mode local
  // pour faire tourner le vrai poids Sulphur-2 si une GPU est dispo.
  "sulphur-2": {
    label: "Sulphur-2 (LTX-2.3, top téléchargements HF)",
    hfModelId: "SulphurAI/Sulphur-2-base",
    family: "ltx",
    providers: [PROVIDER_LOCAL, PROVIDER_FAL, PROVIDER_REPLICATE],
    falEndpoints: ["fal-ai/ltx-video", "fal-ai/ltx-video-v095"],
    replicateModel: "lightricks/ltx-video",
    defaultDurationSec: 5,
    maxDurationSec: 10,
    allowedAspectRatios: ["9:16", "16:9", "1:1"],
    localScript: "scripts/sulphur_generate.py",
    localPipeline: "sulphur-2"
  },
  "ltx-video": {
    label: "Lightricks LTX-Video (rapide, 5s)",
    hfModelId: "Lightricks/LTX-Video",
    family: "ltx",
    providers: [PROVIDER_FAL, PROVIDER_REPLICATE, PROVIDER_LOCAL],
    falEndpoints: ["fal-ai/ltx-video", "fal-ai/ltx-video-v095"],
    replicateModel: "lightricks/ltx-video",
    defaultDurationSec: 5,
    maxDurationSec: 10,
    allowedAspectRatios: ["9:16", "16:9", "1:1"],
    localScript: "scripts/sulphur_generate.py",
    localPipeline: "ltx-video"
  },
  "wan-2.2-t2v": {
    label: "Wan 2.2 T2V A14B (qualité, cinéma)",
    hfModelId: "Wan-AI/Wan2.2-T2V-A14B-Diffusers",
    family: "wan",
    providers: [PROVIDER_FAL, PROVIDER_REPLICATE, PROVIDER_LOCAL],
    falEndpoints: ["fal-ai/wan/v2.2-a14b/text-to-video", "fal-ai/wan-t2v"],
    replicateModel: "wavespeedai/wan-2.2-t2v",
    defaultDurationSec: 5,
    maxDurationSec: 8,
    allowedAspectRatios: ["9:16", "16:9", "1:1"],
    localScript: "scripts/sulphur_generate.py",
    localPipeline: "wan-2.2"
  },
  "wan-2.1-t2v": {
    label: "Wan 2.1 T2V 14B (équilibre)",
    hfModelId: "Wan-AI/Wan2.1-T2V-14B-Diffusers",
    family: "wan",
    providers: [PROVIDER_FAL, PROVIDER_REPLICATE, PROVIDER_LOCAL],
    falEndpoints: ["fal-ai/wan-t2v", "fal-ai/wan/v2.1-14b/text-to-video"],
    replicateModel: "wavespeedai/wan-2.1-t2v",
    defaultDurationSec: 5,
    maxDurationSec: 8,
    allowedAspectRatios: ["9:16", "16:9", "1:1"],
    localScript: "scripts/sulphur_generate.py",
    localPipeline: "wan-2.1"
  },
  kling: {
    label: "Kling v2 Master (réaliste)",
    hfModelId: null,
    family: "kling",
    providers: [PROVIDER_FAL],
    falEndpoints: ["fal-ai/kling-video/v2/master/text-to-video"],
    defaultDurationSec: 5,
    maxDurationSec: 10,
    allowedAspectRatios: ["9:16", "16:9", "1:1"]
  },
  "kling-turbo": {
    label: "Kling 1.6 Standard (rapide)",
    hfModelId: null,
    family: "kling",
    providers: [PROVIDER_FAL],
    falEndpoints: ["fal-ai/kling-video/v1.6/standard/text-to-video"],
    defaultDurationSec: 5,
    maxDurationSec: 10,
    allowedAspectRatios: ["9:16", "16:9", "1:1"]
  },
  minimax: {
    label: "MiniMax Hailuo (humain)",
    hfModelId: null,
    family: "minimax",
    providers: [PROVIDER_FAL, PROVIDER_REPLICATE],
    falEndpoints: ["fal-ai/minimax/video-01-live/text-to-video", "fal-ai/minimax-video"],
    replicateModel: "minimax/video-01",
    defaultDurationSec: 6,
    maxDurationSec: 6,
    allowedAspectRatios: ["9:16", "16:9", "1:1"]
  }
};

const DEFAULT_MODEL_KEY = "sulphur-2";

function listModels() {
  return Object.entries(MODEL_CATALOG).map(([key, m]) => ({
    key,
    label: m.label,
    hfModelId: m.hfModelId,
    family: m.family,
    providers: m.providers,
    defaultDurationSec: m.defaultDurationSec,
    maxDurationSec: m.maxDurationSec,
    allowedAspectRatios: m.allowedAspectRatios
  }));
}

function resolveModel(modelKey) {
  if (!modelKey) return MODEL_CATALOG[DEFAULT_MODEL_KEY];
  const key = String(modelKey).toLowerCase().trim();
  if (MODEL_CATALOG[key]) return MODEL_CATALOG[key];
  // Tolérance : on accepte aussi un alias ou un nom partiel.
  const alias = Object.keys(MODEL_CATALOG).find((k) => k.includes(key) || key.includes(k));
  return alias ? MODEL_CATALOG[alias] : MODEL_CATALOG[DEFAULT_MODEL_KEY];
}

function normalizeAspectRatio(ratio, model) {
  const value = String(ratio || "9:16");
  const allowed = model?.allowedAspectRatios || ["9:16", "16:9", "1:1"];
  return allowed.includes(value) ? value : allowed[0];
}

function clampDuration(seconds, model) {
  const max = model?.maxDurationSec || 10;
  const def = model?.defaultDurationSec || 5;
  const value = Math.round(Number(seconds) || def);
  if (Number.isNaN(value) || value <= 0) return def;
  return Math.min(max, Math.max(2, value));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries(operation, { attempts = 3, baseDelayMs = 800, label = "op" } = {}) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await operation(i);
    } catch (error) {
      lastError = error;
      const retriable = isRetriableError(error);
      if (!retriable || i === attempts - 1) break;
      const delay = baseDelayMs * 2 ** i;
      await sleep(delay);
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${label}: ${message}`);
}

function isRetriableError(error) {
  if (!error) return false;
  const message = (error && error.message) || String(error);
  if (/status\s*5\d\d/i.test(message)) return true;
  if (/\b(429|408)\b/.test(message)) return true;
  if (/timeout|temporarily|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(message)) return true;
  return false;
}

async function httpJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const detail = body?.detail || body?.message || body?.error || text || res.statusText;
    const msg = typeof detail === "string" ? detail : JSON.stringify(detail);
    throw new Error(`HTTP ${res.status} ${msg.slice(0, 400)}`);
  }
  return body;
}

async function downloadToFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Téléchargement impossible (${res.status}) ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(destPath, buf);
  return destPath;
}

// ===== fal-ai =====

async function falSubmit({ endpoint, apiKey, payload }) {
  return httpJson(`${FAL_QUEUE_BASE}/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

async function falPollUntilDone({ endpoint, apiKey, requestId, maxAttempts = 180, intervalMs = 4000 }) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const status = await httpJson(
      `${FAL_QUEUE_BASE}/${endpoint}/requests/${requestId}/status`,
      { headers: { Authorization: `Key ${apiKey}` } }
    );
    const state = String(status.status || "").toUpperCase();
    switch (state) {
      case "COMPLETED": {
        const result = await httpJson(
          `${FAL_QUEUE_BASE}/${endpoint}/requests/${requestId}`,
          { headers: { Authorization: `Key ${apiKey}` } }
        );
        return result;
      }
      case "FAILED":
      case "ERROR":
        throw new Error(`fal ${endpoint} ${state}: ${status.error || "échec"}`);
      case "IN_QUEUE":
      case "IN_PROGRESS":
      case "STARTED":
      case "":
        await sleep(intervalMs);
        break;
      default:
        await sleep(intervalMs);
        break;
    }
  }
  throw new Error(`fal ${endpoint} timeout`);
}

function extractFalVideoUrl(result) {
  return (
    result?.video?.url ||
    result?.data?.video?.url ||
    result?.output?.video?.url ||
    result?.response?.video?.url ||
    (Array.isArray(result?.videos) && result.videos[0]?.url) ||
    null
  );
}

async function generateOnFal({ model, prompt, durationSec, aspectRatio, apiKey, signal }) {
  if (!apiKey) throw new Error("Clé fal-ai manquante");
  if (!Array.isArray(model.falEndpoints) || !model.falEndpoints.length) {
    throw new Error(`Modèle ${model.label} non supporté sur fal-ai`);
  }
  const errors = [];
  for (const endpoint of model.falEndpoints) {
    try {
      const payload = {
        prompt,
        duration: String(durationSec),
        aspect_ratio: aspectRatio,
        // Champs spécifiques LTX/Wan, ignorés sans dommage par fal pour Kling.
        num_frames: model.family === "ltx" ? Math.round(durationSec * 25) : undefined,
        resolution: model.family === "ltx" ? "720p" : undefined
      };
      Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
      const submitted = await falSubmit({ endpoint, apiKey, payload });
      const requestId = submitted.request_id || submitted.requestId;
      if (!requestId) throw new Error("fal n'a pas renvoyé de request_id");
      checkAborted(signal);
      const result = await falPollUntilDone({ endpoint, apiKey, requestId });
      const url = extractFalVideoUrl(result);
      if (!url) throw new Error("URL vidéo absente dans la réponse fal");
      return { url, provider: PROVIDER_FAL, endpoint, requestId };
    } catch (error) {
      errors.push(`${endpoint}: ${(error && error.message) || error}`);
    }
  }
  throw new Error(`fal-ai a échoué sur tous les endpoints (${errors.join(" | ")})`);
}

// ===== Replicate =====

async function generateOnReplicate({ model, prompt, durationSec, aspectRatio, apiKey, signal }) {
  if (!apiKey) throw new Error("Clé Replicate manquante");
  if (!model.replicateModel) throw new Error(`Modèle ${model.label} non supporté sur Replicate`);
  const input = {
    prompt,
    aspect_ratio: aspectRatio,
    duration: durationSec,
    num_frames: model.family === "ltx" ? Math.round(durationSec * 25) : undefined
  };
  Object.keys(input).forEach((k) => input[k] === undefined && delete input[k]);
  const created = await httpJson(`${REPLICATE_API_BASE}/models/${model.replicateModel}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Prefer: "wait=60"
    },
    body: JSON.stringify({ input })
  });
  let prediction = created;
  for (let i = 0; i < 240; i += 1) {
    checkAborted(signal);
    if (prediction.status === "succeeded") break;
    if (prediction.status === "failed" || prediction.status === "canceled") {
      throw new Error(`Replicate ${prediction.status}: ${prediction.error || ""}`);
    }
    await sleep(3000);
    prediction = await httpJson(`${REPLICATE_API_BASE}/predictions/${prediction.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
  }
  if (prediction.status !== "succeeded") throw new Error(`Replicate timeout (${prediction.status})`);
  const output = prediction.output;
  const url = Array.isArray(output) ? output[output.length - 1] : output;
  if (!url || typeof url !== "string") throw new Error("Replicate n'a pas renvoyé d'URL vidéo");
  return { url, provider: PROVIDER_REPLICATE, predictionId: prediction.id };
}

// ===== Novita =====

async function generateOnNovita({ model, prompt, durationSec, aspectRatio, apiKey, signal }) {
  if (!apiKey) throw new Error("Clé Novita manquante");
  const task = await httpJson(`${NOVITA_API_BASE}/async/txt2video`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model_name: model.family === "wan" ? "wan-2.1-t2v" : "ltx-video",
      prompt,
      width: aspectRatio === "9:16" ? 720 : aspectRatio === "16:9" ? 1280 : 720,
      height: aspectRatio === "9:16" ? 1280 : aspectRatio === "16:9" ? 720 : 720,
      seconds: durationSec
    })
  });
  const taskId = task.task_id || task.task?.task_id;
  if (!taskId) throw new Error("Novita: task_id manquant");
  for (let i = 0; i < 240; i += 1) {
    checkAborted(signal);
    await sleep(3000);
    const poll = await httpJson(`${NOVITA_API_BASE}/async/task-result?task_id=${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const status = poll.task?.status || poll.status;
    if (status === "TASK_STATUS_SUCCEED") {
      const url =
        poll.videos?.[0]?.video_url ||
        poll.videos?.[0]?.url ||
        poll.task?.video?.url;
      if (!url) throw new Error("Novita: URL vidéo manquante");
      return { url, provider: PROVIDER_NOVITA, taskId };
    }
    if (status === "TASK_STATUS_FAILED") throw new Error(`Novita FAILED: ${poll.task?.reason || ""}`);
  }
  throw new Error("Novita timeout");
}

// ===== Local (Python diffusers) =====

function getPythonExecutable() {
  return process.env.SULPHUR_PYTHON || "python3";
}

let cachedLocalScriptPath = null;
function resolveLocalScriptPath(model) {
  if (cachedLocalScriptPath) return cachedLocalScriptPath;
  const candidates = [
    model.localScript && path.resolve(__dirname, "..", model.localScript),
    path.resolve(__dirname, "..", "scripts", "sulphur_generate.py")
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      cachedLocalScriptPath = c;
      return c;
    }
  }
  return null;
}

async function isLocalAvailable(model) {
  const scriptPath = resolveLocalScriptPath(model);
  if (!scriptPath) return false;
  if (process.env.SULPHUR_LOCAL === "0") return false;
  return new Promise((resolve) => {
    const proc = spawn(getPythonExecutable(), ["-c", "import diffusers, torch; print('ok')"], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let ok = false;
    proc.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("ok")) ok = true;
    });
    proc.on("close", (code) => resolve(code === 0 && ok));
    proc.on("error", () => resolve(false));
  });
}

function generateOnLocal({ model, prompt, durationSec, aspectRatio, outputPath, signal }) {
  const scriptPath = resolveLocalScriptPath(model);
  if (!scriptPath) throw new Error("Script local Sulphur introuvable");
  const args = [
    scriptPath,
    "--pipeline", model.localPipeline || model.family,
    "--prompt", prompt,
    "--duration", String(durationSec),
    "--aspect-ratio", aspectRatio,
    "--output", outputPath
  ];
  if (model.hfModelId) {
    args.push("--model-id", model.hfModelId);
  }
  return new Promise((resolve, reject) => {
    const proc = spawn(getPythonExecutable(), args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stdout.on("data", (chunk) => {
      process.stdout.write(`[sulphur-local] ${chunk.toString()}`);
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    if (signal) {
      signal.addEventListener?.("abort", () => proc.kill("SIGTERM"));
    }
    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ url: null, provider: PROVIDER_LOCAL, localPath: outputPath });
      } else {
        reject(new Error(`Python local exit ${code}: ${stderr.slice(-400)}`));
      }
    });
    proc.on("error", reject);
  });
}

function checkAborted(signal) {
  if (signal?.aborted) throw new Error("Annulé");
}

// ===== Orchestrateur multi-providers =====

/**
 * Génère un clip vidéo à partir d'un prompt en essayant successivement les
 * providers disponibles, avec retries et téléchargement local.
 *
 * @param {object} args
 * @param {string} args.prompt
 * @param {string} [args.modelKey]
 * @param {number} [args.durationSec]
 * @param {string} [args.aspectRatio]
 * @param {string} args.outputPath  chemin .mp4 final souhaité côté serveur
 * @param {object} args.keys        { fal, replicate, novita, hf }
 * @param {string[]} [args.providerOrder] override de l'ordre des providers
 * @param {AbortSignal} [args.signal]
 * @param {(msg: string) => void} [args.onLog]
 */
async function generateClip({
  prompt,
  modelKey,
  durationSec,
  aspectRatio,
  outputPath,
  keys = {},
  providerOrder,
  signal,
  onLog
}) {
  const log = typeof onLog === "function" ? onLog : () => {};
  const text = String(prompt || "").trim();
  if (!text) throw new Error("prompt requis");
  const model = resolveModel(modelKey);
  const ratio = normalizeAspectRatio(aspectRatio, model);
  const seconds = clampDuration(durationSec, model);

  const order = Array.isArray(providerOrder) && providerOrder.length
    ? providerOrder.filter((p) => model.providers.includes(p))
    : model.providers;

  const errors = [];
  for (const provider of order) {
    checkAborted(signal);
    try {
      log(`provider=${provider} model=${model.label} duration=${seconds}s ratio=${ratio}`);
      let attempt;
      if (provider === PROVIDER_FAL) {
        attempt = await withRetries(
          () => generateOnFal({ model, prompt: text, durationSec: seconds, aspectRatio: ratio, apiKey: keys.fal, signal }),
          { attempts: 2, label: `fal:${model.label}` }
        );
      } else if (provider === PROVIDER_REPLICATE) {
        attempt = await withRetries(
          () => generateOnReplicate({ model, prompt: text, durationSec: seconds, aspectRatio: ratio, apiKey: keys.replicate, signal }),
          { attempts: 2, label: `replicate:${model.label}` }
        );
      } else if (provider === PROVIDER_NOVITA) {
        attempt = await withRetries(
          () => generateOnNovita({ model, prompt: text, durationSec: seconds, aspectRatio: ratio, apiKey: keys.novita, signal }),
          { attempts: 2, label: `novita:${model.label}` }
        );
      } else if (provider === PROVIDER_LOCAL) {
        const available = await isLocalAvailable(model);
        if (!available) throw new Error("Mode local non installé (python+diffusers+torch requis)");
        attempt = await generateOnLocal({ model, prompt: text, durationSec: seconds, aspectRatio: ratio, outputPath, signal });
      } else {
        throw new Error(`Provider inconnu: ${provider}`);
      }

      if (attempt.url) {
        await downloadToFile(attempt.url, outputPath);
      } else if (!fs.existsSync(outputPath)) {
        throw new Error("Le provider local n'a pas produit de fichier vidéo");
      }
      const stats = await fsp.stat(outputPath);
      log(`OK provider=${provider} size=${stats.size}`);
      return {
        provider,
        model: model.label,
        modelKey: Object.keys(MODEL_CATALOG).find((k) => MODEL_CATALOG[k] === model),
        hfModelId: model.hfModelId,
        url: attempt.url || null,
        path: outputPath,
        size: stats.size,
        durationSec: seconds,
        aspectRatio: ratio
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`provider=${provider} ÉCHEC: ${message}`);
      errors.push(`${provider}: ${message}`);
    }
  }
  throw new Error(`Tous les providers ont échoué : ${errors.join(" | ")}`);
}

/**
 * Génère N prompts en parallèle (concurrence limitée), avec rotation automatique
 * des providers. Conçu pour les flux massifs (batch quotidien sans limite).
 */
async function generateBulk({
  prompts,
  modelKey,
  durationSec,
  aspectRatio,
  outputDir,
  keys,
  concurrency = 2,
  providerOrder,
  signal,
  onProgress,
  onLog
}) {
  await fsp.mkdir(outputDir, { recursive: true });
  const list = Array.isArray(prompts) ? prompts.filter((p) => String(p || "").trim()) : [];
  if (!list.length) throw new Error("Aucun prompt non vide");

  const results = new Array(list.length).fill(null);
  let next = 0;
  let done = 0;
  const limit = Math.max(1, Math.min(8, Number(concurrency) || 2));

  async function worker(workerId) {
    while (true) {
      checkAborted(signal);
      const i = next;
      next += 1;
      if (i >= list.length) return;
      const prompt = list[i];
      const out = path.join(outputDir, `clip-${String(i + 1).padStart(3, "0")}.mp4`);
      try {
        const r = await generateClip({
          prompt,
          modelKey,
          durationSec,
          aspectRatio,
          outputPath: out,
          keys,
          providerOrder,
          signal,
          onLog: (m) => onLog?.(`[w${workerId}#${i + 1}] ${m}`)
        });
        results[i] = { index: i + 1, prompt, status: "succeeded", ...r };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results[i] = { index: i + 1, prompt, status: "failed", error: message };
      } finally {
        done += 1;
        onProgress?.({ done, total: list.length });
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, list.length) }, (_, i) => worker(i + 1));
  await Promise.all(workers);
  return results;
}

/**
 * Planificateur de scènes intégré (sans dépendance LLM externe) pour fabriquer
 * une vidéo longue. Si une clé Mistral est fournie, on s'en sert pour un script
 * plus riche ; sinon, on génère un plan déterministe à partir du topic.
 */
async function planScenes({ topic, durationSec, sceneSec, mistralKey, mistralModel = "mistral-small-2506" }) {
  const cleanTopic = String(topic || "").trim();
  if (!cleanTopic) throw new Error("topic requis");
  const sceneLen = Math.max(2, Number(sceneSec) || 5);
  const totalLen = Math.max(sceneLen, Number(durationSec) || 30);
  const sceneCount = Math.max(1, Math.min(120, Math.ceil(totalLen / sceneLen)));

  if (mistralKey) {
    try {
      return await planScenesWithMistral({ topic: cleanTopic, sceneCount, sceneLen, mistralKey, mistralModel });
    } catch (error) {
      // On retombe sur le plan déterministe en cas d'échec Mistral.
    }
  }

  const seeds = [
    `establishing shot, ${cleanTopic}, cinematic wide, golden hour`,
    `dynamic close-up, ${cleanTopic}, shallow depth of field`,
    `aerial drone view, ${cleanTopic}, vast landscape`,
    `slow motion detail, ${cleanTopic}, particles in the air`,
    `night scene, ${cleanTopic}, neon lights, rain reflections`,
    `over-the-shoulder shot, ${cleanTopic}, intense focus`,
    `tracking shot, ${cleanTopic}, fast camera movement`,
    `macro detail, ${cleanTopic}, glistening textures`,
    `silhouette against bright background, ${cleanTopic}, dramatic light`,
    `final hero shot, ${cleanTopic}, triumphant atmosphere`
  ];
  const scenes = Array.from({ length: sceneCount }, (_, i) => ({
    index: i + 1,
    visualPrompt: `${seeds[i % seeds.length]}. Photoreal, original content, no logos, no text overlay.`,
    durationSec: sceneLen
  }));
  return { title: cleanTopic, scenes };
}

async function planScenesWithMistral({ topic, sceneCount, sceneLen, mistralKey, mistralModel }) {
  const prompt = `Tu es directeur·rice créatif·ve vidéo. Génère un plan original pour une vidéo de ${sceneCount * sceneLen} secondes sur le sujet : ${topic}.\n` +
    `Format de sortie : JSON strict.\n` +
    `Règles : ${sceneCount} scènes, ${sceneLen}s chacune. Pas de texte à l'écran. Pas de logos. Pas de visages de célébrités.\n` +
    `Schéma : { "title": "...", "scenes": [ { "index": 1, "visualPrompt": "description visuelle en anglais", "durationSec": ${sceneLen} } ] }`;
  const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${mistralKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: mistralModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      response_format: { type: "json_object" },
      max_tokens: Math.min(16000, 600 + sceneCount * 120)
    })
  });
  if (!res.ok) throw new Error(`Mistral ${res.status}`);
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || "";
  const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
  if (!Array.isArray(parsed.scenes) || !parsed.scenes.length) throw new Error("Plan Mistral invalide");
  return {
    title: parsed.title || topic,
    scenes: parsed.scenes.slice(0, sceneCount).map((s, i) => ({
      index: i + 1,
      visualPrompt: String(s.visualPrompt || s.prompt || topic),
      durationSec: Number(s.durationSec) || sceneLen
    }))
  };
}

/**
 * Concatène une liste de clips locaux en une seule vidéo via FFmpeg.
 */
function concatClips({ clipPaths, outputPath }) {
  return new Promise((resolve, reject) => {
    const listPath = `${outputPath}.list.txt`;
    const content = clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
    fs.writeFileSync(listPath, content, "utf8");
    const args = ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath];
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("close", (code) => {
      try { fs.unlinkSync(listPath); } catch { /* ignore */ }
      if (code === 0) {
        resolve(outputPath);
      } else {
        // Si copy échoue (codecs différents), on retente avec ré-encodage uniforme.
        const reArgs = [
          "-y", "-f", "concat", "-safe", "0", "-i", listPath,
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
          "-c:a", "aac", "-b:a", "128k",
          outputPath
        ];
        fs.writeFileSync(listPath, content, "utf8");
        const reproc = spawn("ffmpeg", reArgs, { stdio: ["ignore", "pipe", "pipe"] });
        let re2 = "";
        reproc.stderr.on("data", (c) => { re2 += c.toString(); });
        reproc.on("close", (code2) => {
          try { fs.unlinkSync(listPath); } catch { /* ignore */ }
          if (code2 === 0) resolve(outputPath);
          else reject(new Error(`ffmpeg concat: ${(re2 || stderr).slice(-400)}`));
        });
      }
    });
  });
}

module.exports = {
  MODEL_CATALOG,
  DEFAULT_MODEL_KEY,
  PROVIDER_FAL,
  PROVIDER_REPLICATE,
  PROVIDER_NOVITA,
  PROVIDER_LOCAL,
  listModels,
  resolveModel,
  generateClip,
  generateBulk,
  planScenes,
  concatClips,
  isLocalAvailable
};
