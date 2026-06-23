const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const {
  downloadFile,
  runFfmpegConcat,
  falFetch,
  pollFalClip,
  resolveFalModel,
  FAL_QUEUE_BASE
} = require("./voanh-video-pipeline");
const { planScenes, planScenesFromScript, resolvePlannerMode } = require("./free-scene-planner");
const { resolveWanPromptExtend, extendWanScenes, extendWanPromptWithMistral } = require("./wan-prompt-extension");
const {
  resolveHfModel,
  framesForDuration,
  resolutionForAspect,
  NEGATIVE_PROMPT,
  DEFAULT_HF_MODEL
} = require("./hf-video-models");

const ENGINE_SCRIPT = path.join(__dirname, "sulphur-video-engine.py");
const DEFAULT_CLIP_SEC = 5;
const DEFAULT_FPS = 24;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolvePythonBin() {
  return process.env.SULPHUR_PYTHON || process.env.PYTHON_BIN || "python3";
}

function isSnapdragonHost() {
  return process.platform === "win32" && process.arch === "arm64";
}

function buildPythonEnv() {
  const snapdragon = isSnapdragonHost() || process.env.SULPHUR_SNAPDRAGON === "1";
  return {
    ...process.env,
    HF_TOKEN: process.env.HF_TOKEN || process.env.HUGGINGFACE_HUB_TOKEN || "",
    SULPHUR_MODEL_CACHE: process.env.SULPHUR_MODEL_CACHE || "",
    SULPHUR_CPU_OFFLOAD: process.env.SULPHUR_CPU_OFFLOAD || "1",
    SULPHUR_ALLOW_CPU: snapdragon ? "1" : process.env.SULPHUR_ALLOW_CPU || "",
    SULPHUR_SNAPDRAGON: snapdragon ? "1" : process.env.SULPHUR_SNAPDRAGON || "0"
  };
}

function runPythonEngine(args, stdinPayload) {
  return new Promise((resolve, reject) => {
    const python = resolvePythonBin();
    const proc = spawn(python, [ENGINE_SCRIPT, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: buildPythonEnv()
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      const line = stdout.trim().split("\n").filter(Boolean).pop() || "";
      let body;
      try {
        body = line ? JSON.parse(line) : {};
      } catch {
        body = { ok: false, raw: stdout, stderr };
      }
      if (code !== 0 || body.ok === false) {
        const msg = body.error || stderr.slice(-1200) || stdout.slice(-1200) || `python exit ${code}`;
        reject(new Error(msg));
        return;
      }
      resolve(body);
    });

    if (stdinPayload) {
      proc.stdin.write(JSON.stringify(stdinPayload));
    }
    proc.stdin.end();
  });
}

