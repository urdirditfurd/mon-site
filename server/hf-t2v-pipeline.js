/**
 * HF Text-to-Video Pipeline — module Node.js
 *
 * Gère :
 *  - Le démarrage / arrêt du microservice Python (server/hf_t2v_service.py)
 *  - La communication avec l'API du microservice (fetch)
 *  - La génération en masse (bulk) depuis une liste de sujets
 *  - La planification quotidienne illimitée
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const HF_T2V_PORT = Number(process.env.HF_T2V_PORT) || 7860;
const HF_T2V_BASE = `http://127.0.0.1:${HF_T2V_PORT}`;
const HF_T2V_MODEL = process.env.HF_T2V_MODEL || "wan-1.3b";
const HF_T2V_DEVICE = process.env.HF_T2V_DEVICE || "";
const HF_T2V_PRELOAD = process.env.HF_T2V_PRELOAD === "1";
const HF_T2V_STARTUP_TIMEOUT_MS = Number(process.env.HF_T2V_STARTUP_TIMEOUT_MS) || 120_000;
const HF_T2V_WORKERS = Number(process.env.HF_T2V_WORKERS) || 1;

const PYTHON_CMD = process.env.PYTHON_CMD || "python3";
const SERVICE_SCRIPT = path.resolve(__dirname, "hf_t2v_service.py");

let _serviceProcess = null;
let _serviceReady = false;
let _serviceStarting = false;

// ---------------------------------------------------------------------------
// Démarrage du microservice Python
// ---------------------------------------------------------------------------

async function waitForService(timeoutMs = HF_T2V_STARTUP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${HF_T2V_BASE}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch {
      // pas encore prêt
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function startService() {
  if (_serviceReady) return true;
  if (_serviceStarting) {
    return waitForService();
  }

  _serviceStarting = true;

  // Vérifier si le service est déjà en cours (démarré manuellement)
  try {
    const res = await fetch(`${HF_T2V_BASE}/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      _serviceReady = true;
      _serviceStarting = false;
      console.log(`[HF-T2V] Service déjà actif sur port ${HF_T2V_PORT}`);
      return true;
    }
  } catch {
    // pas encore démarré
  }

  const args = [SERVICE_SCRIPT, "--port", String(HF_T2V_PORT), "--model", HF_T2V_MODEL, "--workers", String(HF_T2V_WORKERS)];
  if (HF_T2V_DEVICE) args.push("--device", HF_T2V_DEVICE);
  if (HF_T2V_PRELOAD) args.push("--preload");

  console.log(`[HF-T2V] Démarrage: ${PYTHON_CMD} ${args.join(" ")}`);

  _serviceProcess = spawn(PYTHON_CMD, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PYTHONUNBUFFERED: "1" }
  });

  _serviceProcess.stdout.on("data", (data) => process.stdout.write(`[HF-T2V] ${data}`));
  _serviceProcess.stderr.on("data", (data) => process.stderr.write(`[HF-T2V] ${data}`));
  _serviceProcess.on("exit", (code) => {
    console.warn(`[HF-T2V] Service terminé (code=${code})`);
    _serviceReady = false;
    _serviceProcess = null;
  });

  const ok = await waitForService();
  _serviceReady = ok;
  _serviceStarting = false;

  if (!ok) {
    console.error("[HF-T2V] Timeout — le service Python n'a pas répondu");
  } else {
    console.log(`[HF-T2V] Service prêt sur port ${HF_T2V_PORT}`);
  }
  return ok;
}

function stopService() {
  if (_serviceProcess) {
    _serviceProcess.kill("SIGTERM");
    _serviceProcess = null;
    _serviceReady = false;
  }
}

// ---------------------------------------------------------------------------
// Client HTTP léger pour le microservice
// ---------------------------------------------------------------------------

async function hfFetch(urlPath, options = {}) {
  const url = `${HF_T2V_BASE}${urlPath}`;
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    signal: options.signal || AbortSignal.timeout(30_000)
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    throw new Error(body?.detail || body?.message || body?.error || text || res.statusText);
  }
  return body;
}

// ---------------------------------------------------------------------------
// API publique — génération simple
// ---------------------------------------------------------------------------

async function generateVideo({ prompt, durationSec = 5, width = 832, height = 480, fps = 15, guidanceScale = 5, steps = 50, model, seed, negativePrompt }) {
  const ready = await startService();
  if (!ready) throw new Error("Microservice HF T2V indisponible");

  const body = {
    prompt,
    durationSec: Number(durationSec),
    width: Number(width),
    height: Number(height),
    fps: Number(fps),
    guidanceScale: Number(guidanceScale),
    steps: Number(steps),
    ...(model ? { model } : {}),
    ...(seed != null ? { seed: Number(seed) } : {}),
    ...(negativePrompt ? { negativePrompt } : {})
  };

  return hfFetch("/generate", { method: "POST", body: JSON.stringify(body) });
}

async function getJobStatus(jobId) {
  const ready = await startService();
  if (!ready) throw new Error("Microservice HF T2V indisponible");
  return hfFetch(`/jobs/${jobId}`);
}

async function listJobs(limit = 50) {
  const ready = await startService();
  if (!ready) return [];
  return hfFetch(`/jobs?limit=${limit}`);
}

async function listModels() {
  const ready = await startService();
  if (!ready) return Object.entries(require("./hf-t2v-pipeline").SUPPORTED_MODELS_INFO);
  return hfFetch("/models");
}

async function getQueueStatus() {
  const ready = await startService();
  if (!ready) return { size: 0, active_model: null, device: "unavailable" };
  return hfFetch("/queue");
}

async function clearQueue() {
  const ready = await startService();
  if (!ready) throw new Error("Microservice HF T2V indisponible");
  return hfFetch("/queue/clear", { method: "POST" });
}

// ---------------------------------------------------------------------------
// Génération en masse avec Mistral (planification de sujets → vidéos)
// ---------------------------------------------------------------------------

async function planVideoTopicsWithMistral({ mistralKey, theme, count, durationMin, mistralModel = "mistral-small-2506" }) {
  const isShort = durationMin <= 1;
  const durationLabel = isShort ? `${Math.round(durationMin * 60)} secondes` : `${durationMin} minutes`;

  const prompt = `Tu es un expert en création de contenu vidéo viral. Génère exactement ${count} sujets et prompts visuels pour des vidéos ${isShort ? "courtes" : "longues"} (~${durationLabel} chacune).

Thème général : ${theme}

Pour chaque vidéo, fournis un prompt visuel détaillé en anglais pour une IA text-to-video (style cinématique, pas de texte à l'écran, pas de célébrités).

Réponds UNIQUEMENT en JSON valide :
{
  "videos": [
    {
      "title": "titre accrocheur français",
      "prompt": "detailed cinematic visual prompt in English for AI video generation, no text on screen, no celebrity faces",
      "durationSec": ${Math.round(durationMin * 60)},
      "hashtags": ["#tag1", "#tag2"]
    }
  ]
}`;

  const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${mistralKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: mistralModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.85,
      max_tokens: Math.min(16000, 600 + count * 120)
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Mistral bulk: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || "";
  const clean = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(clean);

  if (!Array.isArray(parsed.videos) || !parsed.videos.length) {
    throw new Error("Réponse Mistral invalide pour la génération en masse");
  }

  return parsed.videos.slice(0, count).map((v) => ({
    title: String(v.title || "Vidéo IA").trim(),
    prompt: String(v.prompt || "Cinematic abstract motion, dramatic lighting").trim(),
    durationSec: Number(v.durationSec) || Math.round(durationMin * 60),
    hashtags: Array.isArray(v.hashtags) ? v.hashtags : []
  }));
}

// ---------------------------------------------------------------------------
// Gestionnaire de sessions de génération en masse
// ---------------------------------------------------------------------------

const _bulkSessions = new Map();
const _bulkSessionsFile = path.resolve(__dirname, "../storage/hf-bulk-sessions.json");

async function _saveBulkSessions() {
  await fsp.mkdir(path.dirname(_bulkSessionsFile), { recursive: true });
  const payload = {
    updatedAt: new Date().toISOString(),
    sessions: Array.from(_bulkSessions.values()).slice(-100)
  };
  await fsp.writeFile(_bulkSessionsFile, JSON.stringify(payload, null, 2), "utf8");
}

async function _loadBulkSessions() {
  if (!fs.existsSync(_bulkSessionsFile)) return;
  try {
    const raw = JSON.parse(await fsp.readFile(_bulkSessionsFile, "utf8"));
    for (const s of raw.sessions || []) _bulkSessions.set(s.id, s);
  } catch {
    /* ignore */
  }
}

