const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const { createVideoJobManager } = require("./voanh-video-pipeline");

const FAL_QUEUE_BASE = "https://queue.fal.run";

const FAL_MODELS = {
  kling: "fal-ai/kling-video/v2/master/text-to-video",
  klingTurbo: "fal-ai/kling-video/v1.6/standard/text-to-video",
  minimax: "fal-ai/minimax/video-01-live/text-to-video"
};

function createVoanhVideoRouter({ storageDir, getFfmpegReady }) {
  const router = require("express").Router();
  const videoJobsDir = path.join(storageDir, "voanh-videos");
  const videoJobs = new Map();
  const autoJobs = createVideoJobManager({ storageDir, getFfmpegReady });

  async function ensureVideoDirs() {
    await fsp.mkdir(videoJobsDir, { recursive: true });
  }

  function falHeaders(apiKey) {
    return {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json"
    };
  }

  async function falFetch(url, apiKey, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: { ...falHeaders(apiKey), ...(options.headers || {}) }
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

  function resolveFalModel(modelKey) {
    return FAL_MODELS[modelKey] || modelKey || FAL_MODELS.kling;
  }

  router.post("/fal/submit", async (req, res) => {
    try {
      const apiKey = String(req.headers["x-fal-key"] || req.body?.apiKey || "").trim();
      if (!apiKey) return res.status(400).json({ error: "Clé FAL.ai manquante (header x-fal-key)" });

      const modelPath = resolveFalModel(req.body?.modelKey);
      const prompt = String(req.body?.prompt || "").trim();
      if (!prompt) return res.status(400).json({ error: "Prompt requis" });

      const duration = String(req.body?.duration || "10");
      const aspectRatio = String(req.body?.aspectRatio || "9:16");

      const payload = await falFetch(`${FAL_QUEUE_BASE}/${modelPath}`, apiKey, {
        method: "POST",
        body: JSON.stringify({ prompt, duration, aspect_ratio: aspectRatio })
      });

      return res.json({
        requestId: payload.request_id,
        modelPath,
        status: payload.status || "IN_QUEUE"
      });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : "Erreur FAL submit" });
    }
  });

  router.get("/fal/status", async (req, res) => {
    try {
      const apiKey = String(req.headers["x-fal-key"] || "").trim();
      if (!apiKey) return res.status(400).json({ error: "Clé FAL.ai manquante" });

      const modelPath = resolveFalModel(req.query.modelPath);
      const requestId = String(req.query.requestId || "").trim();
      if (!requestId) return res.status(400).json({ error: "requestId requis" });

      const payload = await falFetch(
        `${FAL_QUEUE_BASE}/${modelPath}/requests/${requestId}/status`,
        apiKey,
        { method: "GET" }
      );
      return res.json(payload);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : "Erreur FAL status" });
    }
  });

  router.get("/fal/result", async (req, res) => {
    try {
      const apiKey = String(req.headers["x-fal-key"] || "").trim();
      if (!apiKey) return res.status(400).json({ error: "Clé FAL.ai manquante" });

      const modelPath = resolveFalModel(req.query.modelPath);
      const requestId = String(req.query.requestId || "").trim();
      if (!requestId) return res.status(400).json({ error: "requestId requis" });

      const payload = await falFetch(
        `${FAL_QUEUE_BASE}/${modelPath}/requests/${requestId}`,
        apiKey,
        { method: "GET" }
      );
      return res.json(payload);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : "Erreur FAL result" });
    }
  });

  router.post("/creatomate/render", async (req, res) => {
    try {
      const apiKey = String(req.headers["x-creatomate-key"] || req.body?.apiKey || "").trim();
      if (!apiKey) return res.status(400).json({ error: "Clé Creatomate manquante" });

      const source = req.body?.source;
      if (!source) return res.status(400).json({ error: "source JSON Creatomate requis" });

      const payload = await fetch("https://api.creatomate.com/v1/renders", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ source })
      }).then(async (r) => {
        const text = await r.text();
        let body;
        try {
          body = text ? JSON.parse(text) : {};
        } catch {
          body = { raw: text };
        }
        if (!r.ok) throw new Error(body?.message || body?.error || text || r.statusText);
        return body;
      });

      return res.json(payload);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : "Erreur Creatomate" });
    }
  });

  router.get("/creatomate/render/:renderId", async (req, res) => {
    try {
      const apiKey = String(req.headers["x-creatomate-key"] || "").trim();
      if (!apiKey) return res.status(400).json({ error: "Clé Creatomate manquante" });

      const payload = await fetch(`https://api.creatomate.com/v1/renders/${req.params.renderId}`, {
        headers: { Authorization: `Bearer ${apiKey}` }
      }).then(async (r) => {
        const text = await r.text();
        const body = text ? JSON.parse(text) : {};
        if (!r.ok) throw new Error(body?.message || text || r.statusText);
        return body;
      });

      return res.json(payload);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : "Erreur Creatomate status" });
    }
  });

  async function downloadFile(url, destPath) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Téléchargement impossible: ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await fsp.writeFile(destPath, buf);
    return destPath;
  }

  function runFfmpegConcat(listPath, outputPath) {
    return new Promise((resolve, reject) => {
      const args = [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c",
        "copy",
        outputPath
      ];
      const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
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

  router.post("/assemble", async (req, res) => {
    const ffmpegReady = typeof getFfmpegReady === "function" ? getFfmpegReady() : false;
    if (!ffmpegReady) {
      return res.status(503).json({ error: "ffmpeg indisponible sur le serveur" });
    }

    try {
      await ensureVideoDirs();
      const clipUrls = Array.isArray(req.body?.clipUrls) ? req.body.clipUrls.filter(Boolean) : [];
      if (!clipUrls.length) return res.status(400).json({ error: "clipUrls requis" });

      const jobId = uuidv4();
      const jobDir = path.join(videoJobsDir, jobId);
      await fsp.mkdir(jobDir, { recursive: true });

      const localClips = [];
      for (let i = 0; i < clipUrls.length; i += 1) {
        const clipPath = path.join(jobDir, `clip-${String(i + 1).padStart(3, "0")}.mp4`);
        await downloadFile(clipUrls[i], clipPath);
        localClips.push(clipPath);
      }

      const listPath = path.join(jobDir, "concat.txt");
      const listContent = localClips.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
      await fsp.writeFile(listPath, listContent, "utf8");

      const outputPath = path.join(jobDir, "final.mp4");
      await runFfmpegConcat(listPath, outputPath);

      const stats = await fsp.stat(outputPath);
      const job = {
        id: jobId,
        status: "completed",
        clipCount: localClips.length,
        outputPath,
        size: stats.size,
        createdAt: new Date().toISOString()
      };
      videoJobs.set(jobId, job);

      return res.json({
        id: jobId,
        status: "completed",
        clipCount: localClips.length,
        downloadUrl: `/api/voanh/download/${jobId}`,
        size: stats.size
      });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : "Erreur assemblage" });
    }
  });

  router.get("/download/:jobId", (req, res) => {
    const autoPath = autoJobs.getJobOutputPath(req.params.jobId);
    if (autoPath && fs.existsSync(autoPath)) {
      return res.download(autoPath, `voanh-long-${req.params.jobId}.mp4`);
    }

    const job = videoJobs.get(req.params.jobId);
    if (!job || !job.outputPath || !fs.existsSync(job.outputPath)) {
      return res.status(404).json({ error: "Vidéo introuvable" });
    }
    return res.download(job.outputPath, `voanh-long-${req.params.jobId}.mp4`);
  });

  router.post("/jobs/auto", async (req, res) => {
    try {
      const job = await autoJobs.createAutoJob({
        topic: req.body?.topic,
        durationMin: req.body?.durationMin,
        clipSec: req.body?.clipSec,
        aspectRatio: req.body?.aspectRatio,
        modelPath: req.body?.modelPath,
        mistralModel: req.body?.mistralModel,
        mistralKey: req.body?.mistralKey || req.headers["x-mistral-key"],
        falKey: req.body?.falKey || req.headers["x-fal-key"]
      });
      return res.status(202).json(job);
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Erreur job auto" });
    }
  });

  router.get("/jobs", async (_req, res) => {
    try {
      const items = await autoJobs.listJobs();
      return res.json({ jobs: items });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : "Erreur liste jobs" });
    }
  });

  router.get("/jobs/:jobId", async (req, res) => {
    try {
      const job = await autoJobs.getJob(req.params.jobId);
      if (!job) return res.status(404).json({ error: "Job introuvable" });
      return res.json(job);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : "Erreur job" });
    }
  });

  router.get("/health", (_req, res) => {
    const ffmpegReady = typeof getFfmpegReady === "function" ? getFfmpegReady() : false;
    res.json({ ok: true, ffmpegReady, models: FAL_MODELS });
  });

  return router;
}

module.exports = { createVoanhVideoRouter, FAL_MODELS };
