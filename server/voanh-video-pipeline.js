const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const FAL_QUEUE_BASE = "https://queue.fal.run";
const FAL_MODELS = {
  kling: "fal-ai/kling-video/v2/master/text-to-video",
  klingTurbo: "fal-ai/kling-video/v1.6/standard/text-to-video",
  minimax: "fal-ai/minimax/video-01-live/text-to-video"
};

const HF_VIDEO_MODELS = {
  sulphur2: "SulphurAI/Sulphur-2-base",
  wan21_13b: "Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
  wan22_a14b: "Wan-AI/Wan2.2-T2V-A14B-Diffusers"
};

const HF_VIDEO_MODEL_PRESETS = {
  [HF_VIDEO_MODELS.sulphur2]: {
    label: "Sulphur 2 Base",
    maxClipSec: 10,
    fps: 16,
    maxFrames: 161,
    numInferenceSteps: 24,
    guidanceScale: 3.5,
    sizes: {
      "9:16": { width: 704, height: 1216 },
      "16:9": { width: 1216, height: 704 },
      "1:1": { width: 960, height: 960 }
    }
  },
  [HF_VIDEO_MODELS.wan21_13b]: {
    label: "Wan 2.1 T2V 1.3B",
    maxClipSec: 5,
    fps: 15,
    maxFrames: 81,
    numInferenceSteps: 32,
    guidanceScale: 5,
    sizes: {
      "9:16": { width: 480, height: 832 },
      "16:9": { width: 832, height: 480 },
      "1:1": { width: 640, height: 640 }
    }
  },
  [HF_VIDEO_MODELS.wan22_a14b]: {
    label: "Wan 2.2 T2V A14B",
    maxClipSec: 5,
    fps: 16,
    maxFrames: 81,
    numInferenceSteps: 40,
    guidanceScale: 4,
    guidanceScale2: 3,
    sizes: {
      "9:16": { width: 720, height: 1280 },
      "16:9": { width: 1280, height: 720 },
      "1:1": { width: 960, height: 960 }
    }
  }
};

const HF_VIDEO_SERVICE_URL = String(process.env.HF_VIDEO_SERVICE_URL || "").trim().replace(/\/+$/, "");
const HF_VIDEO_SERVICE_TOKEN = String(process.env.HF_VIDEO_SERVICE_TOKEN || "").trim();
const HF_VIDEO_GENERATION_TIMEOUT_MS = Math.max(
  60_000,
  Number(process.env.HF_VIDEO_GENERATION_TIMEOUT_MS) || 45 * 60 * 1000
);
const HF_VIDEO_DEFAULT_MODEL = String(
  process.env.HF_VIDEO_DEFAULT_MODEL || HF_VIDEO_MODELS.sulphur2
).trim();
const HF_VIDEO_NEGATIVE_PROMPT = String(
  process.env.HF_VIDEO_NEGATIVE_PROMPT ||
    "low quality, blurry, watermark, logo, text overlay, subtitles, extra fingers, deformed hands, bad anatomy, static shot, duplicate subject, flicker, overexposed, underexposed, jpeg artifacts"
).trim();
const DEFAULT_VIDEO_PROVIDER = normalizeVideoProvider(
  process.env.VIDEO_PROVIDER || (HF_VIDEO_SERVICE_URL ? "huggingface-local" : "fal")
);
const DEFAULT_FAL_MODEL = FAL_MODELS.kling;
const MAX_AUTO_SCENES = Math.max(90, Number(process.env.VIDEO_MAX_SCENES) || 240);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeVideoProvider(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "huggingface-local" || raw === "hf-local" || raw === "huggingface") {
    return "huggingface-local";
  }
  return "fal";
}

function resolveVideoProvider(value) {
  const provider = normalizeVideoProvider(value || DEFAULT_VIDEO_PROVIDER);
  if (provider === "huggingface-local" && !HF_VIDEO_SERVICE_URL) {
    return "fal";
  }
  return provider;
}

function resolveFalModel(modelKey) {
  return FAL_MODELS[modelKey] || modelKey || DEFAULT_FAL_MODEL;
}

function resolveHfVideoModel(modelKey) {
  return HF_VIDEO_MODELS[modelKey] || modelKey || HF_VIDEO_DEFAULT_MODEL;
}

function getHfVideoModelPreset(modelKey) {
  const modelId = resolveHfVideoModel(modelKey);
  return HF_VIDEO_MODEL_PRESETS[modelId] || HF_VIDEO_MODEL_PRESETS[HF_VIDEO_DEFAULT_MODEL];
}

