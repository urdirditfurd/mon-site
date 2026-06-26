const fs = require("fs");
const path = require("path");
const { createFictionJobManager, DEFAULT_BG_MUSIC } = require("./fiction-video-pipeline");
const { listHfImageModels, listVisualStyles, DEFAULT_FPS } = require("./hf-image-models");
const { resolveHfToken, resolveMistralKey, getServerAiSecretsStatus } = require("./ai-secrets");
const { planScenes, planScenesFromScript } = require("./free-scene-planner");

function createFictionVideoRouter({ storageDir, getFfmpegReady, backgroundMusicPath }) {
  const router = require("express").Router();
  const manager = createFictionJobManager({
    storageDir,
    getFfmpegReady,
    backgroundMusicPath: backgroundMusicPath || DEFAULT_BG_MUSIC
  });

  router.get("/health", (_req, res) => {
    const ffmpegReady = typeof getFfmpegReady === "function" ? getFfmpegReady() : false;
    const hasMusic = fs.existsSync(backgroundMusicPath || DEFAULT_BG_MUSIC);
    const hasHfToken = Boolean(resolveHfToken());
    const hasMistralKey = Boolean(resolveMistralKey());
    const aiStatus = getServerAiSecretsStatus();
    res.json({
      ok: true,
      mode: "fiction-studio",
      description: "Script → images IA → montage Ken Burns → musique + sous-titres → MP4",
      ffmpegReady,
      hasBackgroundMusic: hasMusic,
      hasServerHfToken: hasHfToken,
      hasServerMistralKey: hasMistralKey,
      keysHint: aiStatus.source,
      defaultFps: DEFAULT_FPS,
      imageModels: listHfImageModels(),
      visualStyles: listVisualStyles(),
      imageProviders: [
        {
          key: "huggingface",
          label: "Hugging Face (FLUX Schnell — crédits gratuits mensuels)",
          signup: "https://huggingface.co/settings/tokens"
        },
        {
          key: "manual",
          label: "Import manuel (vos images par plan)",
          hint: "Fournir manualImages[] en base64 dans le corps JSON"
        }
      ],
      cost: "0 € avec token HF gratuit + Mistral Free Tier (planification)",
      fpsGuide: {
        cinematic: 24,
        social: 30,
        note: "1 image par plan — pas besoin de 24 images/seconde ; Ken Burns anime chaque plan"
      }
    });
  });

  router.get("/models", (_req, res) => {
    res.json({ models: listHfImageModels(), styles: listVisualStyles() });
  });

  router.post("/plan", async (req, res) => {
    try {
      const hasScript = Boolean(String(req.body?.script || "").trim());
      const plan = hasScript
        ? await planScenesFromScript({
            script: req.body?.script,
            plannerMode: req.body?.plannerMode,
            durationMin: req.body?.durationMin,
            clipSec: req.body?.clipSec,
            aspectRatio: req.body?.aspectRatio,
            mistralKey: req.body?.mistralKey || req.headers["x-mistral-key"],
            mistralModel: req.body?.mistralModel
          })
        : await planScenes({
            plannerMode: req.body?.plannerMode,
            topic: req.body?.topic,
            durationMin: req.body?.durationMin,
            clipSec: req.body?.clipSec,
            aspectRatio: req.body?.aspectRatio,
            mistralKey: req.body?.mistralKey || req.headers["x-mistral-key"],
            mistralModel: req.body?.mistralModel
          });
      return res.json(plan);
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Erreur planification" });
    }
  });

  router.post("/jobs", async (req, res) => {
    try {
      const job = await manager.createJob({
        script: req.body?.script,
        topic: req.body?.topic,
        durationMin: req.body?.durationMin,
        clipSec: req.body?.clipSec,
        aspectRatio: req.body?.aspectRatio,
        visualStyle: req.body?.visualStyle,
        imageProvider: req.body?.imageProvider,
        hfImageModel: req.body?.hfImageModel,
        hfToken: req.body?.hfToken || req.headers["x-hf-token"] || process.env.HF_TOKEN,
        manualImages: req.body?.manualImages,
        plannerMode: req.body?.plannerMode,
        mistralKey: req.body?.mistralKey || req.headers["x-mistral-key"],
        mistralModel: req.body?.mistralModel,
        fps: req.body?.fps,
        burnSubtitles: req.body?.burnSubtitles,
        subtitleTheme: req.body?.subtitleTheme,
        backgroundMusic: req.body?.backgroundMusic,
        voiceNarration: req.body?.voiceNarration,
        ttsVoice: req.body?.ttsVoice,
        subtitleLanguage: req.body?.subtitleLanguage
      });
      return res.status(202).json(job);
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Erreur création job" });
    }
  });

  router.get("/jobs", async (req, res) => {
    try {
      const jobs = await manager.listJobs(Number(req.query.limit) || 30);
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

  router.get("/download/:jobId", (req, res) => {
    const outputPath = manager.getJobOutputPath(req.params.jobId);
    if (!outputPath || !fs.existsSync(outputPath)) {
      return res.status(404).json({ error: "Vidéo introuvable" });
    }
    return res.download(outputPath, `fiction-${req.params.jobId}.mp4`);
  });

  router.get("/download/:jobId/subtitles", (req, res) => {
    const srtPath = manager.getJobSrtPath(req.params.jobId);
    if (!srtPath || !fs.existsSync(srtPath)) {
      return res.status(404).json({ error: "Sous-titres introuvables" });
    }
    return res.download(srtPath, `fiction-${req.params.jobId}.srt`);
  });

  return router;
}

module.exports = { createFictionVideoRouter };
