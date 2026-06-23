const fs = require("fs");
const path = require("path");
const { createSulphurJobManager } = require("./sulphur-video-pipeline");
const { listHfModels, DEFAULT_HF_MODEL } = require("./hf-video-models");
const { listPlanners, planScenes, planScenesFromScript } = require("./free-scene-planner");

function createSulphurVideoRouter({ storageDir, getFfmpegReady }) {
  const router = require("express").Router();
  const manager = createSulphurJobManager({ storageDir, getFfmpegReady });

  router.get("/health", async (_req, res) => {
    const ffmpegReady = typeof getFfmpegReady === "function" ? getFfmpegReady() : false;
    const engine = await manager.checkEngineReady();
    res.json({
      ok: true,
      ffmpegReady,
      engine,
      models: listHfModels(),
      planners: listPlanners(),
      defaultModel: DEFAULT_HF_MODEL,
      defaultPlanner: "mistral",
      mistralFreeTier: {
        signup: "https://console.mistral.ai",
        model: "mistral-small-2506",
        cost: "0€"
      },
      cost: "0€ — GPU local gratuit, ou FAL cloud (crédits offerts)",
      recommendedMode: engine.cuda ? "gpu-local" : "fal-cloud",
      canGenerateLocal: Boolean(engine.cuda),
      canGenerateCloud: true,
      concurrency: Number(process.env.SULPHUR_WORKER_CONCURRENCY || 2)
    });
  });

  router.get("/models", (_req, res) => {
    res.json({ models: listHfModels(), defaultModel: DEFAULT_HF_MODEL, planners: listPlanners() });
  });

  router.post("/plan", async (req, res) => {
    try {
      const hasScript = Boolean(String(req.body?.script || "").trim());
      const plan = hasScript
        ? await planScenesFromScript({
            script: req.body?.script,
            plannerMode: req.body?.plannerMode,
            topic: req.body?.topic,
            durationMin: req.body?.durationMin,
            clipSec: req.body?.clipSec,
            aspectRatio: req.body?.aspectRatio,
            mistralKey: req.body?.mistralKey || req.headers["x-mistral-key"],
            mistralModel: req.body?.mistralModel,
            ollamaModel: req.body?.ollamaModel,
            ollamaUrl: req.body?.ollamaUrl
          })
        : await planScenes({
            plannerMode: req.body?.plannerMode,
            topic: req.body?.topic,
            durationMin: req.body?.durationMin,
            clipSec: req.body?.clipSec,
            aspectRatio: req.body?.aspectRatio,
            mistralKey: req.body?.mistralKey || req.headers["x-mistral-key"],
            mistralModel: req.body?.mistralModel,
            ollamaModel: req.body?.ollamaModel,
            ollamaUrl: req.body?.ollamaUrl
          });
      return res.json(plan);
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Erreur planification" });
    }
  });

  router.post("/jobs", async (req, res) => {
    try {
      const job = await manager.createJob({
        provider: req.body?.provider || "sulphur",
        topic: req.body?.topic,
        script: req.body?.script,
        prompt: req.body?.prompt,
        promptOnly: req.body?.promptOnly,
        durationMin: req.body?.durationMin,
        clipSec: req.body?.clipSec,
        aspectRatio: req.body?.aspectRatio,
        hfModel: req.body?.hfModel,
        plannerMode: req.body?.plannerMode,
        ollamaModel: req.body?.ollamaModel,
        ollamaUrl: req.body?.ollamaUrl,
        modelPath: req.body?.modelPath,
        mistralModel: req.body?.mistralModel,
        mistralKey: req.body?.mistralKey || req.headers["x-mistral-key"],
        falKey: req.body?.falKey || req.headers["x-fal-key"],
        seedBase: req.body?.seedBase
      });
      return res.status(202).json(job);
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Erreur création job" });
    }
  });

  router.post("/jobs/auto", async (req, res) => {
    try {
      const job = await manager.createJob({
        provider: req.body?.provider || "sulphur",
        topic: req.body?.topic,
        script: req.body?.script,
        durationMin: req.body?.durationMin,
        clipSec: req.body?.clipSec,
        aspectRatio: req.body?.aspectRatio,
        hfModel: req.body?.hfModel,
        plannerMode: req.body?.plannerMode,
        ollamaModel: req.body?.ollamaModel,
        ollamaUrl: req.body?.ollamaUrl,
        modelPath: req.body?.modelPath,
        mistralModel: req.body?.mistralModel,
        mistralKey: req.body?.mistralKey || req.headers["x-mistral-key"],
        falKey: req.body?.falKey || req.headers["x-fal-key"],
        seedBase: req.body?.seedBase
      });
      return res.status(202).json(job);
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Erreur job auto" });
    }
  });

  router.post("/batch", async (req, res) => {
    try {
      const batch = await manager.createBatch({
        items: req.body?.items,
        provider: req.body?.provider || "sulphur",
        clipSec: req.body?.clipSec,
        aspectRatio: req.body?.aspectRatio,
        hfModel: req.body?.hfModel,
        plannerMode: req.body?.plannerMode,
        ollamaModel: req.body?.ollamaModel,
        ollamaUrl: req.body?.ollamaUrl,
        modelPath: req.body?.modelPath,
        mistralModel: req.body?.mistralModel,
        mistralKey: req.body?.mistralKey || req.headers["x-mistral-key"],
        falKey: req.body?.falKey || req.headers["x-fal-key"],
        seedBase: req.body?.seedBase
      });
      return res.status(202).json(batch);
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Erreur batch" });
    }
  });

  router.get("/jobs", async (_req, res) => {
    try {
      const jobs = await manager.listJobs(Number(_req.query.limit) || 30);
      return res.json({ jobs });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : "Erreur liste jobs" });
    }
  });

  router.get("/jobs/:jobId", async (req, res) => {
    try {
      const job = await manager.getJob(req.params.jobId);
      if (!job) return res.status(404).json({ error: "Job introuvable" });
      return res.json(job);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : "Erreur job" });
    }
  });

  router.get("/batch/:batchId", async (req, res) => {
    try {
      const batch = await manager.getBatch(req.params.batchId);
      if (!batch) return res.status(404).json({ error: "Batch introuvable" });
      return res.json(batch);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : "Erreur batch" });
    }
  });

  router.get("/download/:jobId", (req, res) => {
    const outputPath = manager.getJobOutputPath(req.params.jobId);
    if (!outputPath || !fs.existsSync(outputPath)) {
      return res.status(404).json({ error: "Vidéo introuvable" });
    }
    return res.download(outputPath, `sulphur-${req.params.jobId}.mp4`);
  });

  return router;
}

module.exports = { createSulphurVideoRouter };