function providerNeedsFalKey(provider) {
  return resolveVideoProvider(provider) === "fal";
}

function getEffectiveSceneDurationSec({ provider, clipSec, hfModel }) {
  const numericClipSec = Math.max(3, Math.round(Number(clipSec) || 10));
  if (resolveVideoProvider(provider) !== "huggingface-local") {
    return Math.max(5, Math.min(10, numericClipSec));
  }
  const preset = getHfVideoModelPreset(hfModel);
  return Math.max(3, Math.min(preset.maxClipSec, numericClipSec));
}

function resolveRenderSize(aspectRatio, sizes) {
  return sizes[String(aspectRatio || "9:16")] || sizes["9:16"] || { width: 704, height: 1216 };
}

function buildHfVideoRequest({ modelId, aspectRatio, durationSec, prompt }) {
  const preset = getHfVideoModelPreset(modelId);
  const size = resolveRenderSize(aspectRatio, preset.sizes || {});
  const fps = preset.fps || 16;
  const frames = Math.max(33, Math.min(preset.maxFrames || 81, Math.round(durationSec * fps) + 1));
  return {
    model_id: resolveHfVideoModel(modelId),
    prompt,
    negative_prompt: HF_VIDEO_NEGATIVE_PROMPT,
    width: size.width,
    height: size.height,
    fps,
    num_frames: frames,
    num_inference_steps: preset.numInferenceSteps || 24,
    guidance_scale: preset.guidanceScale || 4,
    ...(typeof preset.guidanceScale2 === "number" ? { guidance_scale_2: preset.guidanceScale2 } : {})
  };
}

function getVideoProviderConfig() {
  const defaultProvider = resolveVideoProvider(DEFAULT_VIDEO_PROVIDER);
  return {
    defaultProvider,
    hfServiceConfigured: Boolean(HF_VIDEO_SERVICE_URL),
    providers: [
      {
        id: "huggingface-local",
        label: "Hugging Face local (self-hosted)",
        available: Boolean(HF_VIDEO_SERVICE_URL),
        requiresClientSecret: false,
        recommended: Boolean(HF_VIDEO_SERVICE_URL)
      },
      {
        id: "fal",
        label: "FAL.ai cloud",
        available: true,
        requiresClientSecret: true,
        recommended: !HF_VIDEO_SERVICE_URL
      }
    ],
    models: {
      huggingfaceLocal: Object.entries(HF_VIDEO_MODELS).map(([key, id]) => ({
        key,
        id,
        label: getHfVideoModelPreset(id).label,
        recommended: id === resolveHfVideoModel(HF_VIDEO_DEFAULT_MODEL)
      })),
      fal: Object.entries(FAL_MODELS).map(([key, id]) => ({
        key,
        id,
        label:
          key === "kling"
            ? "Kling 2.0 Master"
            : key === "klingTurbo"
              ? "Kling 1.6 Standard"
              : "MiniMax Video 01"
      }))
    }
  };
}

async function falFetch(url, apiKey, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const msg = body?.detail || body?.message || body?.error || text || res.statusText;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return body;
}

