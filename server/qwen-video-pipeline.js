/**
 * Pipeline Vidéo IA Qwen — découpe en N segments + concat FFmpeg.
 * Modes: demo (local sans GPU), qwen-api (DashScope), pinokio (Gradio local).
 */
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const { downloadFile, runFfmpegConcat } = require("./voanh-video-pipeline");

const DEFAULT_SEGMENT_SEC = 5;
const MIN_TOTAL_SEC = 20;
const MAX_TOTAL_SEC = 120;
const POLL_MS = 8000;
const POLL_MAX = 90;

const MODEL_CAPS = {
  "wan2.2-t2v-plus": { maxSec: 5, sizes: ["832*480", "1920*1080"], fixedDuration: 5 },
  "wan2.5-t2v-preview": { maxSec: 10, sizes: ["832*480", "1280*720", "1920*1080"], durations: [5, 10] },
  "wan2.6-t2v": { maxSec: 15, sizes: ["1280*720", "1920*1080"], minSec: 2 },
  "wan2.7-t2v": { maxSec: 15, sizes: ["1280*720", "1920*1080"], minSec: 2 },
  "wan3.0-video": { maxSec: 30, sizes: ["1280*720", "1920*1080"], minSec: 2 }
};

const ASPECT_TO_SIZE = {
  "16:9": { "480P": "832*480", "720P": "1280*720", "1080P": "1920*1080" },
  "9:16": { "480P": "480*832", "720P": "720*1280", "1080P": "1080*1920" },
  "1:1": { "480P": "480*480", "720P": "720*720", "1080P": "1080*1080" }
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function resolveDashBase() {
  return (
    process.env.QWEN_DASHSCOPE_BASE ||
    process.env.DASHSCOPE_BASE_URL ||
    "https://dashscope-intl.aliyuncs.com/api/v1"
  ).replace(/\/+$/, "");
}

function resolveApiKey(explicit) {
  return String(
    explicit || process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || ""
  ).trim();
}

function resolvePinokioUrl(explicit) {
  return String(explicit || process.env.PINOKIO_WAN_URL || "http://127.0.0.1:7860").replace(
    /\/+$/,
    ""
  );
}

function splitScriptIntoSegments(script, segmentCount) {
  const text = String(script || "").trim();
  if (!text) {
    return Array.from({ length: segmentCount }, (_, i) => ({
      index: i,
      prompt: `Cinematic scene ${i + 1} of ${segmentCount}, smooth camera, high quality`
    }));
  }

  const sentences = text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length === 0) {
    return Array.from({ length: segmentCount }, (_, i) => ({
      index: i,
      prompt: text.slice(0, 400)
    }));
  }

  const segments = [];
  for (let i = 0; i < segmentCount; i++) {
    const start = Math.floor((i * sentences.length) / segmentCount);
    const end = Math.floor(((i + 1) * sentences.length) / segmentCount);
    const chunk = sentences.slice(start, Math.max(start + 1, end)).join(" ");
    segments.push({
      index: i,
      prompt: `Shot ${i + 1}/${segmentCount}: ${chunk}`.slice(0, 1400)
    });
  }
  return segments;
}

function planSegments({ totalSec, segmentSec, script, model }) {
  const total = clamp(Number(totalSec) || 60, MIN_TOTAL_SEC, MAX_TOTAL_SEC);
  const caps = MODEL_CAPS[model] || MODEL_CAPS["wan2.2-t2v-plus"];
  let seg = clamp(Number(segmentSec) || DEFAULT_SEGMENT_SEC, 2, caps.maxSec);
  if (caps.fixedDuration) seg = caps.fixedDuration;
  if (caps.durations && !caps.durations.includes(seg)) {
    seg = caps.durations.reduce((a, b) => (Math.abs(b - seg) < Math.abs(a - seg) ? b : a));
  }
  const count = Math.max(1, Math.ceil(total / seg));
  const prompts = splitScriptIntoSegments(script, count);
  return {
    totalSec: total,
    segmentSec: seg,
    segmentCount: count,
    estimatedSec: count * seg,
    segments: prompts.map((p) => ({ ...p, durationSec: seg }))
  };
}

