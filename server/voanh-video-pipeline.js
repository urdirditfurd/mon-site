const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const FAL_QUEUE_BASE = "https://queue.fal.run";
const DEFAULT_FAL_MODEL = "fal-ai/kling-video/v2/master/text-to-video";
const DEFAULT_HF_MODEL = process.env.HF_TEXT_TO_VIDEO_MODEL || "Wan-AI/Wan2.1-T2V-1.3B-Diffusers";
const DEFAULT_HF_NEGATIVE_PROMPT =
  "low quality, blurry, watermark, logo, text overlay, subtitle, deformed face, static frame, low detail";
const HF_VIDEO_SCRIPT_PATH = path.join(__dirname, "hf-text-to-video.py");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function boolFrom(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const str = String(value).trim().toLowerCase();
  return str === "1" || str === "true" || str === "yes" || str === "on";
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function resolveProvider(rawProvider) {
  const value = String(rawProvider || "").trim().toLowerCase();
  if (!value || value === "fal") return "fal";
  if (value === "huggingface-local" || value === "huggingface" || value === "hf-local") {
    return "huggingface-local";
  }
  return "fal";
}

function resolveFalModel(modelKey) {
  const map = {
    kling: DEFAULT_FAL_MODEL,
    klingTurbo: "fal-ai/kling-video/v1.6/standard/text-to-video"
  };
  return map[modelKey] || modelKey || DEFAULT_FAL_MODEL;
}

function getDimensionsFromAspectRatio(aspectRatio) {
  const ratio = String(aspectRatio || "9:16").trim();
  if (ratio === "16:9") return { width: 832, height: 480 };
  if (ratio === "1:1") return { width: 640, height: 640 };
  return { width: 480, height: 832 };
}

function buildLocalScenePlan({ topic, durationMin, clipSec, aspectRatio }) {
  const sceneCount = Math.max(1, Math.ceil((durationMin * 60) / clipSec));
  const beats = [
    "opening wide establishing shot",
    "medium dynamic camera movement",
    "cinematic close-up with strong emotion",
    "action-focused tracking movement",
    "atmospheric transition with depth",
    "hero shot with dramatic lighting",
    "slow motion emotional beat",
    "final impactful closing shot"
  ];
  const tones = [
    "cinematic realism",
    "high detail textures",
    "natural motion",
    "film color grading",
    "rich contrast",
    "ultra clear subject focus"
  ];
  const scenes = Array.from({ length: sceneCount }, (_item, index) => {
    const beat = beats[index % beats.length];
    const tone = tones[index % tones.length];
    const visualPrompt = `${beat}, ${tone}, topic: ${topic}, no logos, no subtitles, no watermark, ${aspectRatio} framing`;
    return {
      index: index + 1,
      visualPrompt,
      narration: `Scène ${index + 1} autour du thème: ${topic}.`,
      durationSec: clipSec
    };
  });
  return {
    title: `Vidéo IA - ${topic}`,
    scenes
  };
}

function runHfTextToVideo({
  prompt,
  outputPath,
  modelId,
  negativePrompt,
  durationSec,
  fps,
  guidanceScale,
  steps,
  seed,
  device,
  enableCpuOffload,
  aspectRatio
}) {
  const pythonBin = process.env.PYTHON_BIN || "python3";
  const dims = getDimensionsFromAspectRatio(aspectRatio);
  const args = [
    HF_VIDEO_SCRIPT_PATH,
    "--prompt",
    prompt,
    "--output",
    outputPath,
    "--model-id",
    modelId || DEFAULT_HF_MODEL,
    "--negative-prompt",
    negativePrompt || DEFAULT_HF_NEGATIVE_PROMPT,
    "--duration-sec",
    String(durationSec),
    "--fps",
    String(fps),
    "--guidance-scale",
    String(guidanceScale),
    "--num-inference-steps",
    String(steps),
    "--width",
    String(dims.width),
    "--height",
    String(dims.height)
  ];
  if (Number.isFinite(seed) && seed >= 0) {
    args.push("--seed", String(seed));
  }
  if (device) {
    args.push("--device", String(device));
  }
  if (enableCpuOffload) {
    args.push("--enable-cpu-offload");
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(pythonBin, args, {
      cwd: path.dirname(HF_VIDEO_SCRIPT_PATH),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (error) => {
      reject(new Error(`Impossible de lancer ${pythonBin}: ${error.message}`));
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.slice(-1200) || `hf-text-to-video exit ${code}`));
        return;
      }
      const raw = stdout.trim();
      if (!raw) {
        resolve({ output: outputPath });
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({ output: outputPath, raw });
      }
    });
  });
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
  const prompt = `Tu es un directeur de création vidéo YouTube. Génère un plan pour une vidéo ORIGINALE de ${durationMin} minutes.

Sujet : ${topic}
Format : ${aspectRatio}
Durée par scène : ${clipSec} secondes
Nombre de scènes EXACT : ${sceneCount}

Règles :
- Contenu 100% original, pas de logos, pas de visages de célébrités
- Prompts visuels cinématiques pour IA (silhouettes, ambiance, pas de texte à l'écran)
- Narration voix-off en français pour chaque scène
- Histoire cohérente du début à la fin

Réponds UNIQUEMENT en JSON valide :
{
  "title": "titre accrocheur",
  "scenes": [
    {
      "index": 1,
      "visualPrompt": "description visuelle détaillée en anglais pour IA vidéo",
      "narration": "texte voix-off français",
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
    throw new Error("Plan de scènes invalide");
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
      if (!url) throw new Error("URL vidéo absente dans la réponse FAL");
      return url;
    }
    if (state === "FAILED" || state === "ERROR") {
      throw new Error(status.error || "Échec génération clip FAL");
    }
    await sleep(4000);
  }
  throw new Error("Timeout génération clip FAL");
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Téléchargement impossible: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(destPath, buf);
  return destPath;
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
        /* ignore corrupt db */
      }
    }
    loaded = true;
  }

  function sanitizeJob(job) {
    if (!job) return null;
    const safeConfig = { ...(job.config || {}) };
    delete safeConfig.mistralKey;
    delete safeConfig.falKey;
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
    const provider = resolveProvider(job.config?.provider);
    const ffmpegReady = typeof getFfmpegReady === "function" ? getFfmpegReady() : false;
    const normalizedDurationMin = Math.max(0.1, toNumber(job.config?.durationMin, 10));
    const normalizedClipSec = Math.max(3, Math.min(20, toNumber(job.config?.clipSec, 5)));
    const estimatedSceneCount = Math.max(1, Math.ceil((normalizedDurationMin * 60) / normalizedClipSec));
    const needsConcat = estimatedSceneCount > 1;
    if (!ffmpegReady && needsConcat) {
      await updateJob(jobId, { status: "failed", error: "ffmpeg indisponible sur le serveur" });
      return;
    }

    const {
      topic,
      durationMin = normalizedDurationMin,
      clipSec = normalizedClipSec,
      aspectRatio,
      mistralKey,
      falKey,
      modelPath,
      mistralModel,
      hfModelId,
      hfNegativePrompt,
      hfSteps,
      hfGuidanceScale,
      hfFps,
      hfDevice,
      hfEnableCpuOffload,
      hfSeed
    } = job.config;

    const resolvedModel = resolveFalModel(modelPath);
    const jobDir = path.join(videoJobsDir, jobId);
    await fsp.mkdir(jobDir, { recursive: true });

    try {
      await updateJob(jobId, { status: "planning", progress: 3 });
      if (provider === "huggingface-local") {
        await appendLog(jobId, "Planification locale des scènes (sans API externe)...");
      } else {
        await appendLog(jobId, "Planification des scènes via Mistral…");
      }

      const plan =
        provider === "huggingface-local"
          ? buildLocalScenePlan({ topic, durationMin, clipSec, aspectRatio })
          : await planScenesWithMistral({
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
      await appendLog(jobId, `Plan OK : ${plan.title} (${plan.scenes.length} scènes)`);

      const clipUrls = [];
      const localClips = [];
      for (let i = 0; i < plan.scenes.length; i += 1) {
        const scene = plan.scenes[i];
        const visual = `${scene.visualPrompt}. Cinematic, original content, no logos, no celebrity faces, no text overlay.`;
        const clipPath = path.join(jobDir, `clip-${String(i + 1).padStart(3, "0")}.mp4`);

        if (provider === "huggingface-local") {
          await appendLog(jobId, `Clip ${i + 1}/${plan.scenes.length} : génération Hugging Face locale`);
          const seedForClip = Number.isFinite(hfSeed) && hfSeed >= 0 ? hfSeed + i : -1;
          await runHfTextToVideo({
            prompt: visual,
            outputPath: clipPath,
            modelId: hfModelId,
            negativePrompt: hfNegativePrompt,
            durationSec: clipSec,
            fps: hfFps,
            guidanceScale: hfGuidanceScale,
            steps: hfSteps,
            seed: seedForClip,
            device: hfDevice,
            enableCpuOffload: hfEnableCpuOffload,
            aspectRatio
          });
          localClips.push(clipPath);
          clipUrls.push(`file://${clipPath}`);
        } else {
          await appendLog(jobId, `Clip ${i + 1}/${plan.scenes.length} : soumission FAL`);
          const submit = await falFetch(`${FAL_QUEUE_BASE}/${resolvedModel}`, falKey, {
            method: "POST",
            body: JSON.stringify({
              prompt: visual,
              duration: String(clipSec),
              aspect_ratio: aspectRatio
            })
          });

          const clipUrl = await pollFalClip({
            falKey,
            modelPath: resolvedModel,
            requestId: submit.request_id
          });
          clipUrls.push(clipUrl);
          await downloadFile(clipUrl, clipPath);
          localClips.push(clipPath);
        }

        const progress = 8 + Math.round(((i + 1) / plan.scenes.length) * 82);
        await updateJob(jobId, {
          progress,
          scenesDone: i + 1,
          clipUrls: [...clipUrls]
        });
        await appendLog(jobId, `Clip ${i + 1} terminé`);
      }

      await updateJob(jobId, { status: "assembling", progress: 92 });
      await appendLog(jobId, "Assemblage FFmpeg de la vidéo longue…");

      const outputPath = path.join(jobDir, "final.mp4");
      if (localClips.length <= 1) {
        await fsp.copyFile(localClips[0], outputPath);
      } else {
        const listPath = path.join(jobDir, "concat.txt");
        const listContent = localClips.map((clip) => `file '${clip.replace(/'/g, "'\\''")}'`).join("\n");
        await fsp.writeFile(listPath, listContent, "utf8");
        await runFfmpegConcat(listPath, outputPath);
      }

      const stats = await fsp.stat(outputPath);
      await updateJob(jobId, {
        status: "completed",
        progress: 100,
        outputPath,
        downloadUrl: `/api/voanh/download/${jobId}`,
        size: stats.size,
        completedAt: new Date().toISOString()
      });
      await appendLog(jobId, "Vidéo longue prête au téléchargement");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await appendLog(jobId, `ERREUR : ${message}`);
      await updateJob(jobId, { status: "failed", error: message, progress: 0 });
    }
  }

  async function createAutoJob(config) {
    await loadJobs();
    const provider = resolveProvider(config.provider);
    const clipSecDefault = provider === "huggingface-local" ? 5 : 10;
    const id = uuidv4();
    const job = {
      id,
      status: "queued",
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: config.topic,
      config: {
        provider,
        topic: String(config.topic || "").trim(),
        durationMin: Math.max(0.1, toNumber(config.durationMin, 10)),
        clipSec: Math.max(3, Math.min(20, toNumber(config.clipSec, clipSecDefault))),
        aspectRatio: String(config.aspectRatio || "9:16"),
        modelPath: String(config.modelPath || DEFAULT_FAL_MODEL),
        mistralModel: String(config.mistralModel || "mistral-small-2506"),
        mistralKey: String(config.mistralKey || "").trim(),
        falKey: String(config.falKey || "").trim(),
        hfModelId: String(config.hfModelId || DEFAULT_HF_MODEL).trim(),
        hfNegativePrompt: String(config.hfNegativePrompt || DEFAULT_HF_NEGATIVE_PROMPT).trim(),
        hfSteps: Math.max(15, Math.min(80, toNumber(config.hfSteps, 30))),
        hfGuidanceScale: Math.max(1, Math.min(12, toNumber(config.hfGuidanceScale, 5))),
        hfFps: Math.max(8, Math.min(30, toNumber(config.hfFps, 15))),
        hfDevice: String(config.hfDevice || "auto").trim(),
        hfEnableCpuOffload: boolFrom(config.hfEnableCpuOffload, false),
        hfSeed: Number.isFinite(Number(config.hfSeed)) ? Number(config.hfSeed) : -1
      },
      logs: [],
      clipUrls: [],
      scenesDone: 0,
      sceneCount: 0
    };

    if (!job.config.topic) throw new Error("topic requis");
    if (provider === "fal" && !job.config.mistralKey) throw new Error("mistralKey requis");
    if (provider === "fal" && !job.config.falKey) throw new Error("falKey requis");

    const sceneCount = Math.max(1, Math.ceil((job.config.durationMin * 60) / job.config.clipSec));
    if (sceneCount > 360) throw new Error("Trop de scènes — réduisez la durée ou augmentez clipSec");

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
  resolveFalModel,
  falFetch,
  pollFalClip,
  downloadFile,
  runFfmpegConcat,
  resolveProvider,
  buildLocalScenePlan,
  runHfTextToVideo,
  FAL_QUEUE_BASE,
  DEFAULT_FAL_MODEL,
  DEFAULT_HF_MODEL
};
