const cors = require("cors");
const express = require("express");
const archiver = require("archiver");
const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");
const fs = require("fs");
const fsp = require("fs/promises");
const multer = require("multer");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const ROOT_DIR = path.resolve(__dirname, "..");
const STORAGE_DIR = path.join(ROOT_DIR, "storage");
const UPLOADS_DIR = path.join(STORAGE_DIR, "uploads");
const JOBS_DIR = path.join(STORAGE_DIR, "jobs");
const JOBS_DB_FILE = path.join(STORAGE_DIR, "jobs-db.json");
const PORT = Number(process.env.PORT) || 3000;
const WORKER_CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 2);
const QUEUE_MODE = (process.env.QUEUE_MODE || "auto").toLowerCase();
const REDIS_URL = process.env.REDIS_URL || "";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase() || ".mp4";
      cb(null, `${Date.now()}-${uuidv4()}${ext}`);
    }
  }),
  limits: { fileSize: 900 * 1024 * 1024 }
});

const jobs = new Map();
const pendingJobIds = [];
let activeMemoryJobs = 0;
let queueModeRuntime = "memory";
let redisConnection = null;
let bullQueue = null;
let bullWorker = null;
let ffmpegReady = true;
let whisperAvailable = false;

const DEFAULTS = {
  clipDuration: 30,
  clipsCount: 4,
  minGap: 3,
  aspectRatio: "9:16",
  subtitleTheme: "classic",
  highlightMode: "balanced",
  includeAutoTranscript: false,
  includeSrtInZip: true,
  burnSubtitles: false
};

async function ensureDirs() {
  await fsp.mkdir(UPLOADS_DIR, { recursive: true });
  await fsp.mkdir(JOBS_DIR, { recursive: true });
}

function boolFrom(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const str = String(value).toLowerCase();
  return str === "1" || str === "true" || str === "yes" || str === "on";
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getJobDir(jobId) {
  return path.join(JOBS_DIR, jobId);
}

function getJobPlanPath(jobId) {
  return path.join(getJobDir(jobId), "plan.json");
}

function getJobSrtPath(jobId, clipId) {
  return path.join(getJobDir(jobId), `${clipId}.srt`);
}

function getJobCaptionsBurnPath(jobId, clipId) {
  return path.join(getJobDir(jobId), `${clipId}-captions.mp4`);
}

function asPublicJobSnapshot(job) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    originalFilename: job.originalFilename,
    inputPath: job.inputPath,
    duration: job.duration || 0,
    params: job.params || {},
    error: job.error || null,
    autoTranscriptUsed: !!job.autoTranscriptUsed,
    clips: (job.clips || []).map((clip) => ({
      id: clip.id,
      title: clip.title,
      start: clip.start,
      end: clip.end,
      duration: clip.duration,
      score: clip.score,
      filePath: clip.filePath,
      burnedFilePath: clip.burnedFilePath || null,
      captions: clip.captions || []
    }))
  };
}

async function persistJobsDb() {
  const list = Array.from(jobs.values()).map(asPublicJobSnapshot);
  await fsp.writeFile(JOBS_DB_FILE, JSON.stringify(list, null, 2), "utf8");
}