function sizeForAspect(aspectRatio, resolution, model, engine) {
  const aspect = ASPECT_TO_SIZE[aspectRatio] || ASPECT_TO_SIZE["16:9"];
  const preferred = aspect[resolution] || aspect["720P"] || aspect["1080P"];
  if (engine === "demo") return preferred;
  const caps = MODEL_CAPS[model];
  if (!caps?.sizes?.length) return preferred;
  if (caps.sizes.includes(preferred)) return preferred;
  // Fallbacks aspect-aware for legacy Wan 2.2 sizes
  if (aspectRatio === "9:16") {
    const portrait = caps.sizes.find((s) => {
      const [w, h] = s.split("*").map(Number);
      return h > w;
    });
    if (portrait) return portrait;
  }
  return caps.sizes[caps.sizes.length - 1];
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-900) || `ffmpeg exit ${code}`));
    });
  });
}

async function generateDemoSegment({ outPath, durationSec, prompt, index, width, height }) {
  const hue = (index * 47) % 360;
  // Couleurs + ton audio distinct par segment (pas de drawtext = pas de dépendance police)
  const freq = 220 + index * 40;
  try {
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=0x1a3d2e:s=${width}x${height}:d=${durationSec}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${freq}:sample_rate=44100:duration=${durationSec}`,
      "-vf",
      `drawbox=x=40:y=40:w=iw-80:h=ih-80:color=0x3ecf8e@0.35:t=12,` +
        `drawbox=x=${40 + (index % 5) * 40}:y=${80 + (index % 3) * 50}:w=180:h=100:color=0xe8c468@0.55:t=fill`,
      "-t",
      String(durationSec),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      outPath
    ]);
  } catch {
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=hsl(${hue}\\,55\\%,28\\%):s=${width}x${height}:d=${durationSec}`,
      "-f",
      "lavfi",
      "-i",
      `anullsrc=channel_layout=stereo:sample_rate=44100`,
      "-t",
      String(durationSec),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      outPath
    ]);
  }
  return outPath;
}

async function submitQwenTask({ apiKey, model, prompt, size, durationSec }) {
  const base = resolveDashBase();
  const res = await fetch(`${base}/services/aigc/video-generation/video-synthesis`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "enable"
    },
    body: JSON.stringify({
      model,
      input: { prompt },
      parameters: {
        size,
        duration: durationSec,
        prompt_extend: true
      }
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.message || body?.code || `Qwen HTTP ${res.status}`);
  }
  const taskId = body?.output?.task_id || body?.task_id;
  if (!taskId) throw new Error("Réponse Qwen sans task_id");
  return taskId;
}

async function pollQwenTask(apiKey, taskId) {
  const base = resolveDashBase();
  for (let i = 0; i < POLL_MAX; i++) {
    await sleep(POLL_MS);
    const res = await fetch(`${base}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const body = await res.json().catch(() => ({}));
    const status = body?.output?.task_status || body?.task_status;
    if (status === "SUCCEEDED") {
      const url = body?.output?.video_url || body?.output?.results?.[0]?.url;
      if (!url) throw new Error("Qwen SUCCEEDED sans video_url");
      return url;
    }
    if (status === "FAILED" || status === "CANCELED") {
      throw new Error(body?.output?.message || body?.message || `Qwen ${status}`);
    }
  }
  throw new Error("Timeout attente tâche Qwen");
}

async function generateQwenSegment({ apiKey, model, prompt, size, durationSec, outPath }) {
  const taskId = await submitQwenTask({ apiKey, model, prompt, size, durationSec });
  const videoUrl = await pollQwenTask(apiKey, taskId);
  await downloadFile(videoUrl, outPath);
  return outPath;
}

async function pingPinokio(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/config`, { signal: AbortSignal.timeout(2500) });
    if (res.ok) return { ok: true, mode: "gradio-config" };
  } catch {
    /* fall through */
  }
  try {
    const res = await fetch(baseUrl, { signal: AbortSignal.timeout(2500) });
    return { ok: res.ok, mode: "root", status: res.status };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Appel Gradio 4+ (predict) — compatible Wan2GP / interfaces similaires.
 * Si l’API Gradio diffère, le mode demo reste disponible pour valider le chaînage.
 */
async function generatePinokioSegment({ baseUrl, prompt, durationSec, outPath }) {
  const candidates = [
    `${baseUrl}/gradio_api/call/generate`,
    `${baseUrl}/api/predict`,
    `${baseUrl}/run/predict`
  ];

  let lastError = "Pinokio injoignable";
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: [prompt, durationSec],
          fn_index: 0
        }),
        signal: AbortSignal.timeout(120000)
      });
      if (!res.ok) {
        lastError = `Pinokio HTTP ${res.status} (${url})`;
        continue;
      }
      const body = await res.json().catch(() => null);
      const maybeUrl =
        body?.data?.[0]?.url ||
        body?.data?.[0]?.video?.url ||
        body?.data?.[0] ||
        body?.path;
      if (typeof maybeUrl === "string" && /^https?:\/\//i.test(maybeUrl)) {
        await downloadFile(maybeUrl, outPath);
        return outPath;
      }
      if (typeof maybeUrl === "string" && maybeUrl.startsWith("/")) {
        await downloadFile(`${baseUrl}${maybeUrl}`, outPath);
        return outPath;
      }
      lastError = "Réponse Pinokio sans fichier vidéo exploitable";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(
    `${lastError}. Vérifiez que Wan2GP tourne sur ${baseUrl}, ou utilisez le mode Démo / API Qwen.`
  );
}

