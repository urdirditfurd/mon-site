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
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const httpApi = deriveWanHttpApiUrl(base);

  try {
    const res = await fetch(`${httpApi}/api/health`, { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: true, mode: "wan-http", httpApi, detail: body };
    }
  } catch {
    /* fall through */
  }

  try {
    const res = await fetch(`${base}/config`, { signal: AbortSignal.timeout(2500) });
    if (res.ok) return { ok: true, mode: "gradio-config", httpApi };
  } catch {
    /* fall through */
  }

  try {
    const res = await fetch(base, { signal: AbortSignal.timeout(2500) });
    return { ok: res.ok, mode: "root", status: res.status, httpApi };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), httpApi };
  }
}

function deriveWanHttpApiUrl(gradioBase) {
  try {
    const u = new URL(gradioBase);
    const gradioPort = Number(u.port || (u.protocol === "https:" ? 443 : 80));
    // Wan Snapdragon du repo : Gradio 7860 + API HTTP 7867
    if (gradioPort === 7860) {
      u.port = "7867";
      return u.toString().replace(/\/+$/, "");
    }
    if (gradioPort > 0) {
      u.port = String(gradioPort + 7);
      return u.toString().replace(/\/+$/, "");
    }
  } catch {
    /* ignore */
  }
  return String(process.env.WAN_HTTP_URL || "http://127.0.0.1:7867").replace(/\/+$/, "");
}

function aspectToWanResolution(aspectRatio) {
  if (aspectRatio === "9:16") return "480p 9:16";
  if (aspectRatio === "1:1") return "480p 1:1";
  return "480p 16:9";
}

function durationToWanFrames(durationSec) {
  let frames = Math.round(Number(durationSec || 3) * 16);
  frames = Math.max(17, Math.min(33, frames));
  if (frames % 4 !== 1) frames = Math.max(17, Math.floor(frames / 4) * 4 + 1);
  return frames;
}

function extractVideoRef(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return value.url || value.path || value.name || value.video || null;
  }
  return null;
}

async function savePinokioVideoRef(baseUrl, ref, outPath) {
  if (!ref || typeof ref !== "string") throw new Error("Référence vidéo Pinokio vide");

  if (/^https?:\/\//i.test(ref)) {
    await downloadFile(ref, outPath);
    return outPath;
  }

  // Gradio file endpoints
  const candidates = [];
  if (ref.startsWith("/")) {
    candidates.push(`${baseUrl}${ref}`);
    candidates.push(`${baseUrl}/gradio_api/file=${ref}`);
    candidates.push(`${baseUrl}/file=${ref}`);
  } else {
    candidates.push(`${baseUrl}/gradio_api/file=${encodeURIComponent(ref)}`);
    candidates.push(`${baseUrl}/file=${encodeURIComponent(ref)}`);
    // Fichier local produit par wan-snapdragon
    if (fs.existsSync(ref)) {
      await fsp.copyFile(ref, outPath);
      return outPath;
    }
  }

  let lastError = "téléchargement impossible";
  for (const url of candidates) {
    try {
      await downloadFile(url, outPath);
      return outPath;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(lastError);
}

async function generateViaWanHttpApi({ httpApi, prompt, durationSec, aspectRatio, outPath }) {
  const res = await fetch(`${httpApi}/api/t2v`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      durationSec,
      aspectRatio: aspectRatio || "16:9",
      steps: 20
    }),
    signal: AbortSignal.timeout(Number(process.env.WAN_HTTP_TIMEOUT_MS || 45 * 60 * 1000))
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new Error(body.error || `Wan HTTP ${res.status}`);
  }
  if (body.path && fs.existsSync(body.path)) {
    await fsp.copyFile(body.path, outPath);
    return outPath;
  }
  if (body.downloadUrl) {
    await downloadFile(body.downloadUrl, outPath);
    return outPath;
  }
  throw new Error("Wan HTTP OK mais sans fichier vidéo");
}

