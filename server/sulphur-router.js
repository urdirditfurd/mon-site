"use strict";

const express = require("express");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const {
  listModels,
  resolveModel,
  generateClip,
  generateBulk,
  planScenes,
  concatClips,
  isLocalAvailable,
  DEFAULT_MODEL_KEY,
  PROVIDER_FAL,
  PROVIDER_REPLICATE,
  PROVIDER_NOVITA,
  PROVIDER_LOCAL
} = require("./sulphur-engine");

const PROVIDER_KEY_HEADERS = {
  fal: ["x-fal-key", "x-fal-ai-key"],
  replicate: ["x-replicate-key", "x-replicate-token"],
  novita: ["x-novita-key"],
  hf: ["x-hf-token", "x-huggingface-token", "authorization"]
};

function extractKeys(req) {
  const headers = req.headers || {};
  const body = req.body || {};
  const read = (provider) => {
    for (const h of PROVIDER_KEY_HEADERS[provider] || []) {
      const v = headers[h];
      if (typeof v === "string" && v.trim()) {
        return v.replace(/^Bearer\s+/i, "").trim();
      }
    }
    return null;
  };
  const fromBody = (k) => (typeof body[k] === "string" && body[k].trim() ? body[k].trim() : null);
  return {
    fal: read("fal") || fromBody("falKey") || fromBody("falApiKey") || process.env.FAL_KEY || process.env.FAL_API_KEY || null,
    replicate: read("replicate") || fromBody("replicateKey") || process.env.REPLICATE_API_TOKEN || null,
    novita: read("novita") || fromBody("novitaKey") || process.env.NOVITA_API_KEY || null,
    hf: read("hf") || fromBody("hfToken") || process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || null
  };
}

function inferProviderOrder(req, model) {
  const requested = req.body?.providers || req.body?.providerOrder;
  if (Array.isArray(requested) && requested.length) {
    return requested.map((p) => String(p).toLowerCase());
  }
  return model.providers;
}

