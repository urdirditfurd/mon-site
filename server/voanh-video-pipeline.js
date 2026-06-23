const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const { createHfVideoWorker } = require("./hf-video-worker");

const FAL_QUEUE_BASE = "https://queue.fal.run";
const DEFAULT_FAL_MODEL = "fal-ai/kling-video/v2/master/text-to-video";
const DEFAULT_HF_MODEL = process.env.HF_T2V_MODEL || "Wan-AI/Wan2.1-T2V-1.3B-Diffusers";
const DEFAULT_HF_NEGATIVE_PROMPT =
  process.env.HF_T2V_NEGATIVE_PROMPT ||
  "low quality, blurry, watermark, logo, text overlay, distorted face, duplicated limbs";

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

function planScenesFallback({ topic, durationMin, clipSec, aspectRatio }) {
  const sceneCount = Math.ceil((durationMin * 60) / clipSec);
  const visualStyles = [
    "dramatic cinematic wide shot, volumetric lighting",
    "dynamic camera movement, high contrast, realistic details",
    "macro close-up, moody shadows, shallow depth of field",
    "slow motion atmosphere, emotional storytelling, premium color grading",
    "aerial perspective, epic composition, subtle particles"
  ];

  const scenes = [];
  for (let i = 0; i < sceneCount; i += 1) {
    const style = visualStyles[i % visualStyles.length];
    scenes.push({
      index: i + 1,
      visualPrompt: `${topic}, scene ${i + 1} of ${sceneCount}, ${style}, format ${aspectRatio}, no text, no logos`,
      narration: `Scène ${i + 1}: ${topic}`,
      durationSec: clipSec
    });
  }

  return {
    title: `${topic} — version auto`,
    scenes
  };
}

function parseAspectRatio(aspectRatio) {
  const input = String(aspectRatio || "9:16").trim();
  if (input === "16:9") return { width: 1024, height: 576 };
  if (input === "1:1") return { width: 768, height: 768 };
  return { width: 576, height: 1024 };
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
  const hfWorker = createHfVideoWorker({});
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
    const { mistralKey, falKey, creatomateKey, hfApiKey, ...safe } = job;
    const cleanConfig = { ...(safe.config || {}) };
    delete cleanConfig.mistralKey;
    delete cleanConfig.falKey;
    delete cleanConfig.creatomateKey;
    delete cleanConfig.hfApiKey;
    return {
      ...safe,
      config: cleanConfig
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
      provider,
      mistralKey,
      falKey,
      modelPath,
      mistralModel,
      hfModelId,
      hfNegativePrompt,
      hfNumInferenceSteps,
      hfGuidanceScale,
      hfFps
    } = job.config;

    const selectedProvider = provider === "hf-local" ? "hf-local" : "fal";
    const resolvedModel = resolveFalModel(modelPath);
    const jobDir = path.join(videoJobsDir, jobId);
    await fsp.mkdir(jobDir, { recursive: true });

    try {
      await updateJob(jobId, { status: "planning", progress: 3 });
      await appendLog(
        jobId,
        mistralKey
          ? "Planification des scènes via Mistral…"
          : "Mistral absent: planification locale simplifiée (fallback)."
      );

      const plan = mistralKey
        ? await planScenesWithMistral({
            mistralKey,
            topic,
            durationMin,
            clipSec,
            aspectRatio,
            mistralModel
          })
        : planScenesFallback({
            topic,
            durationMin,
            clipSec,
            aspectRatio
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
      const hfAspect = parseAspectRatio(aspectRatio);
      for (let i = 0; i < plan.scenes.length; i += 1) {
        const scene = plan.scenes[i];
        const visual = `${scene.visualPrompt}. Cinematic, original content, no logos, no celebrity faces, no text overlay.`;
        const localClipPath = path.join(jobDir, `clip-${String(i + 1).padStart(3, "0")}.mp4`);

        if (selectedProvider === "hf-local") {
          await appendLog(jobId, `Clip ${i + 1}/${plan.scenes.length} : génération Hugging Face locale`);
          const hfResult = await hfWorker.generateClip({
            outputPath: localClipPath,
            prompt: visual,
            modelId: hfModelId || DEFAULT_HF_MODEL,
            negativePrompt: hfNegativePrompt || DEFAULT_HF_NEGATIVE_PROMPT,
            durationSec: clipSec,
            fps: hfFps,
            numInferenceSteps: hfNumInferenceSteps,
            guidanceScale: hfGuidanceScale,
            width: hfAspect.width,
            height: hfAspect.height,
            seed: Date.now() + i
          });
          clipUrls.push(`file://${hfResult.outputPath}`);
          localClips.push(hfResult.outputPath);
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

      if (selectedProvider !== "hf-local") {
        for (let i = 0; i < clipUrls.length; i += 1) {
          const clipPath = path.join(jobDir, `clip-${String(i + 1).padStart(3, "0")}.mp4`);
          await downloadFile(clipUrls[i], clipPath);
          localClips.push(clipPath);
        }
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
        provider: String(config.provider || "fal").trim() === "hf-local" ? "hf-local" : "fal",
        modelPath: String(config.modelPath || DEFAULT_FAL_MODEL),
        hfModelId: String(config.hfModelId || DEFAULT_HF_MODEL).trim(),
        hfNegativePrompt: String(config.hfNegativePrompt || DEFAULT_HF_NEGATIVE_PROMPT).trim(),
        hfNumInferenceSteps: Number(config.hfNumInferenceSteps) || 30,
        hfGuidanceScale: Number(config.hfGuidanceScale) || 5,
        hfFps: Number(config.hfFps) || 12,
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
    if (job.config.provider === "fal" && !job.config.falKey) throw new Error("falKey requis pour provider=fal");
    if (job.config.provider === "hf-local" && !job.config.hfModelId) {
      throw new Error("hfModelId requis pour provider=hf-local");
    }

    const sceneCount = Math.ceil((job.config.durationMin * 60) / job.config.clipSec);
    if (sceneCount > 90) throw new Error("Trop de scènes — réduisez la durée");

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
    loadJobs,
    shutdown: () => hfWorker.shutdown()
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
  DEFAULT_FAL_MODEL,
  DEFAULT_HF_MODEL,
  DEFAULT_HF_NEGATIVE_PROMPT
};
