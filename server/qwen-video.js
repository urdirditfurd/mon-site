const express = require("express");
const path = require("path");
const fs = require("fs");
const { createQwenJobManager, planSegments, MODEL_CAPS } = require("./qwen-video-pipeline");

function createQwenVideoRouter({ storageDir, getFfmpegReady }) {
  const router = express.Router();
  const manager = createQwenJobManager({ storageDir, getFfmpegReady });

  router.get("/health", async (_req, res) => {
    try {
      const health = await manager.health();
      return res.json(health);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "health error"
      });
    }
  });

  router.get("/models", (_req, res) => {
    res.json({
      models: Object.entries(MODEL_CAPS).map(([id, caps]) => ({
        id,
        maxSec: caps.maxSec,
        minSec: caps.minSec || 2,
        sizes: caps.sizes,
        fixedDuration: caps.fixedDuration || null,
        durations: caps.durations || null
      })),
      defaultModel: "wan2.2-t2v-plus"
    });
  });

  router.post("/plan", (req, res) => {
    try {
      const plan = planSegments({
        totalSec: req.body?.totalSec,
        segmentSec: req.body?.segmentSec,
        script: req.body?.script || req.body?.prompt,
        model: req.body?.model
      });
      return res.json(plan);
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Erreur plan"
      });
    }
  });

  router.post("/jobs", async (req, res) => {
    try {
      const job = await manager.createJob({
        engine: req.body?.engine,
        model: req.body?.model,
        script: req.body?.script || req.body?.prompt,
        totalSec: req.body?.totalSec,
        segmentSec: req.body?.segmentSec,
        aspectRatio: req.body?.aspectRatio,
        resolution: req.body?.resolution,
        apiKey: req.body?.apiKey || req.headers["x-qwen-key"] || req.headers["x-dashscope-key"],
        pinokioUrl: req.body?.pinokioUrl
      });
      return res.status(202).json(job);
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Erreur création job"
      });
    }
  });

  router.get("/jobs/:jobId", async (req, res) => {
    const job = await manager.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job introuvable" });
    return res.json(job);
  });

  router.get("/jobs/:jobId/download", async (req, res) => {
    const job = await manager.getJobRaw(req.params.jobId);
    if (!job || job.status !== "done" || !job.finalPath) {
      return res.status(404).json({ error: "Vidéo non prête" });
    }
    if (!fs.existsSync(job.finalPath)) {
      return res.status(404).json({ error: "Fichier final manquant" });
    }
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="qwen-video-${job.id.slice(0, 8)}.mp4"`
    );
    return res.sendFile(path.resolve(job.finalPath));
  });

  return router;
}

module.exports = { createQwenVideoRouter };