async function createBulkSession({
  theme,
  count,
  durationMin,
  width,
  height,
  fps,
  steps,
  model,
  guidanceScale,
  mistralKey,
  mistralModel
}) {
  await _loadBulkSessions();

  const sessionId = uuidv4();
  const session = {
    id: sessionId,
    status: "queued",
    theme: String(theme || "").trim(),
    count: Math.min(500, Math.max(1, Number(count) || 5)),
    durationMin: Number(durationMin) || 0.5,
    width: Number(width) || 832,
    height: Number(height) || 480,
    fps: Number(fps) || 15,
    steps: Number(steps) || 50,
    guidanceScale: Number(guidanceScale) || 5.0,
    model: String(model || HF_T2V_MODEL),
    progress: 0,
    videosPlanned: 0,
    videosCompleted: 0,
    videosFailed: 0,
    hfJobIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    logs: []
  };

  if (!session.theme) throw new Error("theme requis");

  _bulkSessions.set(sessionId, session);
  await _saveBulkSessions();

  setImmediate(() => _runBulkSession(sessionId, mistralKey, mistralModel).catch(async (err) => {
    const message = err instanceof Error ? err.message : String(err);
    const s = _bulkSessions.get(sessionId);
    if (s) {
      s.status = "failed";
      s.error = message;
      s.updatedAt = new Date().toISOString();
      await _saveBulkSessions();
    }
  }));

  return { id: sessionId, status: "queued" };
}

