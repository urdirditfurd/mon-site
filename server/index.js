const cors = require("cors");
const express = require("express");
const fs = require("fs");
const fsp = require("fs/promises");
const multer = require("multer");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const ROOT_DIR = path.resolve(__dirname, "..");
const STORAGE_DIR = path.join(ROOT_DIR, "storage");
const UPLOADS_DIR = path.join(STORAGE_DIR, "uploads");
const JOBS_DIR = path.join(STORAGE_DIR, "jobs");
const PORT = Number(process.env.PORT) || 3000;

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
  limits: {
    fileSize: 900 * 1024 * 1024
  }
});

const jobs = new Map();
const pendingJobIds = [];
let isProcessing = false;

async function ensureDirs() {
  await fsp.mkdir(UPLOADS_DIR, { recursive: true });
  await fsp.mkdir(JOBS_DIR, { recursive: true });
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function secondsToClock(total) {
  const sec = Math.max(0, Math.floor(total));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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

function generateCandidateMoments(duration, step) {
  const out = [];
  for (let t = 0; t < duration; t += step) {
    out.push({ t, score: mockEnergyAtTime(t, duration) });
  }
  return out.sort((a, b) => b.score - a.score);
}

function selectBestClips(duration, clipDuration, clipsCount, minGapSec) {
  const maxStart = Math.max(0, duration - clipDuration);
  const moments = generateCandidateMoments(duration, Math.min(4, clipDuration / 3));
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
      chosen.push({
        start,
        end,
        duration: end - start,
        score: Number(moment.score.toFixed(3))
      });
      if (chosen.length >= clipsCount) {
        break;
      }
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
          score: Number(mockEnergyAtTime(start, duration).toFixed(3))
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
    .map((clip, idx) => ({
      id: `clip-${idx + 1}`,
      title: `Clip ${idx + 1}`,
      ...clip
    }));
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
    if (idx === clips.length - 1) {
      count = words.length - assigned;
    }
    count = Math.max(0, count);
    const text = words.slice(assigned, assigned + count).join(" ");
    segments.push(text);
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
    return {
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
      text
    };
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
    const args = [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      inputPath
    ];
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
      if (code !== 0) {
        return reject(new Error(stderr || "ffprobe failed"));
      }
      const duration = Number.parseFloat(output.trim());
      if (!Number.isFinite(duration) || duration <= 0) {
        return reject(new Error("Unable to detect video duration"));
      }
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

function sanitizeJobForClient(job) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    source: {
      filename: job.originalFilename,
      duration: job.duration
    },
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
      captions: clip.captions
    }))
  };
}

function enqueueJob(jobId) {
  pendingJobIds.push(jobId);
  void processQueue();
}

async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;

  while (pendingJobIds.length > 0) {
    const jobId = pendingJobIds.shift();
    const job = jobs.get(jobId);
    if (!job) continue;
    try {
      await processJob(job);
    } catch (err) {
      job.status = "failed";
      job.progress = 100;
      job.error = err instanceof Error ? err.message : String(err);
      job.updatedAt = new Date().toISOString();
    }
  }

  isProcessing = false;
}

async function processJob(job) {
  job.status = "processing";
  job.progress = 5;
  job.updatedAt = new Date().toISOString();

  const duration = await ffprobeDuration(job.inputPath);
  job.duration = Number(duration.toFixed(3));
  job.progress = 15;
  job.updatedAt = new Date().toISOString();

  const clips = selectBestClips(
    duration,
    job.params.clipDuration,
    job.params.clipsCount,
    job.params.minGapSecBetweenClips
  );
  const transcriptParts = segmentTranscriptForClips(job.params.transcript, clips);
  job.progress = 25;
  job.updatedAt = new Date().toISOString();

  const jobDir = path.join(JOBS_DIR, job.id);
  await fsp.mkdir(jobDir, { recursive: true });

  const total = clips.length || 1;
  const rendered = [];
  for (let i = 0; i < clips.length; i += 1) {
    const clip = clips[i];
    const outputPath = path.join(jobDir, `${clip.id}.mp4`);
    const captions = buildCaptionsForClip(clip.duration, transcriptParts[i] || "");
    await renderClipFile(
      job.inputPath,
      outputPath,
      clip.start,
      clip.duration,
      job.params.aspectRatio
    );
    rendered.push({
      ...clip,
      filePath: outputPath,
      captions
    });
    job.progress = Math.round(25 + ((i + 1) / total) * 70);
    job.updatedAt = new Date().toISOString();
  }

  job.clips = rendered;
  const plan = {
    id: job.id,
    createdAt: job.createdAt,
    source: {
      filename: job.originalFilename,
      duration: job.duration
    },
    params: job.params,
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
  await fsp.writeFile(path.join(jobDir, "plan.json"), JSON.stringify(plan, null, 2), "utf8");

  job.status = "completed";
  job.progress = 100;
  job.updatedAt = new Date().toISOString();
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    ffmpeg: true,
    queueSize: pendingJobIds.length,
    processing: isProcessing
  });
});

app.post("/api/jobs", upload.single("video"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Fichier vidéo manquant (champ 'video')" });
  }

  try {
    const clipDuration = Math.min(90, Math.max(8, toNumber(req.body.clipDuration, 30)));
    const clipsCount = Math.min(12, Math.max(1, Math.floor(toNumber(req.body.clipsCount, 4))));
    const aspectRatio = ["9:16", "1:1", "16:9"].includes(req.body.aspectRatio)
      ? req.body.aspectRatio
      : "9:16";
    const transcript = String(req.body.transcript || "");
    const minGapSecBetweenClips = Math.max(
      0,
      toNumber(req.body.minGapSecBetweenClips, 0)
    );

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
      params: {
        clipDuration,
        clipsCount,
        aspectRatio,
        transcript,
        minGapSecBetweenClips
      },
      clips: [],
      error: null
    };

    jobs.set(id, job);
    enqueueJob(id);

    return res.status(202).json({
      id,
      status: job.status,
      progress: job.progress
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Erreur interne"
    });
  }
});

app.get("/api/jobs/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Job introuvable" });
  }
  return res.json(sanitizeJobForClient(job));
});

app.get("/api/jobs/:jobId/plan", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Job introuvable" });
  }
  const planPath = path.join(JOBS_DIR, job.id, "plan.json");
  if (!fs.existsSync(planPath)) {
    return res.status(409).json({ error: "Plan indisponible, job non terminé" });
  }
  return res.download(planPath, `clipforge-plan-${job.id}.json`);
});

app.get("/api/jobs/:jobId/clips/:clipId/stream", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Job introuvable" });
  }
  const clip = (job.clips || []).find((c) => c.id === req.params.clipId);
  if (!clip || !clip.filePath) {
    return res.status(404).json({ error: "Clip introuvable" });
  }
  return res.sendFile(clip.filePath);
});

app.get("/api/jobs/:jobId/clips/:clipId/download", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Job introuvable" });
  }
  const clip = (job.clips || []).find((c) => c.id === req.params.clipId);
  if (!clip || !clip.filePath) {
    return res.status(404).json({ error: "Clip introuvable" });
  }
  return res.download(clip.filePath, `${clip.id}.mp4`);
});

app.use(express.static(ROOT_DIR, { index: false }));
app.get("/", (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, "index.html"));
});

ensureDirs()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`ClipForge API en écoute sur http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Impossible d'initialiser le serveur:", error);
    process.exit(1);
  });