async function callGradioNamedApi(baseUrl, apiName, data) {
  const endpoints = [
    `${baseUrl}/gradio_api/call/${apiName}`,
    `${baseUrl}/call/${apiName}`
  ];
  let lastError = "Gradio call échoué";
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
        signal: AbortSignal.timeout(60000)
      });
      if (!res.ok) {
        lastError = `Gradio HTTP ${res.status} (${url})`;
        continue;
      }
      const body = await res.json().catch(() => ({}));
      const eventId = body.event_id || body.eventId;
      if (!eventId) {
        // Réponse synchrone rare
        return body.data || body;
      }
      const pollUrl = `${url}/${eventId}`;
      const started = Date.now();
      const maxMs = Number(process.env.WAN_GRADIO_TIMEOUT_MS || 45 * 60 * 1000);
      while (Date.now() - started < maxMs) {
        const streamRes = await fetch(pollUrl, { signal: AbortSignal.timeout(120000) });
        const text = await streamRes.text();
        const lines = text.split(/\r?\n/);
        let eventName = "";
        for (const line of lines) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          if (line.startsWith("data:")) {
            const raw = line.slice(5).trim();
            if (!raw || raw === "null") continue;
            let parsed;
            try {
              parsed = JSON.parse(raw);
            } catch {
              continue;
            }
            if (eventName === "complete" || Array.isArray(parsed)) {
              return parsed;
            }
            if (eventName === "error") {
              throw new Error(typeof parsed === "string" ? parsed : JSON.stringify(parsed));
            }
          }
        }
        await sleep(2000);
      }
      throw new Error("Timeout Gradio");
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(lastError);
}

/**
 * Pinokio / Wan local — priorise l'API HTTP du repo (wan-snapdragon-arm),
 * puis Gradio api_name=generate (Wan Snapdragon / Wan2GP).
 */
async function generatePinokioSegment({
  baseUrl,
  prompt,
  durationSec,
  aspectRatio,
  outPath
}) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const httpApi = deriveWanHttpApiUrl(base);
  const frames = durationToWanFrames(durationSec);
  const resolution = aspectToWanResolution(aspectRatio);
  let lastError = "Pinokio/Wan injoignable";

  // 1) API HTTP du repo (fiable)
  try {
    await generateViaWanHttpApi({
      httpApi,
      prompt,
      durationSec,
      aspectRatio,
      outPath
    });
    return outPath;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }

  // 2) Gradio nommé (wan-snapdragon api_name=generate)
  try {
    const data = await callGradioNamedApi(base, "generate", [
      prompt,
      resolution,
      frames,
      20,
      0
    ]);
    const ref = extractVideoRef(Array.isArray(data) ? data[0] : data);
    await savePinokioVideoRef(base, ref, outPath);
    return outPath;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }

  // 3) Fallbacks génériques Wan2GP / Gradio predict
  const fallbacks = [
    { url: `${base}/gradio_api/call/generate`, data: [prompt, resolution, frames, 20, 0] },
    { url: `${base}/api/predict`, data: [prompt, durationSec], fn_index: 0 },
    { url: `${base}/run/predict`, data: [prompt, durationSec], fn_index: 0 }
  ];

  for (const item of fallbacks) {
    try {
      const res = await fetch(item.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: item.data,
          fn_index: item.fn_index ?? 0
        }),
        signal: AbortSignal.timeout(120000)
      });
      if (!res.ok) {
        lastError = `Pinokio HTTP ${res.status} (${item.url})`;
        continue;
      }
      const body = await res.json().catch(() => null);
      const maybe =
        extractVideoRef(body?.data?.[0]) ||
        extractVideoRef(body?.data) ||
        extractVideoRef(body?.path);
      if (maybe) {
        await savePinokioVideoRef(base, maybe, outPath);
        return outPath;
      }
      lastError = "Réponse Pinokio sans fichier vidéo exploitable";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(
    `${lastError}. Lancez Wan local : Pinokio → wan-snapdragon-arm (ou Wan2GP) puis réessayez. ` +
      `Gradio=${base} · API HTTP=${httpApi}`
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
            aspectRatio: job.aspectRatio,
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
          `Pinokio/Wan inaccessible (${ping.error || "offline"}). ` +
            `Lancez pinokio/wan-snapdragon-arm (Gradio :7860, API :7867) ou Wan2GP, ` +
            `sinon choisissez temporairement Démo FFmpeg.`
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
        { id: "pinokio", label: "Pinokio Wan local (gratuit illimité)" },
        { id: "demo", label: "Démo locale (FFmpeg, test immédiat)" },
        { id: "qwen-api", label: "API Qwen / DashScope (Wan cloud)" }
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