async function _runBulkSession(sessionId, mistralKey, mistralModel) {
  const patch = async (data) => {
    const s = _bulkSessions.get(sessionId);
    if (!s) return;
    Object.assign(s, data, { updatedAt: new Date().toISOString() });
    await _saveBulkSessions();
  };
  const appendLog = async (msg) => {
    const s = _bulkSessions.get(sessionId);
    if (!s) return;
    s.logs = [...(s.logs || []).slice(-200), { at: new Date().toISOString(), msg }];
    s.updatedAt = new Date().toISOString();
    await _saveBulkSessions();
  };

  await patch({ status: "planning" });
  const session = _bulkSessions.get(sessionId);

  let videos;
  if (mistralKey) {
    await appendLog("Planification des sujets via Mistral…");
    videos = await planVideoTopicsWithMistral({
      mistralKey,
      theme: session.theme,
      count: session.count,
      durationMin: session.durationMin,
      mistralModel: mistralModel || "mistral-small-2506"
    });
  } else {
    // Mode sans Mistral : utiliser le thème directement comme prompt
    await appendLog("Mode sans Mistral — utilisation directe du thème comme prompt");
    videos = Array.from({ length: session.count }, (_, i) => ({
      title: `${session.theme} #${i + 1}`,
      prompt: `${session.theme}. Cinematic, original content, no text, no logos, ultra HD, dramatic lighting`,
      durationSec: Math.round(session.durationMin * 60),
      hashtags: []
    }));
  }

  await patch({ status: "generating", videosPlanned: videos.length, progress: 5 });
  await appendLog(`${videos.length} vidéos planifiées — lancement de la génération HF…`);

  const ready = await startService();
  if (!ready) throw new Error("Microservice HF T2V indisponible");

  const hfJobIds = [];

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    const hfJob = await hfFetch("/generate", {
      method: "POST",
      body: JSON.stringify({
        prompt: video.prompt,
        durationSec: video.durationSec,
        width: session.width,
        height: session.height,
        fps: session.fps,
        guidanceScale: session.guidanceScale,
        steps: session.steps,
        model: session.model
      })
    });
    hfJobIds.push({ hfJobId: hfJob.id, title: video.title, hashtags: video.hashtags, durationSec: video.durationSec });
    await appendLog(`Vidéo ${i + 1}/${videos.length} soumise (job=${hfJob.id})`);
  }

  await patch({ hfJobIds, progress: 10 });

  // Polling jusqu'à completion de tous les jobs
  let completed = 0;
  let failed = 0;
  const total = hfJobIds.length;

  while (completed + failed < total) {
    await new Promise((r) => setTimeout(r, 8000));

    let doneInThisPass = 0;
    for (const entry of hfJobIds) {
      if (entry.done) continue;
      try {
        const jobStatus = await hfFetch(`/jobs/${entry.hfJobId}`);
        if (jobStatus.status === "completed") {
          entry.done = true;
          entry.outputPath = jobStatus.outputPath;
          entry.downloadUrl = jobStatus.downloadUrl;
          completed++;
          doneInThisPass++;
        } else if (jobStatus.status === "failed" || jobStatus.status === "cancelled") {
          entry.done = true;
          entry.error = jobStatus.error;
          failed++;
          doneInThisPass++;
        }
      } catch {
        /* retry au prochain passage */
      }
    }

    const progress = 10 + Math.round(((completed + failed) / total) * 90);
    await patch({ videosCompleted: completed, videosFailed: failed, progress, hfJobIds });

    if (doneInThisPass > 0) {
      await appendLog(`Progression: ${completed}/${total} terminées, ${failed} échouées`);
    }
  }

  await patch({
    status: "completed",
    progress: 100,
    videosCompleted: completed,
    videosFailed: failed,
    hfJobIds,
    completedAt: new Date().toISOString()
  });
  await appendLog(`Session terminée: ${completed}/${total} vidéos générées`);
}