async function restoreJobsDb() {
  if (!fs.existsSync(JOBS_DB_FILE)) return;
  try {
    const raw = await fsp.readFile(JOBS_DB_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    parsed.forEach((job) => {
      if (!job || !job.id) return;
      const normalized = {
        ...job,
        status: ["queued", "processing", "completed", "failed"].includes(job.status) ? job.status : "failed",
        progress: Number.isFinite(job.progress) ? job.progress : 0,
        clips: Array.isArray(job.clips) ? job.clips : [],
        params: job.params || {},
        duration: Number.isFinite(job.duration) ? job.duration : 0
      };
      if (normalized.status === "processing" || normalized.status === "queued") {
        normalized.status = "failed";
        normalized.error = normalized.error || "Interruption serveur pendant traitement";
        normalized.progress = 100;
      }
      jobs.set(normalized.id, normalized);
    });
  } catch (_error) {
    // ignore invalid persisted file
  }
}

function checkBinary(binaryName, testArg = "-version") {
  const result = spawnSync(binaryName, [testArg], { stdio: "ignore" });
  return result.status === 0;
}

function tokenizeTranscript(transcript) {
  return String(transcript || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => w.trim())
    .filter(Boolean);
}

function mockEnergyAtTime(time, duration) {
  const x = time / Math.max(duration, 1);
  const base = 0.45 + 0.2 * Math.sin(x * Math.PI * 8);
  const randomSpike = (Math.sin(x * 62.3) + Math.sin(x * 22.1)) * 0.08;
  return Math.max(0, Math.min(1, base + randomSpike));
}

function highlightScore(momentTime, duration, mode) {
  const energy = mockEnergyAtTime(momentTime, duration);
  const earlyBias = 1 - momentTime / Math.max(duration, 1);
  const lateBias = 1 - earlyBias;
  if (mode === "hook-first") return energy * 0.7 + earlyBias * 0.3;
  if (mode === "viral") return energy * 0.85 + Math.abs(0.5 - lateBias) * 0.15;
  return energy;
}

function generateCandidateMoments(duration, step, mode) {
  const out = [];
  for (let t = 0; t < duration; t += step) {
    out.push({ t, score: highlightScore(t, duration, mode) });
  }
  return out.sort((a, b) => b.score - a.score);
}

function selectBestClips(duration, clipDuration, clipsCount, minGapSec, mode) {
  const maxStart = Math.max(0, duration - clipDuration);
  const moments = generateCandidateMoments(duration, Math.min(4, clipDuration / 3), mode);
  const chosen = [];

  const hasConflict = (start, end) =>
    chosen.some((clip) => {
      const inter = Math.max(0, Math.min(clip.end, end) - Math.max(clip.start, start));
      if (inter > clipDuration * 0.45) return true;
      const distance = Math.min(
        Math.abs(clip.start - start),
        Math.abs(clip.end - end),
        Math.abs(clip.start - end),
        Math.abs(clip.end - start)
      );
      return distance < minGapSec;
    });

  for (const moment of moments) {
    let start = Math.max(0, moment.t - clipDuration * 0.25);
    start = Math.min(start, maxStart);
    const end = Math.min(duration, start + clipDuration);
    if (!hasConflict(start, end)) {
      chosen.push({ start, end, duration: end - start, score: Number(moment.score.toFixed(3)) });
      if (chosen.length >= clipsCount) break;
    }
  }

  if (chosen.length < clipsCount) {
    for (let i = 0; i < clipsCount; i += 1) {
      const ratio = clipsCount === 1 ? 0 : i / (clipsCount - 1);
      const start = Number((maxStart * ratio).toFixed(3));
      const end = Math.min(duration, start + clipDuration);
      if (!hasConflict(start, end)) {
        chosen.push({
          start,
          end,
          duration: end - start,
          score: Number(highlightScore(start, duration, mode).toFixed(3))
        });
      }
      if (chosen.length >= clipsCount) break;
    }
  }

  if (!chosen.length) {
    chosen.push({
      start: 0,
      end: Math.min(duration, clipDuration),
      duration: Math.min(duration, clipDuration),
      score: 0.5
    });
  }

  return chosen
    .sort((a, b) => a.start - b.start)
    .slice(0, clipsCount)
    .map((clip, idx) => ({ id: `clip-${idx + 1}`, title: `Clip ${idx + 1}`, ...clip }));
}

function splitIntoSubtitleChunks(words, minWords = 4, maxWords = 10) {
  const chunks = [];
  let cursor = 0;
  while (cursor < words.length) {
    const size = minWords + Math.floor(Math.random() * (maxWords - minWords + 1));
    const part = words.slice(cursor, cursor + size);
    if (!part.length) break;
    chunks.push(part.join(" "));
    cursor += size;
  }
  return chunks;
}

function segmentTranscriptForClips(transcript, clips) {
  const words = tokenizeTranscript(transcript);
  if (!words.length) return clips.map(() => "");
  const durationTotal = clips.reduce((acc, clip) => acc + clip.duration, 0) || 1;
  const segments = [];
  let assigned = 0;
  clips.forEach((clip, idx) => {
    const ratio = clip.duration / durationTotal;
    let count = Math.round(words.length * ratio);
    if (idx === clips.length - 1) count = words.length - assigned;
    count = Math.max(0, count);
    segments.push(words.slice(assigned, assigned + count).join(" "));
    assigned += count;
  });
  return segments;
}

function buildCaptionsForClip(clipDuration, clipText) {
  const words = tokenizeTranscript(clipText);
  if (!words.length) return [];
  const chunks = splitIntoSubtitleChunks(words);
  const perChunk = clipDuration / chunks.length;
  return chunks.map((text, idx) => {
    const start = perChunk * idx;
    const end = idx === chunks.length - 1 ? clipDuration : perChunk * (idx + 1);
    return { start: Number(start.toFixed(3)), end: Number(end.toFixed(3)), text };
  });
}

function resolveOutputDimensions(aspectRatio) {
  if (aspectRatio === "1:1") return { width: 1080, height: 1080 };
  if (aspectRatio === "16:9") return { width: 1280, height: 720 };
  return { width: 1080, height: 1920 };
}

function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (buf) => {
      stderr += String(buf);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve();
      return reject(new Error(stderr || `${cmd} exited with code ${code}`));
    });
  });
}

