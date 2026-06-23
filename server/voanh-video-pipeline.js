const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const {
  DEFAULT_HF_MODEL,
  generateHfClip,
  resolveHfModel
} = require("./huggingface-video");

const FAL_QUEUE_BASE = "https://queue.fal.run";
const DEFAULT_FAL_MODEL = "fal-ai/kling-video/v2/master/text-to-video";
const DEFAULT_MAX_AUTO_SCENES = 240;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveFalModel(modelKey) {
  const map = {
    kling: DEFAULT_FAL_MODEL,
    klingTurbo: "fal-ai/kling-video/v1.6/standard/text-to-video"
  };
  return map[modelKey] || modelKey || DEFAULT_FAL_MODEL;
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
  if (/^file:\/\//i.test(String(url))) {
    const filePath = new URL(url).pathname;
    await fsp.copyFile(filePath, destPath);
    return destPath;
  }
  if (path.isAbsolute(String(url)) && fs.existsSync(url)) {
    await fsp.copyFile(url, destPath);
    return destPath;
  }

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
    const { mistralKey, falKey, hfToken, creatomateKey, ...safe } = job;
    if (safe.config) {
      const { mistralKey: _mistralKey, falKey: _falKey, hfToken: _hfToken, ...safeConfig } = safe.config;
      safe.config = safeConfig;
    }
    return safe;
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
      hfToken,
      videoProvider,
      modelPath,
      hfEndpointUrl,
      mistralModel
    } = job.config;

    const provider = videoProvider === "huggingface" ? "huggingface" : "fal";
    const resolvedModel = provider === "huggingface" ? resolveHfModel(modelPath) : resolveFalModel(modelPath);
    const jobDir = path.join(videoJobsDir, jobId);
    const hfClipsDir = path.join(videoJobsDir, "hf-clips");
    await fsp.mkdir(jobDir, { recursive: true });
    await fsp.mkdir(hfClipsDir, { recursive: true });

    try {
      await updateJob(jobId, { status: "planning", progress: 3 });
      await appendLog(jobId, "Planification des scènes via Mistral…");

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
      await appendLog(jobId, `Plan OK : ${plan.title} (${plan.scenes.length} scènes)`);

      const clipUrls = [];
      const localClipPaths = [];
      for (let i = 0; i < plan.scenes.length; i += 1) {
        const scene = plan.scenes[i];
        const visual = `${scene.visualPrompt}. Cinematic, original content, no logos, no celebrity faces, no text overlay.`;

        let clipUrl;
        if (provider === "huggingface") {
          await appendLog(jobId, `Clip ${i + 1}/${plan.scenes.length} : génération Hugging Face (${resolvedModel})`);
          const clip = await generateHfClip({
            hfToken,
            modelId: resolvedModel,
            prompt: visual,
            duration: clipSec,
            aspectRatio,
            endpointUrl: hfEndpointUrl,
            destDir: hfClipsDir,
            filePrefix: `auto-${jobId}-clip-${String(i + 1).padStart(3, "0")}`
          });
          clipUrl = clip.url || `hf-local:${clip.fileName || i + 1}`;
          localClipPaths.push(clip.localPath || null);
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

          clipUrl = await pollFalClip({
            falKey,
            modelPath: resolvedModel,
            requestId: submit.request_id
          });
          localClipPaths.push(null);
        }

        clipUrls.push(clipUrl);
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

      const localClips = [];
      for (let i = 0; i < clipUrls.length; i += 1) {
        const clipPath = path.join(jobDir, `clip-${String(i + 1).padStart(3, "0")}.mp4`);
        const source = localClipPaths[i] || clipUrls[i];
        await downloadFile(source, clipPath);
        localClips.push(clipPath);
      }

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
      await appendLog(jobId, "Vidéo longue prête au téléchargement");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await appendLog(jobId, `ERREUR : ${message}`);
      await updateJob(jobId, { status: "failed", error: message, progress: 0 });
    }
  }

  async function createAutoJob(config) {
    await loadJobs();
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
        clipSec: Number(config.clipSec) || 10,
        aspectRatio: String(config.aspectRatio || "9:16"),
        videoProvider: String(config.videoProvider || "fal") === "huggingface" ? "huggingface" : "fal",
        modelPath: String(config.modelPath || config.hfModel || DEFAULT_FAL_MODEL),
        hfEndpointUrl: String(config.hfEndpointUrl || "").trim(),
        mistralModel: String(config.mistralModel || "mistral-small-2506"),
        mistralKey: String(config.mistralKey || "").trim(),
        falKey: String(config.falKey || "").trim(),
        hfToken: String(config.hfToken || "").trim()
      },
      logs: [],
      clipUrls: [],
      scenesDone: 0,
      sceneCount: 0
    };

    if (!job.config.topic) throw new Error("topic requis");
    if (!job.config.mistralKey) throw new Error("mistralKey requis");
    if (job.config.videoProvider === "huggingface") {
      if (!job.config.modelPath || job.config.modelPath === DEFAULT_FAL_MODEL) {
        job.config.modelPath = DEFAULT_HF_MODEL;
      }
      if (!job.config.hfToken) throw new Error("hfToken requis");
    } else if (!job.config.falKey) {
      throw new Error("falKey requis");
    }

    const sceneCount = Math.ceil((job.config.durationMin * 60) / job.config.clipSec);
    const maxScenes = Number(process.env.VOANH_MAX_SCENES || DEFAULT_MAX_AUTO_SCENES);
    if (sceneCount > maxScenes) throw new Error(`Trop de scènes — limite actuelle: ${maxScenes}`);

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
  FAL_QUEUE_BASE,
  DEFAULT_FAL_MODEL
};