async function getBulkSession(sessionId) {
  await _loadBulkSessions();
  return _bulkSessions.get(sessionId) || null;
}

async function listBulkSessions(limit = 20) {
  await _loadBulkSessions();
  return Array.from(_bulkSessions.values())
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Planificateur quotidien
// ---------------------------------------------------------------------------

const _scheduleFile = path.resolve(__dirname, "../storage/hf-t2v-schedule.json");
let _scheduleTimer = null;
let _scheduleConfig = null;

async function readScheduleConfig() {
  if (!fs.existsSync(_scheduleFile)) return null;
  try {
    return JSON.parse(await fsp.readFile(_scheduleFile, "utf8"));
  } catch {
    return null;
  }
}

async function writeScheduleConfig(config) {
  await fsp.mkdir(path.dirname(_scheduleFile), { recursive: true });
  await fsp.writeFile(_scheduleFile, JSON.stringify(config, null, 2), "utf8");
}

async function saveSchedule(config) {
  const cfg = {
    enabled: Boolean(config.enabled),
    theme: String(config.theme || "").trim(),
    countPerRun: Math.min(500, Math.max(1, Number(config.countPerRun) || 10)),
    durationMin: Number(config.durationMin) || 0.5,
    intervalHours: Math.max(0.5, Number(config.intervalHours) || 24),
    width: Number(config.width) || 832,
    height: Number(config.height) || 480,
    fps: Number(config.fps) || 15,
    steps: Number(config.steps) || 50,
    guidanceScale: Number(config.guidanceScale) || 5.0,
    model: String(config.model || HF_T2V_MODEL),
    mistralKey: String(config.mistralKey || "").trim(),
    mistralModel: String(config.mistralModel || "mistral-small-2506"),
    updatedAt: new Date().toISOString(),
    nextRunAt: null,
    lastRunAt: null,
    lastSessionId: null
  };

  if (!cfg.theme) throw new Error("theme requis pour la planification");

  await writeScheduleConfig(cfg);
  _scheduleConfig = cfg;

  if (_scheduleTimer) {
    clearTimeout(_scheduleTimer);
    _scheduleTimer = null;
  }
  if (cfg.enabled) {
    _scheduleNextRun(cfg);
  }

  return cfg;
}

function _scheduleNextRun(cfg) {
  const delayMs = cfg.intervalHours * 3600 * 1000;
  const nextRunAt = new Date(Date.now() + delayMs).toISOString();
  cfg.nextRunAt = nextRunAt;
  writeScheduleConfig(cfg).catch(() => {});

  console.log(`[HF-T2V] Prochain run planifié: ${nextRunAt}`);

  _scheduleTimer = setTimeout(async () => {
    try {
      console.log(`[HF-T2V] Déclenchement planifié — thème: ${cfg.theme}`);
      const session = await createBulkSession({
        theme: cfg.theme,
        count: cfg.countPerRun,
        durationMin: cfg.durationMin,
        width: cfg.width,
        height: cfg.height,
        fps: cfg.fps,
        steps: cfg.steps,
        guidanceScale: cfg.guidanceScale,
        model: cfg.model,
        mistralKey: cfg.mistralKey,
        mistralModel: cfg.mistralModel
      });
      cfg.lastRunAt = new Date().toISOString();
      cfg.lastSessionId = session.id;
      await writeScheduleConfig(cfg);
      console.log(`[HF-T2V] Session planifiée créée: ${session.id}`);
    } catch (err) {
      console.error("[HF-T2V] Erreur run planifié:", err.message);
    }
    // Replanifier le prochain run
    const currentCfg = await readScheduleConfig();
    if (currentCfg?.enabled) {
      _scheduleNextRun(currentCfg);
    }
  }, delayMs);
}

async function initScheduler() {
  const cfg = await readScheduleConfig();
  if (cfg?.enabled) {
    _scheduleConfig = cfg;
    _scheduleNextRun(cfg);
    console.log(`[HF-T2V] Planificateur restauré (thème="${cfg.theme}", toutes les ${cfg.intervalHours}h)`);
  }
}

async function getSchedule() {
  return (await readScheduleConfig()) || { enabled: false };
}

// ---------------------------------------------------------------------------
// Proxy de téléchargement — forward le fichier depuis le microservice Python
// ---------------------------------------------------------------------------

async function proxyDownload(jobId, res) {
  const job = await hfFetch(`/jobs/${jobId}`);
  if (job.status !== "completed") {
    res.status(409).json({ error: `Vidéo non prête (status=${job.status})` });
    return;
  }
  const outputPath = job.outputPath;
  if (!outputPath || !fs.existsSync(outputPath)) {
    res.status(404).json({ error: "Fichier vidéo introuvable" });
    return;
  }
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", `attachment; filename="hf-t2v-${jobId.slice(0, 8)}.mp4"`);
  fs.createReadStream(outputPath).pipe(res);
}

// ---------------------------------------------------------------------------
// Informations statiques sur les modèles (sans démarrer le service)
// ---------------------------------------------------------------------------

const SUPPORTED_MODELS_INFO = {
  "wan-1.3b": {
    repo: "Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
    vram_gb: 8.2,
    description: "Wan 2.1 1.3B — léger, idéal génération en masse (< 8 GB VRAM)"
  },
  "wan-14b": {
    repo: "Wan-AI/Wan2.1-T2V-14B-Diffusers",
    vram_gb: 18,
    description: "Wan 2.1 14B — haute qualité (18 GB VRAM min.)"
  },
  ltx: {
    repo: "Lightricks/LTX-Video-2.1",
    vram_gb: 8,
    description: "LTX-Video 2.1 — base de Sulphur-2, rapide (< 8 GB VRAM)"
  }
};

module.exports = {
  startService,
  stopService,
  generateVideo,
  getJobStatus,
  listJobs,
  listModels,
  getQueueStatus,
  clearQueue,
  proxyDownload,
  createBulkSession,
  getBulkSession,
  listBulkSessions,
  saveSchedule,
  getSchedule,
  initScheduler,
  SUPPORTED_MODELS_INFO,
  HF_T2V_BASE,
  HF_T2V_PORT,
  HF_T2V_MODEL
};