function createQwenJobManager({ storageDir, getFfmpegReady }) {
  const rootDir = path.join(storageDir, "qwen-videos");
  const dbPath = path.join(rootDir, "jobs.json");
  const jobs = new Map();
  let loaded = false;

  async function ensureDirs() {
    await fsp.mkdir(rootDir, { recursive: true });
  }

  async function persist() {
    await ensureDirs();
    const payload = {
      updatedAt: new Date().toISOString(),
      jobs: Array.from(jobs.values()).slice(-40)
    };
    await fsp.writeFile(dbPath, JSON.stringify(payload, null, 2), "utf8");
  }

  async function load() {
    if (loaded) return;
    await ensureDirs();
    if (fs.existsSync(dbPath)) {
      try {
        const raw = JSON.parse(await fsp.readFile(dbPath, "utf8"));
        for (const job of raw.jobs || []) {
          if (job?.id) jobs.set(job.id, job);
        }
      } catch {
        /* ignore corrupt db */
      }
    }
    loaded = true;
  }

  function publicJob(job) {
    return {
      id: job.id,
      status: job.status,
      engine: job.engine,
      model: job.model,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      progress: job.progress,
      plan: job.plan,
      logs: job.logs?.slice(-80) || [],
      error: job.error || null,
      downloadUrl: job.status === "done" ? `/api/qwen/jobs/${job.id}/download` : null,
      segmentCount: job.plan?.segmentCount,
      estimatedSec: job.plan?.estimatedSec
    };
  }

  function log(job, line) {
    job.logs = job.logs || [];
    job.logs.push(`[${new Date().toISOString()}] ${line}`);
    job.updatedAt = new Date().toISOString();
  }

  async function runJob(job) {
    const jobDir = path.join(rootDir, job.id);
    const segmentsDir = path.join(jobDir, "segments");
    await fsp.mkdir(segmentsDir, { recursive: true });

    try {
      if (typeof getFfmpegReady === "function" && !getFfmpegReady()) {
        throw new Error("FFmpeg introuvable — requis pour assembler les segments");
      }

      const size = sizeForAspect(job.aspectRatio, job.resolution, job.model, job.engine);
      const [w, h] = size.split("*").map(Number);
      const segmentPaths = [];

      for (let i = 0; i < job.plan.segments.length; i++) {
        const seg = job.plan.segments[i];
        const outPath = path.join(segmentsDir, `seg-${String(i + 1).padStart(3, "0")}.mp4`);
        job.progress = {
          pct: Math.round((i / job.plan.segments.length) * 90),
          label: `Segment ${i + 1}/${job.plan.segments.length}`,
          detail: seg.prompt.slice(0, 120)
        };
        log(job, `Génération segment ${i + 1}/${job.plan.segments.length} (${job.engine})`);
        await persist();

        if (job.engine === "demo") {
          await generateDemoSegment({
            outPath,
            durationSec: seg.durationSec,
            prompt: seg.prompt,
            index: i,
            width: w || 1280,
            height: h || 720
          });
        } else if (job.engine === "qwen-api") {
          await generateQwenSegment({
            apiKey: job.apiKey,
            model: job.model,
            prompt: seg.prompt,
            size,
            durationSec: seg.durationSec,
            outPath
          });
        } else if (job.engine === "pinokio") {
          await generatePinokioSegment({
            baseUrl: job.pinokioUrl,
            prompt: seg.prompt,
            durationSec: seg.durationSec,
            outPath
          });
        } else {
          throw new Error(`Moteur inconnu: ${job.engine}`);
        }

        segmentPaths.push(outPath);
        job.progress = {
          pct: Math.round(((i + 1) / job.plan.segments.length) * 90),
          label: `Segment ${i + 1} OK`,
          detail: path.basename(outPath)
        };
        await persist();
      }

      job.progress = { pct: 95, label: "Assemblage FFmpeg", detail: "concat" };
      log(job, "Concaténation des segments…");
      await persist();

      const listPath = path.join(jobDir, "concat.txt");
      const listBody = segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
      await fsp.writeFile(listPath, listBody, "utf8");
      const finalPath = path.join(jobDir, "final.mp4");

      try {
        await runFfmpegConcat(listPath, finalPath);
      } catch {
        // Re-encode if stream copy fails (mixed codecs between engines)
        await runFfmpeg([
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          listPath,
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          finalPath
        ]);
      }

      job.finalPath = finalPath;
      job.status = "done";
      job.progress = { pct: 100, label: "Terminé", detail: "final.mp4" };
      log(job, "Vidéo finale prête");
      await persist();
    } catch (error) {
      job.status = "error";
      job.error = error instanceof Error ? error.message : String(error);
      job.progress = { pct: job.progress?.pct || 0, label: "Erreur", detail: job.error };
      log(job, `ERREUR: ${job.error}`);
      await persist();
    }
  }

  async function createJob(input) {
    await load();
    const engine = String(input.engine || "demo").toLowerCase();
    const model = String(input.model || "wan2.2-t2v-plus");
    const plan = planSegments({
      totalSec: input.totalSec,
      segmentSec: input.segmentSec,
      script: input.script || input.prompt,
      model
    });

    if (engine === "qwen-api") {
      const key = resolveApiKey(input.apiKey);
      if (!key) throw new Error("Clé API Qwen / DashScope manquante (QWEN_API_KEY)");
    }
    if (engine === "pinokio") {
      const ping = await pingPinokio(resolvePinokioUrl(input.pinokioUrl));
      if (!ping.ok) {
        throw new Error(
          `Pinokio/Wan inaccessible (${ping.error || "offline"}). Lancez Wan2GP ou choisissez Démo / API Qwen.`
        );
      }
    }

    const job = {
      id: uuidv4(),
      status: "running",
      engine,
      model,
      aspectRatio: input.aspectRatio || "16:9",
      resolution: input.resolution || "720P",
      apiKey: resolveApiKey(input.apiKey),
      pinokioUrl: resolvePinokioUrl(input.pinokioUrl),
      plan,
      progress: { pct: 0, label: "Démarrage", detail: "" },
      logs: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    log(job, `Job créé — ${plan.segmentCount} segments × ${plan.segmentSec}s ≈ ${plan.estimatedSec}s`);
    jobs.set(job.id, job);
    await persist();
    setImmediate(() => {
      runJob(job).catch(() => {});
    });
    return publicJob(job);
  }

  async function getJob(id) {
    await load();
    const job = jobs.get(id);
    return job ? publicJob(job) : null;
  }

  async function getJobRaw(id) {
    await load();
    return jobs.get(id) || null;
  }

  async function health() {
    const ffmpegReady = typeof getFfmpegReady === "function" ? getFfmpegReady() : false;
    const pinokio = await pingPinokio(resolvePinokioUrl());
    return {
      ok: true,
      ffmpegReady,
      hasQwenKey: Boolean(resolveApiKey()),
      pinokio,
      models: Object.keys(MODEL_CAPS),
      limits: { minTotalSec: MIN_TOTAL_SEC, maxTotalSec: MAX_TOTAL_SEC },
      engines: [
        { id: "demo", label: "Démo locale (FFmpeg, sans GPU)" },
        { id: "qwen-api", label: "API Qwen / DashScope (Wan cloud)" },
        { id: "pinokio", label: "Pinokio Wan2GP (local)" }
      ]
    };
  }

  return {
    createJob,
    getJob,
    getJobRaw,
    health,
    planSegments,
    publicJob
  };
}

module.exports = {
  createQwenJobManager,
  planSegments,
  MODEL_CAPS,
  MIN_TOTAL_SEC,
  MAX_TOTAL_SEC
};
