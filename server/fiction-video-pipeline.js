/**
 * Pipeline Fiction Studio : script → plans → images → montage MP4.
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const { planScenes, planScenesFromScript, resolvePlannerMode } = require("./free-scene-planner");
const {
  buildImagePrompt,
  resolutionForAspect,
  DEFAULT_FPS,
  listHfImageModels,
  listVisualStyles
} = require("./hf-image-models");
const { generateHfImageWithFallback, saveManualImage, resolveHfToken } = require("./hf-image-client");
const {
  buildSrtFromScenes,
  imageToVideoClip,
  concatVideoClips,
  muxBackgroundMusic,
  burnSubtitles,
  muxNarrationAudio,
  motionForScene,
  runCommand
} = require("./fiction-assembler");

const DEFAULT_CLIP_SEC = 5;
const DEFAULT_BG_MUSIC = path.join(__dirname, "..", "assets", "shield-bg-music.mp3");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function synthesizeNarration(text, outputPath, voice) {
  const spoken = String(text || "").replace(/\s+/g, " ").trim().slice(0, 8000);
  if (!spoken) return false;
  await runCommand("python3", [
    "-m",
    "edge_tts",
    "--voice",
    voice || process.env.EDGE_TTS_VOICE || "fr-FR-HenriNeural",
    "--text",
    spoken,
    "--write-media",
    outputPath
  ]);
  return fs.existsSync(outputPath);
}

function createFictionJobManager({ storageDir, getFfmpegReady, backgroundMusicPath }) {
  const jobsDir = path.join(storageDir, "fiction-videos");
  const jobsFile = path.join(jobsDir, "jobs.json");
  const jobs = new Map();
  let loaded = false;
  let activeWorkers = 0;
  const maxConcurrency = Math.max(1, Number(process.env.FICTION_WORKER_CONCURRENCY) || 1);
  const pendingQueue = [];
  const musicPath = backgroundMusicPath || DEFAULT_BG_MUSIC;

  async function load() {
    if (loaded) return;
    await fsp.mkdir(jobsDir, { recursive: true });
    if (fs.existsSync(jobsFile)) {
      try {
        const raw = JSON.parse(await fsp.readFile(jobsFile, "utf8"));
        for (const job of raw.jobs || []) jobs.set(job.id, job);
      } catch {
        /* ignore */
      }
    }
    loaded = true;
  }

  async function persist() {
    const list = [...jobs.values()]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 200);
    await fsp.writeFile(jobsFile, JSON.stringify({ jobs: list }, null, 2), "utf8");
  }

  function sanitizeJob(job) {
    if (!job) return null;
    const { config, ...rest } = job;
    return {
      ...rest,
      config: config
        ? {
            ...config,
            mistralKey: config.mistralKey ? "***" : "",
            hfToken: config.hfToken ? "***" : ""
          }
        : undefined
    };
  }

  async function updateJob(jobId, patch) {
    const job = jobs.get(jobId);
    if (!job) return;
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    jobs.set(jobId, job);
    await persist();
  }

  async function appendLog(jobId, message) {
    const job = jobs.get(jobId);
    if (!job) return;
    job.logs = job.logs || [];
    job.logs.push({ at: new Date().toISOString(), message });
    if (job.logs.length > 400) job.logs = job.logs.slice(-400);
    await updateJob(jobId, { logs: job.logs });
  }

  function enqueue(jobId) {
    pendingQueue.push(jobId);
    pumpQueue();
  }

  function pumpQueue() {
    while (activeWorkers < maxConcurrency && pendingQueue.length > 0) {
      const jobId = pendingQueue.shift();
      activeWorkers += 1;
      runJob(jobId)
        .catch(async (err) => {
          const message = err instanceof Error ? err.message : String(err);
          await updateJob(jobId, { status: "failed", error: message, progress: 0 });
        })
        .finally(() => {
          activeWorkers -= 1;
          pumpQueue();
        });
    }
  }

  async function resolveSceneImage({ scene, index, config, jobDir }) {
    const imagePath = path.join(jobDir, `scene-${String(index + 1).padStart(3, "0")}.png`);
    const manual = Array.isArray(config.manualImages) ? config.manualImages[index] : null;

    if (config.imageProvider === "manual") {
      if (!manual) {
        throw new Error(`Image manuelle manquante pour la scène ${index + 1}`);
      }
      await saveManualImage({ data: manual, outputPath: imagePath });
      return { imagePath, provider: "manual" };
    }

    const { width, height } = resolutionForAspect(config.aspectRatio);
    const prompt = buildImagePrompt(scene.visualPrompt, config.visualStyle);
    const result = await generateHfImageWithFallback({
      prompt,
      outputPath: imagePath,
      modelKey: config.hfImageModel,
      hfToken: config.hfToken,
      width,
      height
    });
    return { imagePath, provider: "huggingface", modelKey: result.modelKey, prompt };
  }

  async function runJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) return;

    const ffmpegReady = typeof getFfmpegReady === "function" ? getFfmpegReady() : false;
    if (!ffmpegReady) {
      await updateJob(jobId, { status: "failed", error: "ffmpeg indisponible sur le serveur" });
      return;
    }

    const config = job.config;
    const jobDir = path.join(jobsDir, jobId);
    await fsp.mkdir(jobDir, { recursive: true });

    try {
      await updateJob(jobId, { status: "planning", progress: 5 });
      await appendLog(jobId, "Découpage du script en plans cinéma…");

      const hasScript = Boolean(String(config.script || "").trim());
      const plan = hasScript
        ? await planScenesFromScript({
            script: config.script,
            plannerMode: config.plannerMode,
            mistralKey: config.mistralKey,
            topic: config.topic,
            durationMin: config.durationMin,
            clipSec: config.clipSec,
            aspectRatio: config.aspectRatio,
            mistralModel: config.mistralModel
          })
        : await planScenes({
            plannerMode: config.plannerMode,
            mistralKey: config.mistralKey,
            topic: config.topic,
            durationMin: config.durationMin,
            clipSec: config.clipSec,
            aspectRatio: config.aspectRatio,
            mistralModel: config.mistralModel
          });

      await updateJob(jobId, {
        status: "generating_images",
        progress: 12,
        title: plan.title,
        sceneCount: plan.scenes.length,
        scenesDone: 0
      });
      await appendLog(jobId, `Plan OK : ${plan.title} (${plan.scenes.length} plans)`);

      const clipPaths = [];
      for (let i = 0; i < plan.scenes.length; i += 1) {
        const scene = plan.scenes[i];
        await appendLog(jobId, `Plan ${i + 1}/${plan.scenes.length} — génération image…`);

        const { imagePath, provider, modelKey, prompt } = await resolveSceneImage({
          scene,
          index: i,
          config,
          jobDir
        });

        if (provider === "huggingface") {
          await appendLog(jobId, `  Image HF (${modelKey}) : ${String(prompt).slice(0, 72)}…`);
        }

        const clipPath = path.join(jobDir, `clip-${String(i + 1).padStart(3, "0")}.mp4`);
        await imageToVideoClip({
          imagePath,
          outputPath: clipPath,
          durationSec: scene.durationSec || config.clipSec,
          aspectRatio: config.aspectRatio,
          fps: config.fps || DEFAULT_FPS,
          motion: motionForScene(i)
        });
        clipPaths.push(clipPath);

        const progress = 12 + Math.round(((i + 1) / plan.scenes.length) * 58);
        await updateJob(jobId, { progress, scenesDone: i + 1, clipPaths: [...clipPaths] });
      }

      await updateJob(jobId, { status: "assembling", progress: 72 });
      await appendLog(jobId, "Assemblage des plans…");

      const silentPath = path.join(jobDir, "silent.mp4");
      if (clipPaths.length === 1) {
        await fsp.copyFile(clipPaths[0], silentPath);
      } else {
        await concatVideoClips(clipPaths, silentPath);
      }

      let workingPath = silentPath;
      const srtPath = path.join(jobDir, "subtitles.srt");
      const srtContent = buildSrtFromScenes(plan.scenes, config.fps || DEFAULT_FPS);
      await fsp.writeFile(srtPath, srtContent, "utf8");

      if (config.burnSubtitles !== false) {
        await appendLog(jobId, "Incrustation des sous-titres…");
        const subtitledPath = path.join(jobDir, "subtitled.mp4");
        await burnSubtitles(workingPath, srtPath, subtitledPath, config.subtitleTheme || "cinema", config.aspectRatio);
        workingPath = subtitledPath;
      }

      let audioPath = "";
      if (config.voiceNarration) {
        await appendLog(jobId, "Synthèse voix-off (edge-tts)…");
        const narration = plan.scenes.map((s) => s.narration).filter(Boolean).join(" ");
        audioPath = path.join(jobDir, "narration.mp3");
        const ok = await synthesizeNarration(narration, audioPath, config.ttsVoice);
        if (!ok) audioPath = "";
      }

      const outputPath = path.join(jobDir, "final.mp4");
      if (audioPath) {
        await muxNarrationAudio(
          workingPath,
          audioPath,
          outputPath,
          config.backgroundMusic ? musicPath : null
        );
      } else if (config.backgroundMusic) {
        await appendLog(jobId, "Ajout musique libre de droit…");
        await muxBackgroundMusic(workingPath, musicPath, outputPath);
      } else {
        await fsp.copyFile(workingPath, outputPath);
      }

      const stats = await fsp.stat(outputPath);
      await updateJob(jobId, {
        status: "completed",
        progress: 100,
        outputPath,
        srtPath,
        downloadUrl: `/api/fiction/download/${jobId}`,
        srtDownloadUrl: `/api/fiction/download/${jobId}/subtitles`,
        size: stats.size,
        completedAt: new Date().toISOString()
      });
      await appendLog(jobId, "Vidéo fiction prête");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await appendLog(jobId, `ERREUR : ${message}`);
      await updateJob(jobId, { status: "failed", error: message, progress: 0 });
    }
  }

  async function createJob(config) {
    await load();
    const script = String(config.script || "").trim();
    const topic = String(config.topic || "").trim();
    if (!script && !topic) throw new Error("script ou topic requis");

    const imageProvider = String(config.imageProvider || "huggingface").toLowerCase();
    if (imageProvider === "huggingface" && !resolveHfToken(config.hfToken)) {
      throw new Error(
        "Token Hugging Face requis — gratuit sur https://huggingface.co/settings/tokens (cocher « Read »)"
      );
    }
    if (imageProvider === "manual") {
      const manualImages = Array.isArray(config.manualImages) ? config.manualImages : [];
      const sceneCount = Math.ceil((Number(config.durationMin) * 60) / (Number(config.clipSec) || DEFAULT_CLIP_SEC));
      if (manualImages.length < sceneCount) {
        throw new Error(`Import manuel : ${sceneCount} images attendues, ${manualImages.length} fournies`);
      }
    }

    const id = uuidv4();
    const job = {
      id,
      status: "queued",
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: (script.split(/\n/)[0] || topic || "Fiction").slice(0, 80),
      config: {
        script,
        topic: topic || script.split(/\n/)[0]?.slice(0, 120) || "",
        durationMin: Number(config.durationMin) || 1,
        clipSec: Number(config.clipSec) || DEFAULT_CLIP_SEC,
        aspectRatio: String(config.aspectRatio || "9:16"),
        visualStyle: String(config.visualStyle || "cinematic"),
        imageProvider,
        hfImageModel: String(config.hfImageModel || "fluxSchnell"),
        hfToken: resolveHfToken(config.hfToken),
        manualImages: config.manualImages || null,
        plannerMode: resolvePlannerMode(config.plannerMode),
        mistralKey: String(config.mistralKey || "").trim(),
        mistralModel: String(config.mistralModel || "mistral-small-2506"),
        fps: Number(config.fps) || DEFAULT_FPS,
        burnSubtitles: config.burnSubtitles !== false,
        subtitleTheme: String(config.subtitleTheme || "cinema"),
        backgroundMusic: config.backgroundMusic !== false,
        voiceNarration: Boolean(config.voiceNarration),
        ttsVoice: String(config.ttsVoice || "fr-FR-HenriNeural"),
        subtitleLanguage: String(config.subtitleLanguage || "fr")
      },
      logs: [],
      sceneCount: Math.ceil((Number(config.durationMin) * 60) / (Number(config.clipSec) || DEFAULT_CLIP_SEC)),
      scenesDone: 0
    };

    jobs.set(id, job);
    await persist();
    enqueue(id);
    return sanitizeJob(job);
  }

  async function getJob(jobId) {
    await load();
    return sanitizeJob(jobs.get(jobId));
  }

  async function listJobs(limit = 30) {
    await load();
    return [...jobs.values()]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit)
      .map(sanitizeJob);
  }

  function getJobOutputPath(jobId) {
    const job = jobs.get(jobId);
    return job?.outputPath || null;
  }

  function getJobSrtPath(jobId) {
    const job = jobs.get(jobId);
    return job?.srtPath || null;
  }

  return {
    createJob,
    getJob,
    listJobs,
    getJobOutputPath,
    getJobSrtPath,
    listModels: listHfImageModels,
    listStyles: listVisualStyles
  };
}

module.exports = { createFictionJobManager, DEFAULT_BG_MUSIC };