async function planScenesWithMistral({
  mistralKey,
  topic,
  durationMin,
  clipSec,
  aspectRatio,
  mistralModel
}) {
  const sceneCount = Math.ceil((durationMin * 60) / clipSec);
  const prompt = `Tu es un directeur de creation video YouTube. Genere un plan pour une video ORIGINALE de ${durationMin} minutes.

Sujet : ${topic}
Format : ${aspectRatio}
Duree par scene : ${clipSec} secondes
Nombre de scenes EXACT : ${sceneCount}

Regles :
- Contenu 100% original, pas de logos, pas de visages de celebrites
- Prompts visuels cinematographiques pour IA (silhouettes, ambiance, pas de texte a l'ecran)
- Narration voix-off en francais pour chaque scene
- Histoire coherente du debut a la fin

Reponds UNIQUEMENT en JSON valide :
{
  "title": "titre accrocheur",
  "scenes": [
    {
      "index": 1,
      "visualPrompt": "description visuelle detaillee en anglais pour IA video",
      "narration": "texte voix-off francais",
      "durationSec": ${clipSec}
    }
  ]
}`;

  const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${mistralKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: mistralModel || "mistral-small-2506",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.75,
      max_tokens: Math.min(16000, 400 + sceneCount * 120)
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Mistral plan: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || "";
  const clean = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(clean);
  if (!Array.isArray(parsed.scenes) || !parsed.scenes.length) {
    throw new Error("Plan de scenes invalide");
  }
  return { ...parsed, scenes: parsed.scenes.slice(0, sceneCount) };
}

async function pollFalClip({ falKey, modelPath, requestId, maxAttempts = 180 }) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await falFetch(
      `${FAL_QUEUE_BASE}/${modelPath}/requests/${requestId}/status`,
      falKey,
      { method: "GET" }
    );
    const state = String(status.status || "").toUpperCase();
    if (state === "COMPLETED") {
      const result = await falFetch(
        `${FAL_QUEUE_BASE}/${modelPath}/requests/${requestId}`,
        falKey,
        { method: "GET" }
      );
      const url =
        result?.video?.url ||
        result?.data?.video?.url ||
        result?.output?.video?.url ||
        result?.response?.video?.url;
      if (!url) throw new Error("URL video absente dans la reponse FAL");
      return url;
    }
    if (state === "FAILED" || state === "ERROR") {
      throw new Error(status.error || "Echec generation clip FAL");
    }
    await sleep(4000);
  }
  throw new Error("Timeout generation clip FAL");
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Telechargement impossible: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(destPath, buf);
  return destPath;
}

async function generateFalSceneClip({ falKey, modelPath, scene, aspectRatio, destPath }) {
  const visual = `${scene.visualPrompt}. Cinematic, original content, no logos, no celebrity faces, no text overlay.`;
  const durationSec = getEffectiveSceneDurationSec({ provider: "fal", clipSec: scene.durationSec });
  const submit = await falFetch(`${FAL_QUEUE_BASE}/${modelPath}`, falKey, {
    method: "POST",
    body: JSON.stringify({
      prompt: visual,
      duration: String(durationSec),
      aspect_ratio: aspectRatio
    })
  });
  const clipUrl = await pollFalClip({
    falKey,
    modelPath,
    requestId: submit.request_id
  });
  await downloadFile(clipUrl, destPath);
  return { destPath, remoteUrl: clipUrl };
}