function createSulphurRouter({ storageDir, getFfmpegReady }) {
  const router = express.Router();
  const baseDir = path.join(storageDir, "sulphur");
  const clipsDir = path.join(baseDir, "clips");
  const bulkDir = path.join(baseDir, "bulk");
  const longDir = path.join(baseDir, "long");
  const dbPath = path.join(baseDir, "jobs-db.json");

  const jobs = new Map();
  let loaded = false;

  async function ensureDirs() {
    await fsp.mkdir(clipsDir, { recursive: true });
    await fsp.mkdir(bulkDir, { recursive: true });
    await fsp.mkdir(longDir, { recursive: true });
  }

  async function persistJobs() {
    await ensureDirs();
    const payload = {
      updatedAt: new Date().toISOString(),
      jobs: Array.from(jobs.values()).slice(-200)
    };
    await fsp.writeFile(dbPath, JSON.stringify(payload, null, 2), "utf8");
  }

  async function loadJobs() {
    if (loaded) return;
    await ensureDirs();
    if (fs.existsSync(dbPath)) {
      try {
        const raw = JSON.parse(await fsp.readFile(dbPath, "utf8"));
        for (const job of raw.jobs || []) jobs.set(job.id, job);
      } catch {
        // ignore corrupt db
      }
    }
    loaded = true;
  }

  function sanitizeJob(job) {
    if (!job) return null;
    const { keys, abortController, ...safe } = job;
    return safe;
  }

  async function updateJob(jobId, patch) {
    const current = jobs.get(jobId);
    if (!current) return null;
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    jobs.set(jobId, next);
    await persistJobs();
    return next;
  }

  async function appendLog(jobId, message) {
    const job = jobs.get(jobId);
    if (!job) return;
    const logs = Array.isArray(job.logs) ? job.logs : [];
    logs.push({ at: new Date().toISOString(), message });
    await updateJob(jobId, { logs: logs.slice(-400) });
  }

  router.get("/health", async (_req, res) => {
    const ffmpegReady = typeof getFfmpegReady === "function" ? getFfmpegReady() : false;
    const localAvailable = await isLocalAvailable(resolveModel(DEFAULT_MODEL_KEY));
    res.json({
      ok: true,
      ffmpegReady,
      localAvailable,
      defaultModel: DEFAULT_MODEL_KEY,
      providers: [PROVIDER_FAL, PROVIDER_REPLICATE, PROVIDER_NOVITA, PROVIDER_LOCAL]
    });
  });

  router.get("/models", (_req, res) => {
    res.json({
      defaultModel: DEFAULT_MODEL_KEY,
      models: listModels()
    });
  });

  // === 1) Génération d'un clip unique (synchrone, courte vidéo) ===
  router.post("/generate", async (req, res) => {
    try {
      await ensureDirs();
      const prompt = String(req.body?.prompt || "").trim();
      if (!prompt) return res.status(400).json({ error: "prompt requis" });
      const modelKey = req.body?.modelKey || DEFAULT_MODEL_KEY;
      const model = resolveModel(modelKey);
      const id = uuidv4();
      const outputPath = path.join(clipsDir, `${id}.mp4`);
      const keys = extractKeys(req);
      const providerOrder = inferProviderOrder(req, model);
      const r = await generateClip({
        prompt,
        modelKey,
        durationSec: req.body?.durationSec,
        aspectRatio: req.body?.aspectRatio,
        outputPath,
        keys,
        providerOrder,
        onLog: (m) => console.log(`[sulphur:${id}] ${m}`)
      });
      return res.json({
        id,
        downloadUrl: `/api/sulphur/clips/${id}/download`,
        streamUrl: `/api/sulphur/clips/${id}/stream`,
        ...r
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur génération";
      return res.status(500).json({ error: message });
    }
  });

  router.get("/clips/:id/stream", (req, res) => {
    const file = path.join(clipsDir, `${req.params.id}.mp4`);
    if (!fs.existsSync(file)) return res.status(404).json({ error: "Clip introuvable" });
    res.setHeader("Content-Type", "video/mp4");
    fs.createReadStream(file).pipe(res);
  });

  router.get("/clips/:id/download", (req, res) => {
    const file = path.join(clipsDir, `${req.params.id}.mp4`);
    if (!fs.existsSync(file)) return res.status(404).json({ error: "Clip introuvable" });
    res.download(file, `sulphur-${req.params.id}.mp4`);
  });

  // === 2) Génération bulk (génération massive en parallèle) ===
  router.post("/bulk", async (req, res) => {
    try {
      await loadJobs();
      const rawPrompts = req.body?.prompts;
      const prompts = Array.isArray(rawPrompts)
        ? rawPrompts.map((p) => String(p || "").trim()).filter(Boolean)
        : String(rawPrompts || "")
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean);
      if (!prompts.length) return res.status(400).json({ error: "prompts requis (tableau ou texte multi-lignes)" });

      const modelKey = req.body?.modelKey || DEFAULT_MODEL_KEY;
      const model = resolveModel(modelKey);
      const keys = extractKeys(req);
      const providerOrder = inferProviderOrder(req, model);
      const concurrency = Math.max(1, Math.min(8, Number(req.body?.concurrency) || 2));

      const id = uuidv4();
      const jobDir = path.join(bulkDir, id);
      await fsp.mkdir(jobDir, { recursive: true });

      const job = {
        id,
        kind: "bulk",
        status: "queued",
        progress: 0,
        total: prompts.length,
        done: 0,
        modelKey,
        model: model.label,
        concurrency,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        logs: [],
        items: []
      };
      jobs.set(id, { ...job, keys });
      await persistJobs();

      // Kickoff async
      setImmediate(async () => {
        await updateJob(id, { status: "running" });
        await appendLog(id, `Bulk start ${prompts.length} prompts (concurrency=${concurrency}) modèle=${model.label}`);
        try {
          const results = await generateBulk({
            prompts,
            modelKey,
            durationSec: req.body?.durationSec,
            aspectRatio: req.body?.aspectRatio,
            outputDir: jobDir,
            keys,
            concurrency,
            providerOrder,
            onProgress: ({ done, total }) =>
              updateJob(id, {
                progress: Math.round((done / total) * 100),
                done
              }),
            onLog: (m) => appendLog(id, m)
          });
          const items = results.map((r) => ({
            index: r.index,
            prompt: r.prompt,
            status: r.status,
            provider: r.provider || null,
            error: r.error || null,
            url: r.url || null,
            downloadUrl: r.status === "succeeded"
              ? `/api/sulphur/bulk/${id}/clips/${String(r.index).padStart(3, "0")}.mp4`
              : null
          }));
          await updateJob(id, {
            status: "completed",
            progress: 100,
            items,
            completedAt: new Date().toISOString()
          });
          await appendLog(id, `Bulk completed (${items.filter((x) => x.status === "succeeded").length}/${items.length})`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await updateJob(id, { status: "failed", error: message });
          await appendLog(id, `Bulk failed: ${message}`);
        }
      });

      return res.status(202).json({ id, status: "queued", total: prompts.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur bulk";
      return res.status(500).json({ error: message });
    }
  });

  router.get("/bulk/:id", async (req, res) => {
    await loadJobs();
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: "Job introuvable" });
    return res.json(sanitizeJob(job));
  });

  router.get("/bulk/:id/clips/:file", (req, res) => {
    const safe = String(req.params.file).replace(/[^a-z0-9.\-_]/gi, "");
    const file = path.join(bulkDir, req.params.id, safe);
    if (!fs.existsSync(file)) return res.status(404).json({ error: "Clip introuvable" });
    res.download(file, `sulphur-bulk-${req.params.id}-${safe}`);
  });

  // === 3) Vidéo longue (plan auto → N clips → assemblage FFmpeg) ===
  router.post("/long", async (req, res) => {
    try {
      await loadJobs();
      const ffmpegReady = typeof getFfmpegReady === "function" ? getFfmpegReady() : false;
      if (!ffmpegReady) return res.status(503).json({ error: "ffmpeg indisponible sur le serveur" });

      const topic = String(req.body?.topic || "").trim();
      if (!topic) return res.status(400).json({ error: "topic requis" });
      const totalDurationSec = Math.max(10, Math.min(3600, Number(req.body?.durationSec) || 60));
      const sceneSec = Math.max(2, Math.min(20, Number(req.body?.sceneSec) || 5));
      const modelKey = req.body?.modelKey || DEFAULT_MODEL_KEY;
      const model = resolveModel(modelKey);
      const keys = extractKeys(req);
      const providerOrder = inferProviderOrder(req, model);
      const concurrency = Math.max(1, Math.min(6, Number(req.body?.concurrency) || 2));

      const id = uuidv4();
      const jobDir = path.join(longDir, id);
      await fsp.mkdir(jobDir, { recursive: true });

      const job = {
        id,
        kind: "long",
        status: "queued",
        topic,
        modelKey,
        model: model.label,
        durationSec: totalDurationSec,
        sceneSec,
        concurrency,
        progress: 0,
        done: 0,
        total: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        logs: []
      };
      jobs.set(id, { ...job, keys });
      await persistJobs();

      setImmediate(async () => {
        await updateJob(id, { status: "planning" });
        await appendLog(id, `Plan ${totalDurationSec}s en scènes de ${sceneSec}s…`);
        try {
          const plan = await planScenes({
            topic,
            durationSec: totalDurationSec,
            sceneSec,
            mistralKey: req.body?.mistralKey || keys.hf || null,
            mistralModel: req.body?.mistralModel
          });
          const prompts = plan.scenes.map((s) => s.visualPrompt);
          await updateJob(id, {
            status: "generating",
            title: plan.title,
            total: prompts.length,
            sceneCount: prompts.length
          });
          await appendLog(id, `Plan OK: ${plan.title} (${prompts.length} scènes)`);

          const results = await generateBulk({
            prompts,
            modelKey,
            durationSec: sceneSec,
            aspectRatio: req.body?.aspectRatio,
            outputDir: jobDir,
            keys,
            concurrency,
            providerOrder,
            onProgress: ({ done, total }) =>
              updateJob(id, { progress: Math.round((done / total) * 88), done }),
            onLog: (m) => appendLog(id, m)
          });

          const succeeded = results.filter((r) => r.status === "succeeded");
          if (!succeeded.length) throw new Error("Aucune scène générée");
          await updateJob(id, { status: "assembling", progress: 92 });
          await appendLog(id, `Assemblage FFmpeg de ${succeeded.length} clips…`);

          const clipPaths = succeeded.map((r) => r.path);
          const outputPath = path.join(jobDir, "final.mp4");
          await concatClips({ clipPaths, outputPath });
          const stats = await fsp.stat(outputPath);

          await updateJob(id, {
            status: "completed",
            progress: 100,
            downloadUrl: `/api/sulphur/long/${id}/download`,
            outputPath,
            size: stats.size,
            scenes: results.map((r) => ({
              index: r.index,
              prompt: r.prompt,
              status: r.status,
              provider: r.provider || null,
              error: r.error || null
            })),
            completedAt: new Date().toISOString()
          });
          await appendLog(id, `Vidéo longue prête (${stats.size} octets)`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await updateJob(id, { status: "failed", error: message });
          await appendLog(id, `Long failed: ${message}`);
        }
      });

      return res.status(202).json({ id, status: "queued" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur long";
      return res.status(500).json({ error: message });
    }
  });

  router.get("/long/:id", async (req, res) => {
    await loadJobs();
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: "Job introuvable" });
    return res.json(sanitizeJob(job));
  });

  router.get("/long/:id/download", (req, res) => {
    const file = path.join(longDir, req.params.id, "final.mp4");
    if (!fs.existsSync(file)) return res.status(404).json({ error: "Vidéo introuvable" });
    res.download(file, `sulphur-long-${req.params.id}.mp4`);
  });

  router.get("/jobs", async (_req, res) => {
    await loadJobs();
    const items = Array.from(jobs.values())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 100)
      .map(sanitizeJob);
    res.json({ jobs: items });
  });

  return router;
}

module.exports = { createSulphurRouter };