function ffprobeDuration(inputPath) {
  return new Promise((resolve, reject) => {
    const args = ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", inputPath];
    const child = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let stderr = "";
    child.stdout.on("data", (buf) => {
      output += String(buf);
    });
    child.stderr.on("data", (buf) => {
      stderr += String(buf);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr || "ffprobe failed"));
      const duration = Number.parseFloat(output.trim());
      if (!Number.isFinite(duration) || duration <= 0) return reject(new Error("Unable to detect video duration"));
      return resolve(duration);
    });
  });
}

async function renderClipFile(inputPath, outputPath, clipStart, clipDuration, aspectRatio) {
  const { width, height } = resolveOutputDimensions(aspectRatio);
  const vf = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
    "format=yuv420p"
  ].join(",");
  const args = [
    "-y",
    "-ss",
    String(clipStart),
    "-t",
    String(clipDuration),
    "-i",
    inputPath,
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "22",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    outputPath
  ];
  await runCommand("ffmpeg", args);
}

function formatSrtTimestamp(seconds) {
  const ms = Math.max(0, Math.floor(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(milli).padStart(3, "0")}`;
}

function captionsToSrt(captions) {
  return captions
    .map((cue, idx) => `${idx + 1}\n${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(cue.end)}\n${cue.text}\n`)
    .join("\n");
}

function subtitleForceStyle(theme) {
  if (theme === "bold") return "Fontname=Arial,Fontsize=22,PrimaryColour=&H00FFFFFF&,BackColour=&H90000000&,Bold=1";
  if (theme === "cinema") return "Fontname=Georgia,Fontsize=24,PrimaryColour=&H00F0F0F0&,BackColour=&H70000000&,Outline=2";
  if (theme === "neon") return "Fontname=Arial,Fontsize=22,PrimaryColour=&H00FFFF00&,OutlineColour=&H00000000&,Outline=3";
  return "Fontname=Arial,Fontsize=20,PrimaryColour=&H00FFFFFF&,BackColour=&H80000000&";
}

async function burnCaptionsIntoClip(inputClipPath, srtPath, outputPath, theme) {
  const escapedSrt = srtPath.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
  const args = [
    "-y",
    "-i",
    inputClipPath,
    "-vf",
    `subtitles='${escapedSrt}':force_style='${subtitleForceStyle(theme)}'`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "22",
    "-c:a",
    "copy",
    outputPath
  ];
  await runCommand("ffmpeg", args);
}

async function transcribeVideoMaybe(inputPath, duration, includeAutoTranscript) {
  if (!includeAutoTranscript) return { transcript: "", autoTranscriptUsed: false };
  if (whisperAvailable) {
    const outDir = path.join(STORAGE_DIR, "uploads");
    const model = process.env.WHISPER_MODEL || "base";
    const language = process.env.WHISPER_LANGUAGE || "fr";
    const whisperArgs = [
      inputPath,
      "--model",
      model,
      "--language",
      language,
      "--output_format",
      "txt",
      "--output_dir",
      outDir,
      "--fp16",
      "False",
      "--verbose",
      "False"
    ];

    try {
      await runCommand("whisper", whisperArgs);
      const transcriptPath = path.join(outDir, `${path.parse(inputPath).name}.txt`);
      if (fs.existsSync(transcriptPath)) {
        const raw = await fsp.readFile(transcriptPath, "utf8");
        const cleaned = raw.replace(/\s+/g, " ").trim();
        if (cleaned.length > 20) {
          return { transcript: cleaned, autoTranscriptUsed: true };
        }
      }
    } catch (_error) {
      // fallback below
    }
  }
  const blocks = Math.max(3, Math.min(8, Math.round(duration / 15)));
  const generated = [];
  for (let i = 0; i < blocks; i += 1) {
    generated.push(
      `Segment ${i + 1}: idée forte, démonstration concrète et transition vers le point suivant pour maintenir la rétention.`
    );
  }
  return { transcript: generated.join(" "), autoTranscriptUsed: true };
}

function sanitizeJobForClient(job) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    autoTranscriptUsed: !!job.autoTranscriptUsed,
    source: { filename: job.originalFilename, duration: job.duration },
    params: job.params,
    clips: (job.clips || []).map((clip) => ({
      id: clip.id,
      title: clip.title,
      start: clip.start,
      end: clip.end,
      duration: clip.duration,
      score: clip.score,
      streamUrl: `/api/jobs/${job.id}/clips/${clip.id}/stream`,
      downloadUrl: `/api/jobs/${job.id}/clips/${clip.id}/download`,
      srtUrl: `/api/jobs/${job.id}/clips/${clip.id}/srt`,
      captions: clip.captions
    }))
  };
}

async function failJob(job, err) {
  job.status = "failed";
  job.progress = 100;
  job.error = err instanceof Error ? err.message : String(err);
  job.updatedAt = new Date().toISOString();
  await persistJobsDb();
}

async function processJobById(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  try {
    await processJob(job);
  } catch (err) {
    await failJob(job, err);
  }
}

function pumpMemoryQueue() {
  while (activeMemoryJobs < WORKER_CONCURRENCY && pendingJobIds.length > 0) {
    const nextJobId = pendingJobIds.shift();
    activeMemoryJobs += 1;
    void processJobById(nextJobId).finally(() => {
      activeMemoryJobs = Math.max(0, activeMemoryJobs - 1);
      pumpMemoryQueue();
    });
  }
}

function enqueueMemoryJob(jobId) {
  pendingJobIds.push(jobId);
  pumpMemoryQueue();
}

async function initBullQueue() {
  const shouldUseBullmq =
    (QUEUE_MODE === "bullmq" || QUEUE_MODE === "auto") &&
    Boolean(REDIS_URL);

  if (!shouldUseBullmq) {
    queueModeRuntime = "memory";
    return;
  }

  try {
    redisConnection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true
    });
    bullQueue = new Queue("clipforge-jobs", { connection: redisConnection });
    bullWorker = new Worker(
      "clipforge-jobs",
      async (job) => {
        await processJobById(String(job.data.jobId || ""));
      },
      {
        connection: redisConnection,
        concurrency: WORKER_CONCURRENCY
      }
    );
    bullWorker.on("failed", async (job, err) => {
      const candidateId = String(job?.data?.jobId || "");
      const model = jobs.get(candidateId);
      if (model && model.status !== "completed") {
        await failJob(model, err);
      }
    });
    queueModeRuntime = "bullmq";
  } catch (_error) {
    queueModeRuntime = "memory";
    bullQueue = null;
    bullWorker = null;
    if (redisConnection) {
      try {
        redisConnection.disconnect();
      } catch (_e) {
        // ignore
      }
      redisConnection = null;
    }
  }
}

async function enqueueJob(jobId) {
  if (queueModeRuntime === "bullmq" && bullQueue) {
    await bullQueue.add("process", { jobId }, { removeOnComplete: 200, removeOnFail: 200 });
    return;
  }
  enqueueMemoryJob(jobId);
}

async function readQueueStats() {
  if (queueModeRuntime === "bullmq" && bullQueue) {
    const [waiting, active, delayed] = await Promise.all([
      bullQueue.getWaitingCount(),
      bullQueue.getActiveCount(),
      bullQueue.getDelayedCount()
    ]);
    return { waiting, active, delayed };
  }
  return { waiting: pendingJobIds.length, active: activeMemoryJobs, delayed: 0 };
}

async function processJob(job) {
  job.status = "processing";
  job.progress = 5;
  job.updatedAt = new Date().toISOString();
  await persistJobsDb();

  const duration = await ffprobeDuration(job.inputPath);
  job.duration = Number(duration.toFixed(3));
  job.progress = 15;
  job.updatedAt = new Date().toISOString();

  if (!job.params.transcript && job.params.includeAutoTranscript) {
    const generated = await transcribeVideoMaybe(job.inputPath, duration, true);
    job.params.transcript = generated.transcript;
    job.autoTranscriptUsed = generated.autoTranscriptUsed;
  }

  const clips = selectBestClips(
    duration,
    job.params.clipDuration,
    job.params.clipsCount,
    job.params.minGapSecBetweenClips,
    job.params.highlightMode
  );
  const transcriptParts = segmentTranscriptForClips(job.params.transcript, clips);
  job.progress = 25;
  job.updatedAt = new Date().toISOString();
  await persistJobsDb();

  const jobDir = getJobDir(job.id);
  await fsp.mkdir(jobDir, { recursive: true });

  const total = clips.length || 1;
  const rendered = [];
  for (let i = 0; i < clips.length; i += 1) {
    const clip = clips[i];
    const outputPath = path.join(jobDir, `${clip.id}.mp4`);
    const captions = buildCaptionsForClip(clip.duration, transcriptParts[i] || "");
    const srtPath = getJobSrtPath(job.id, clip.id);
    await renderClipFile(job.inputPath, outputPath, clip.start, clip.duration, job.params.aspectRatio);
    await fsp.writeFile(srtPath, captionsToSrt(captions), "utf8");

    let burnedFilePath = null;
    if (job.params.burnSubtitles) {
      const burnPath = getJobCaptionsBurnPath(job.id, clip.id);
      try {
        await burnCaptionsIntoClip(outputPath, srtPath, burnPath, job.params.subtitleTheme);
        burnedFilePath = burnPath;
      } catch (_error) {
        burnedFilePath = null;
      }
    }

    rendered.push({ ...clip, filePath: outputPath, burnedFilePath, srtPath, captions });
    job.progress = Math.round(25 + ((i + 1) / total) * 70);
    job.updatedAt = new Date().toISOString();
    await persistJobsDb();
  }

  job.clips = rendered;
  const plan = {
    id: job.id,
    createdAt: job.createdAt,
    source: { filename: job.originalFilename, duration: job.duration },
    params: job.params,
    autoTranscriptUsed: !!job.autoTranscriptUsed,
    clips: rendered.map((clip) => ({
      id: clip.id,
      title: clip.title,
      start: clip.start,
      end: clip.end,
      duration: clip.duration,
      score: clip.score,
      captions: clip.captions
    }))
  };
  await fsp.writeFile(getJobPlanPath(job.id), JSON.stringify(plan, null, 2), "utf8");

  job.status = "completed";
  job.progress = 100;
  job.updatedAt = new Date().toISOString();
  await persistJobsDb();
}

app.get("/api/health", async (_req, res) => {
  const q = await readQueueStats();
  res.json({
    ok: true,
    ffmpeg: ffmpegReady,
    whisperAvailable,
    queueMode: queueModeRuntime,
    workerConcurrency: WORKER_CONCURRENCY,
    queueSize: q.waiting,
    processing: q.active > 0,
    queue: q
  });
});

app.get("/api/config", (_req, res) => {
  res.json({
    defaults: DEFAULTS,
    queue: {
      mode: queueModeRuntime,
      workerConcurrency: WORKER_CONCURRENCY
    },
    capabilities: {
      ffmpeg: ffmpegReady,
      whisperAvailable,
      srt: true,
      zip: true,
      burnSubtitles: true
    }
  });
});

app.post("/api/jobs", upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Fichier vidéo manquant (champ 'video')" });
  try {
    const clipDuration = Math.min(90, Math.max(8, toNumber(req.body.clipDuration, DEFAULTS.clipDuration)));
    const clipsCount = Math.min(12, Math.max(1, Math.floor(toNumber(req.body.clipsCount, DEFAULTS.clipsCount))));
    const aspectRatio = ["9:16", "1:1", "16:9"].includes(req.body.aspectRatio) ? req.body.aspectRatio : DEFAULTS.aspectRatio;
    const transcript = String(req.body.transcript || "");
    const minGapSecBetweenClips = Math.max(0, toNumber(req.body.minGapSecBetweenClips, DEFAULTS.minGap));
    const subtitleTheme = ["classic", "bold", "cinema", "neon"].includes(req.body.subtitleTheme)
      ? req.body.subtitleTheme
      : DEFAULTS.subtitleTheme;
    const highlightMode = ["balanced", "hook-first", "viral"].includes(req.body.highlightMode)
      ? req.body.highlightMode
      : DEFAULTS.highlightMode;
    const includeAutoTranscript = boolFrom(req.body.includeAutoTranscript, DEFAULTS.includeAutoTranscript);
    const includeSrtInZip = boolFrom(req.body.includeSrtInZip, DEFAULTS.includeSrtInZip);
    const burnSubtitles = boolFrom(req.body.burnSubtitles, DEFAULTS.burnSubtitles);

    const id = uuidv4();
    const job = {
      id,
      status: "queued",
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      inputPath: req.file.path,
      originalFilename: req.file.originalname,
      duration: 0,
      autoTranscriptUsed: false,
      params: {
        clipDuration,
        clipsCount,
        aspectRatio,
        transcript,
        minGapSecBetweenClips,
        subtitleTheme,
        highlightMode,
        includeAutoTranscript,
        includeSrtInZip,
        burnSubtitles
      },
      clips: [],
      error: null
    };

    jobs.set(id, job);
    await persistJobsDb();
    await enqueueJob(id);
    return res.status(202).json({ id, status: job.status, progress: job.progress });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Erreur interne" });
  }
});

app.get("/api/jobs/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job introuvable" });
  return res.json(sanitizeJobForClient(job));
});

app.get("/api/jobs/:jobId/plan", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job introuvable" });
  const planPath = getJobPlanPath(job.id);
  if (!fs.existsSync(planPath)) return res.status(409).json({ error: "Plan indisponible, job non terminé" });
  return res.download(planPath, `clipforge-plan-${job.id}.json`);
});

app.get("/api/jobs/:jobId/clips/:clipId/stream", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job introuvable" });
  const clip = (job.clips || []).find((c) => c.id === req.params.clipId);
  if (!clip) return res.status(404).json({ error: "Clip introuvable" });
  const selectedPath = clip.burnedFilePath || clip.filePath;
  if (!selectedPath || !fs.existsSync(selectedPath)) return res.status(404).json({ error: "Fichier clip indisponible" });
  return res.sendFile(selectedPath);
});

app.get("/api/jobs/:jobId/clips/:clipId/download", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job introuvable" });
  const clip = (job.clips || []).find((c) => c.id === req.params.clipId);
  if (!clip) return res.status(404).json({ error: "Clip introuvable" });
  const selectedPath = clip.burnedFilePath || clip.filePath;
  if (!selectedPath || !fs.existsSync(selectedPath)) return res.status(404).json({ error: "Fichier clip indisponible" });
  return res.download(selectedPath, `${clip.id}.mp4`);
});

app.get("/api/jobs/:jobId/clips/:clipId/srt", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job introuvable" });
  const clip = (job.clips || []).find((c) => c.id === req.params.clipId);
  if (!clip || !clip.srtPath || !fs.existsSync(clip.srtPath)) {
    return res.status(404).json({ error: "Sous-titres introuvables" });
  }
  return res.download(clip.srtPath, `${clip.id}.srt`);
});

app.get("/api/jobs/:jobId/bundle", async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job introuvable" });
  if (job.status !== "completed") return res.status(409).json({ error: "Job non terminé" });

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename=\"clipforge-bundle-${job.id}.zip\"`);

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => {
    res.status(500).end(err.message);
  });
  archive.pipe(res);

  const planPath = getJobPlanPath(job.id);
  if (fs.existsSync(planPath)) archive.file(planPath, { name: "plan.json" });

  for (const clip of job.clips || []) {
    const selectedPath = clip.burnedFilePath || clip.filePath;
    if (selectedPath && fs.existsSync(selectedPath)) {
      archive.file(selectedPath, { name: `clips/${clip.id}.mp4` });
    }
    if (job.params.includeSrtInZip && clip.srtPath && fs.existsSync(clip.srtPath)) {
      archive.file(clip.srtPath, { name: `subtitles/${clip.id}.srt` });
    }
  }

  await archive.finalize();
});

app.use(express.static(ROOT_DIR, { index: false }));
app.get("/", (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, "index.html"));
});

ensureDirs()
  .then(async () => {
    ffmpegReady = checkBinary("ffmpeg", "-version") && checkBinary("ffprobe", "-version");
    whisperAvailable = checkBinary("whisper", "--help");
    await restoreJobsDb();
    await initBullQueue();
    app.listen(PORT, () => {
      console.log(`ClipForge API en écoute sur http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Impossible d'initialiser le serveur:", error);
    process.exit(1);
  });