async function generateHfSceneClip({ modelId, scene, aspectRatio, destPath }) {
  if (!HF_VIDEO_SERVICE_URL) {
    throw new Error("HF_VIDEO_SERVICE_URL manquante: configurez le service video Hugging Face local.");
  }
  const durationSec = getEffectiveSceneDurationSec({
    provider: "huggingface-local",
    clipSec: scene.durationSec,
    hfModel: modelId
  });
  const visual = `${scene.visualPrompt}. Cinematic, original content, no logos, no celebrity faces, no text overlay.`;
  const payload = buildHfVideoRequest({
    modelId,
    aspectRatio,
    durationSec,
    prompt: visual
  });
  const res = await fetch(`${HF_VIDEO_SERVICE_URL}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(HF_VIDEO_SERVICE_TOKEN ? { Authorization: `Bearer ${HF_VIDEO_SERVICE_TOKEN}` } : {})
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(HF_VIDEO_GENERATION_TIMEOUT_MS)
  });
  if (!res.ok) {
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    throw new Error(body?.detail || body?.error || text || "Generation Hugging Face impossible");
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) {
    throw new Error("Le service Hugging Face a renvoye une video vide");
  }
  await fsp.writeFile(destPath, buf);
  return { destPath, remoteUrl: "" };
}

async function generateSceneClip({
  provider,
  falKey,
  falModelPath,
  hfModel,
  scene,
  aspectRatio,
  destPath
}) {
  if (resolveVideoProvider(provider) === "huggingface-local") {
    return generateHfSceneClip({
      modelId: resolveHfVideoModel(hfModel),
      scene,
      aspectRatio,
      destPath
    });
  }
  return generateFalSceneClip({
    falKey,
    modelPath: resolveFalModel(falModelPath),
    scene,
    aspectRatio,
    destPath
  });
}

function runFfmpegConcat(listPath, outputPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "ffmpeg",
      ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("close", (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(stderr.slice(-800) || `ffmpeg exit ${code}`));
    });
  });
}

function createVideoJobManager({ storageDir, getFfmpegReady }) {
  const videoJobsDir = path.join(storageDir, "voanh-videos");
  const jobsDbPath = path.join(videoJobsDir, "auto-jobs.json");
  const jobs = new Map();
  let loaded = false;

  async function ensureDirs() {
    await fsp.mkdir(videoJobsDir, { recursive: true });
  }

  async function persistJobs() {
    await ensureDirs();
    const payload = {
      updatedAt: new Date().toISOString(),
      jobs: Array.from(jobs.values()).slice(-50)
    };
    await fsp.writeFile(jobsDbPath, JSON.stringify(payload, null, 2), "utf8");
  }

  async function loadJobs() {
    if (loaded) return;
    await ensureDirs();
    if (fs.existsSync(jobsDbPath)) {
      try {
        const raw = JSON.parse(await fsp.readFile(jobsDbPath, "utf8"));
        for (const job of raw.jobs || []) {
          jobs.set(job.id, job);
        }
      } catch {
        // ignore corrupt db
      }
    }
    loaded = true;
  }

  function sanitizeJob(job) {
    const safeConfig = job?.config
      ? {
          ...job.config,
          mistralKey: job.config.mistralKey ? "***" : "",
          falKey: job.config.falKey ? "***" : ""
        }
      : undefined;
    return {
      ...job,
      config: safeConfig
    };
  }

  async function updateJob(jobId, patch) {
    const current = jobs.get(jobId);
    if (!current) return null;
    const next = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    jobs.set(jobId, next);
    await persistJobs();
    return next;
  }

  async function appendLog(jobId, message) {
    const job = jobs.get(jobId);
    if (!job) return;
    const logs = Array.isArray(job.logs) ? job.logs : [];
    logs.push({ at: new Date().toISOString(), message });
    await updateJob(jobId, { logs: logs.slice(-200) });
  }

  async function runAutoJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) return;

    const ffmpegReady = typeof getFfmpegReady === "function" ? getFfmpegReady() : false;
    if (!ffmpegReady) {
      await updateJob(jobId, { status: "failed", error: "ffmpeg indisponible sur le serveur" });
      return;
    }

    const {
      topic,
      durationMin,
      clipSec,
      aspectRatio,
      mistralKey,
      falKey,
      modelPath,
      hfModel,
      mistralModel,
      videoProvider
    } = job.config;

    const resolvedProvider = resolveVideoProvider(videoProvider);
    const resolvedFalModel = resolveFalModel(modelPath);
    const resolvedHfModel = resolveHfVideoModel(hfModel);
    const jobDir = path.join(videoJobsDir, jobId);
    await fsp.mkdir(jobDir, { recursive: true });

    try {
      await updateJob(jobId, { status: "planning", progress: 3 });
      await appendLog(jobId, "Planification des scenes via Mistral...");

      const plan = await planScenesWithMistral({
        mistralKey,
        topic,
        durationMin,
        clipSec,
        aspectRatio,
        mistralModel
      });

      await updateJob(jobId, {
        status: "generating",
        progress: 8,
        title: plan.title,
        sceneCount: plan.scenes.length,
        scenesDone: 0,
        clipUrls: []
      });
      await appendLog(
        jobId,
        `Plan OK : ${plan.title} (${plan.scenes.length} scenes) via ${resolvedProvider === "huggingface-local" ? "Hugging Face local" : "FAL.ai"}`
      );

      const localClips = [];
      const remoteUrls = [];
      for (let i = 0; i < plan.scenes.length; i += 1) {
        const scene = {
          ...plan.scenes[i],
          durationSec: getEffectiveSceneDurationSec({
            provider: resolvedProvider,
            clipSec: plan.scenes[i]?.durationSec || clipSec,
            hfModel: resolvedHfModel
          })
        };
        const clipPath = path.join(jobDir, `clip-${String(i + 1).padStart(3, "0")}.mp4`);
        await appendLog(
          jobId,
          `Clip ${i + 1}/${plan.scenes.length} : generation ${resolvedProvider === "huggingface-local" ? "Hugging Face" : "FAL"}`
        );
        const output = await generateSceneClip({
          provider: resolvedProvider,
          falKey,
          falModelPath: resolvedFalModel,
          hfModel: resolvedHfModel,
          scene,
          aspectRatio,
          destPath: clipPath
        });
        localClips.push(output.destPath || clipPath);
        if (output.remoteUrl) remoteUrls.push(output.remoteUrl);
        const progress = 8 + Math.round(((i + 1) / plan.scenes.length) * 82);
        await updateJob(jobId, {
          progress,
          scenesDone: i + 1,
          clipUrls: [...remoteUrls]
        });
        await appendLog(jobId, `Clip ${i + 1} termine`);
      }

      await updateJob(jobId, { status: "assembling", progress: 92 });
      await appendLog(jobId, "Assemblage FFmpeg de la video longue...");

      const listPath = path.join(jobDir, "concat.txt");
      const listContent = localClips.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
      await fsp.writeFile(listPath, listContent, "utf8");

      const outputPath = path.join(jobDir, "final.mp4");
      await runFfmpegConcat(listPath, outputPath);
      const stats = await fsp.stat(outputPath);

      await updateJob(jobId, {
        status: "completed",
        progress: 100,
        outputPath,
        downloadUrl: `/api/voanh/download/${jobId}`,
        size: stats.size,
        completedAt: new Date().toISOString()
      });
      await appendLog(jobId, "Video longue prete au telechargement");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await appendLog(jobId, `ERREUR : ${message}`);
      await updateJob(jobId, { status: "failed", error: message, progress: 0 });
    }
  }

  async function createAutoJob(config) {
    await loadJobs();
    const resolvedProvider = resolveVideoProvider(config.videoProvider);
    const resolvedFalModel = resolveFalModel(config.modelPath);
    const resolvedHfModel = resolveHfVideoModel(config.hfModel);
    const effectiveClipSec = getEffectiveSceneDurationSec({
      provider: resolvedProvider,
      clipSec: config.clipSec,
      hfModel: resolvedHfModel
    });
    const id = uuidv4();
    const job = {
      id,
      status: "queued",
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: config.topic,
      config: {
        topic: String(config.topic || "").trim(),
        durationMin: Number(config.durationMin) || 10,
        clipSec: effectiveClipSec,
        aspectRatio: String(config.aspectRatio || "9:16"),
        videoProvider: resolvedProvider,
        modelPath: resolvedFalModel,
        hfModel: resolvedHfModel,
        mistralModel: String(config.mistralModel || "mistral-small-2506"),
        mistralKey: String(config.mistralKey || "").trim(),
        falKey: String(config.falKey || "").trim()
      },
      logs: [],
      clipUrls: [],
      scenesDone: 0,
      sceneCount: 0
    };

    if (!job.config.topic) throw new Error("topic requis");
    if (!job.config.mistralKey) throw new Error("mistralKey requis");
    if (providerNeedsFalKey(job.config.videoProvider) && !job.config.falKey) {
      throw new Error("falKey requis");
    }
    if (job.config.videoProvider === "huggingface-local" && !HF_VIDEO_SERVICE_URL) {
      throw new Error("HF_VIDEO_SERVICE_URL absente: le provider Hugging Face local n'est pas configure.");
    }

    const sceneCount = Math.ceil((job.config.durationMin * 60) / job.config.clipSec);
    if (sceneCount > MAX_AUTO_SCENES) {
      throw new Error(`Trop de scenes - reduisez la duree cible ou augmentez la duree par clip (max ${MAX_AUTO_SCENES})`);
    }

    job.sceneCount = sceneCount;
    jobs.set(id, job);
    await persistJobs();

    setImmediate(() => {
      runAutoJob(id).catch(async (err) => {
        const message = err instanceof Error ? err.message : String(err);
        await updateJob(id, { status: "failed", error: message });
      });
    });

    return sanitizeJob(job);
  }

  async function getJob(id) {
    await loadJobs();
    const job = jobs.get(id);
    return job ? sanitizeJob(job) : null;
  }

  async function listJobs() {
    await loadJobs();
    return Array.from(jobs.values())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 20)
      .map(sanitizeJob);
  }

  function getJobOutputPath(id) {
    const job = jobs.get(id);
    return job?.outputPath || null;
  }

  return {
    createAutoJob,
    getJob,
    listJobs,
    getJobOutputPath,
    loadJobs
  };
}

module.exports = {
  createVideoJobManager,
  planScenesWithMistral,
  resolveVideoProvider,
  resolveFalModel,
  resolveHfVideoModel,
  getHfVideoModelPreset,
  getEffectiveSceneDurationSec,
  getVideoProviderConfig,
  providerNeedsFalKey,
  generateSceneClip,
  generateFalSceneClip,
  falFetch,
  pollFalClip,
  downloadFile,
  runFfmpegConcat,
  FAL_QUEUE_BASE,
  FAL_MODELS,
  HF_VIDEO_MODELS,
  DEFAULT_FAL_MODEL,
  DEFAULT_VIDEO_PROVIDER
};