async function checkEngineReady() {
  try {
    const info = await runPythonEngine(["check"]);
    return { ready: Boolean(info.ok), ...info };
  } catch (error) {
    return {
      ready: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function generateHfClip({
  prompt,
  outputPath,
  modelKey,
  aspectRatio,
  clipSec,
  seed
}) {
  const model = resolveHfModel(modelKey);
  const { width, height } = resolutionForAspect(model, aspectRatio);
  const frames = framesForDuration(model, clipSec || DEFAULT_CLIP_SEC);
  const fps = model.defaultFps || DEFAULT_FPS;

  return runPythonEngine(
    ["--stdin-json"],
    {
      model: modelKey || DEFAULT_HF_MODEL,
      prompt,
      output: outputPath,
      width,
      height,
      frames,
      fps,
      negativePrompt: NEGATIVE_PROMPT,
      cacheDir: process.env.SULPHUR_MODEL_CACHE || undefined,
      seed: seed ?? undefined
    }
  );
}

async function generateFalClip({
  falKey,
  modelPath,
  prompt,
  clipSec,
  aspectRatio
}) {
  const resolvedModel = resolveFalModel(modelPath);
  const duration = clipSec <= 7 ? "5" : "10";
  const submit = await falFetch(`${FAL_QUEUE_BASE}/${resolvedModel}`, falKey, {
    method: "POST",
    body: JSON.stringify({
      prompt,
      duration,
      aspect_ratio: aspectRatio
    })
  });
  return pollFalClip({
    falKey,
    modelPath: resolvedModel,
    requestId: submit.request_id
  });
}

function createSulphurJobManager({ storageDir, getFfmpegReady }) {
  const jobsDir = path.join(storageDir, "sulphur-videos");
  const dbPath = path.join(jobsDir, "jobs.json");
  const batchDbPath = path.join(jobsDir, "batches.json");
  const jobs = new Map();
  const batches = new Map();
  let loaded = false;

  const maxConcurrency = Math.max(1, Number(process.env.SULPHUR_WORKER_CONCURRENCY || 2));
  let activeWorkers = 0;
  const pendingQueue = [];

  async function ensureDirs() {
    await fsp.mkdir(jobsDir, { recursive: true });
  }

  async function persist() {
    await ensureDirs();
    await fsp.writeFile(
      dbPath,
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          jobs: Array.from(jobs.values()).slice(-200)
        },
        null,
        2
      ),
      "utf8"
    );
    await fsp.writeFile(
      batchDbPath,
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          batches: Array.from(batches.values()).slice(-50)
        },
        null,
        2
      ),
      "utf8"
    );
  }

  async function load() {
    if (loaded) return;
    await ensureDirs();
    for (const file of [dbPath, batchDbPath]) {
      if (!fs.existsSync(file)) continue;
      try {
        const raw = JSON.parse(await fsp.readFile(file, "utf8"));
        if (file === dbPath) {
          for (const job of raw.jobs || []) jobs.set(job.id, job);
        } else {
          for (const batch of raw.batches || []) batches.set(batch.id, batch);
        }
      } catch {
        /* ignore corrupt db */
      }
    }
    loaded = true;
  }

  function sanitizeJob(job) {
    const { mistralKey, falKey, ...safe } = job;
    return safe;
  }

  async function updateJob(jobId, patch) {
    const current = jobs.get(jobId);
    if (!current) return null;
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    jobs.set(jobId, next);
    await persist();
    return next;
  }

  async function appendLog(jobId, message) {
    const job = jobs.get(jobId);
    if (!job) return;
    const logs = Array.isArray(job.logs) ? job.logs : [];
    logs.push({ at: new Date().toISOString(), message });
    await updateJob(jobId, { logs: logs.slice(-300) });
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

  function enqueue(jobId) {
    pendingQueue.push(jobId);
    pumpQueue();
  }

  async function maybeExtendWanPlan(plan, config, jobId) {
    if (!resolveWanPromptExtend(config)) return plan;

    await appendLog(
      jobId,
      "Enrichissement prompts Wan 2.1 (style officiel Qwen via Mistral)…"
    );

    const scenes = await extendWanScenes({
      scenes: plan.scenes,
      mistralKey: config.mistralKey,
      mistralModel: config.mistralModel,
      aspectRatio: config.aspectRatio,
      clipSec: config.clipSec,
      onScene: ({ index, total, original, extended, fallback }) => {
        const preview = extended.slice(0, 72);
        if (fallback) {
          void appendLog(jobId, `  Scène ${index}/${total} : enrichissement ignoré (prompt original)`);
          return;
        }
        void appendLog(
          jobId,
          `  Scène ${index}/${total} : «${original.slice(0, 48)}…» → «${preview}…»`
        );
      }
    });

    return { ...plan, scenes, wanPromptExtended: true };
  }

  async function maybeExtendWanPrompt(prompt, config, jobId) {
    if (!resolveWanPromptExtend(config)) return prompt;

    await appendLog(jobId, "Enrichissement prompt Wan 2.1 (clip unique)…");
    try {
      const extended = await extendWanPromptWithMistral({
        prompt,
        mistralKey: config.mistralKey,
        mistralModel: config.mistralModel,
        aspectRatio: config.aspectRatio,
        clipSec: config.clipSec
      });
      await appendLog(jobId, `Prompt enrichi : ${extended.slice(0, 96)}…`);
      return extended;
    } catch (error) {
      if (process.env.SULPHUR_PROMPT_EXTEND_FALLBACK === "0") throw error;
      await appendLog(jobId, "Enrichissement ignoré — prompt original conservé");
      return prompt;
    }
  }

  async function generateSceneClip({
    provider,
    scene,
    jobDir,
    index,
    config
  }) {
    const visual = `${scene.visualPrompt}. Cinematic, original content, no logos, no celebrity faces, no text overlay.`;
    const clipPath = path.join(jobDir, `clip-${String(index + 1).padStart(3, "0")}.mp4`);

    if (provider === "fal") {
      const url = await generateFalClip({
        falKey: config.falKey,
        modelPath: config.modelPath,
        prompt: visual,
        clipSec: config.clipSec,
        aspectRatio: config.aspectRatio
      });
      await downloadFile(url, clipPath);
      return clipPath;
    }

    await generateHfClip({
      prompt: visual,
      outputPath: clipPath,
      modelKey: config.hfModel || DEFAULT_HF_MODEL,
      aspectRatio: config.aspectRatio,
      clipSec: config.clipSec,
      seed: config.seedBase ? config.seedBase + index : undefined
    });
    return clipPath;
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
    const provider = config.provider || "sulphur";
    const jobDir = path.join(jobsDir, jobId);
    await fsp.mkdir(jobDir, { recursive: true });

    try {
      if (config.promptOnly && config.prompt) {
        await updateJob(jobId, { status: "generating", progress: 10, sceneCount: 1, scenesDone: 0 });
        await appendLog(jobId, `Génération clip unique (${provider})…`);
        const enrichedPrompt = await maybeExtendWanPrompt(config.prompt, config, jobId);
        const clipPath = await generateSceneClip({
          provider,
          scene: { visualPrompt: enrichedPrompt },
          jobDir,
          index: 0,
          config
        });
        const outputPath = path.join(jobDir, "final.mp4");
        await fsp.copyFile(clipPath, outputPath);
        const stats = await fsp.stat(outputPath);
        await updateJob(jobId, {
          status: "completed",
          progress: 100,
          outputPath,
          downloadUrl: `/api/sulphur/download/${jobId}`,
          size: stats.size,
          completedAt: new Date().toISOString(),
          scenesDone: 1
        });
        await appendLog(jobId, "Clip prêt");
        return;
      }

      await updateJob(jobId, { status: "planning", progress: 3 });
      const plannerLabel = resolvePlannerMode(config.plannerMode);
      const hasScript = Boolean(String(config.script || "").trim());
      await appendLog(
        jobId,
        hasScript
          ? `Découpage du script (${plannerLabel}, 100% gratuit)…`
          : `Planification des scènes (${plannerLabel}, 100% gratuit)…`
      );

      let plan = hasScript
        ? await planScenesFromScript({
            script: config.script,
            plannerMode: config.plannerMode,
            mistralKey: config.mistralKey,
            topic: config.topic,
            durationMin: config.durationMin,
            clipSec: config.clipSec,
            aspectRatio: config.aspectRatio,
            mistralModel: config.mistralModel,
            ollamaModel: config.ollamaModel,
            ollamaUrl: config.ollamaUrl
          })
        : await planScenes({
            plannerMode: config.plannerMode,
            mistralKey: config.mistralKey,
            topic: config.topic,
            durationMin: config.durationMin,
            clipSec: config.clipSec,
            aspectRatio: config.aspectRatio,
            mistralModel: config.mistralModel,
            ollamaModel: config.ollamaModel,
            ollamaUrl: config.ollamaUrl
          });

      plan = await maybeExtendWanPlan(plan, config, jobId);

      await updateJob(jobId, {
        status: "generating",
        progress: 8,
        title: plan.title,
        sceneCount: plan.scenes.length,
        scenesDone: 0,
        clipPaths: []
      });
      await appendLog(jobId, `Plan OK : ${plan.title} (${plan.scenes.length} scènes)`);

      const localClips = [];
      for (let i = 0; i < plan.scenes.length; i += 1) {
        await appendLog(jobId, `Scène ${i + 1}/${plan.scenes.length} (${provider})`);
        const clipPath = await generateSceneClip({
          provider,
          scene: plan.scenes[i],
          jobDir,
          index: i,
          config
        });
        localClips.push(clipPath);
        const progress = 8 + Math.round(((i + 1) / plan.scenes.length) * 82);
        await updateJob(jobId, { progress, scenesDone: i + 1, clipPaths: [...localClips] });
      }

      await updateJob(jobId, { status: "assembling", progress: 92 });
      await appendLog(jobId, "Assemblage FFmpeg…");

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
        downloadUrl: `/api/sulphur/download/${jobId}`,
        size: stats.size,
        completedAt: new Date().toISOString()
      });
      await appendLog(jobId, "Vidéo finale prête");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await appendLog(jobId, `ERREUR : ${message}`);
      await updateJob(jobId, { status: "failed", error: message, progress: 0 });
    }
  }

  async function createJob(config) {
    await load();
    const provider = String(config.provider || "sulphur").toLowerCase();
    const clipSec = Number(config.clipSec) || DEFAULT_CLIP_SEC;
    const durationMin = Number(config.durationMin) || 3;
    const promptOnly = Boolean(config.promptOnly || config.prompt);
    const script = String(config.script || "").trim();
    const topic = String(config.topic || "").trim();

    if (!promptOnly && !topic && !script) {
      throw new Error("topic ou script requis");
    }
    if (promptOnly && !String(config.prompt || "").trim()) {
      throw new Error("prompt requis");
    }

    if (provider === "fal") {
      if (!String(config.falKey || "").trim()) throw new Error("falKey requis pour le provider FAL");
    } else if (!["sulphur", "hf", "local"].includes(provider)) {
      throw new Error(`Provider inconnu: ${provider}`);
    }

    if (!promptOnly) {
      const plannerMode = resolvePlannerMode(config.plannerMode);
      if (plannerMode === "mistral" && !String(config.mistralKey || "").trim()) {
        if (process.env.SULPHUR_PLANNER_FALLBACK === "0") {
          throw new Error(
            "mistralKey requis — clé gratuite sur https://console.mistral.ai (Free Tier VOANH)"
          );
        }
      }
      const sceneCount = Math.ceil((durationMin * 60) / clipSec);
      if (sceneCount > 180) throw new Error("Trop de scènes — réduisez la durée ou augmentez clipSec");
    }

    const id = uuidv4();
    const job = {
      id,
      status: "queued",
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: promptOnly
        ? String(config.prompt).slice(0, 80)
        : (topic || script.split(/\n/)[0] || "Vidéo").slice(0, 80),
      config: {
        provider,
        topic: topic || script.split(/\n/)[0]?.slice(0, 120) || "",
        script,
        prompt: String(config.prompt || "").trim(),
        promptOnly,
        durationMin,
        clipSec,
        aspectRatio: String(config.aspectRatio || "9:16"),
        hfModel: String(config.hfModel || DEFAULT_HF_MODEL),
        modelPath: String(config.modelPath || ""),
        plannerMode: resolvePlannerMode(config.plannerMode),
        ollamaModel: String(config.ollamaModel || process.env.OLLAMA_MODEL || "llama3.2"),
        ollamaUrl: String(config.ollamaUrl || process.env.OLLAMA_URL || "http://127.0.0.1:11434"),
        mistralModel: String(config.mistralModel || "mistral-small-2506"),
        mistralKey: String(config.mistralKey || "").trim(),
        falKey: String(config.falKey || "").trim(),
        wanPromptExtend: config.wanPromptExtend !== false,
        seedBase: Number(config.seedBase) || undefined,
        batchId: config.batchId || null
      },
      logs: [],
      sceneCount: promptOnly ? 1 : Math.ceil((durationMin * 60) / clipSec),
      scenesDone: 0
    };

    jobs.set(id, job);
    await persist();
    enqueue(id);
    return sanitizeJob(job);
  }

  async function createBatch(batchConfig) {
    await load();
    const items = Array.isArray(batchConfig.items) ? batchConfig.items : [];
    if (!items.length) throw new Error("items requis (tableau non vide)");
    if (items.length > 500) throw new Error("Maximum 500 vidéos par batch");

    const batchId = uuidv4();
    const batch = {
      id: batchId,
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      total: items.length,
      completed: 0,
      failed: 0,
      jobIds: []
    };
    batches.set(batchId, batch);
    await persist();

    const shared = {
      provider: batchConfig.provider || "sulphur",
      clipSec: batchConfig.clipSec,
      aspectRatio: batchConfig.aspectRatio,
      hfModel: batchConfig.hfModel,
      modelPath: batchConfig.modelPath,
      mistralModel: batchConfig.mistralModel,
      mistralKey: batchConfig.mistralKey,
      falKey: batchConfig.falKey,
      plannerMode: batchConfig.plannerMode,
      ollamaModel: batchConfig.ollamaModel,
      ollamaUrl: batchConfig.ollamaUrl,
      seedBase: batchConfig.seedBase
    };

    for (const item of items) {
      const job = await createJob({
        ...shared,
        ...item,
        batchId
      });
      batch.jobIds.push(job.id);
    }

    batch.status = "running";
    await persist();
    return batch;
  }

  async function getJob(id) {
    await load();
    const job = jobs.get(id);
    return job ? sanitizeJob(job) : null;
  }

  async function listJobs(limit = 30) {
    await load();
    return Array.from(jobs.values())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit)
      .map(sanitizeJob);
  }

  async function getBatch(id) {
    await load();
    const batch = batches.get(id);
    if (!batch) return null;
    const childJobs = batch.jobIds
      .map((jid) => jobs.get(jid))
      .filter(Boolean)
      .map(sanitizeJob);
    const completed = childJobs.filter((j) => j.status === "completed").length;
    const failed = childJobs.filter((j) => j.status === "failed").length;
    const running = childJobs.filter((j) => !["completed", "failed"].includes(j.status)).length;
    const status = running > 0 ? "running" : failed > 0 && completed === 0 ? "failed" : "completed";
    return {
      ...batch,
      status,
      completed,
      failed,
      running,
      jobs: childJobs
    };
  }

  function getJobOutputPath(id) {
    const job = jobs.get(id);
    return job?.outputPath || null;
  }

  return {
    checkEngineReady,
    createJob,
    createBatch,
    getJob,
    listJobs,
    getBatch,
    getJobOutputPath,
    load,
    generateHfClip
  };
}

module.exports = {
  createSulphurJobManager,
  checkEngineReady,
  generateHfClip,
  runPythonEngine
};
