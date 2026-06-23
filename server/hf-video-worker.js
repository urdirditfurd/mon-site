const path = require("path");
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");

const PYTHON_BIN = process.env.HF_T2V_PYTHON_BIN || "python3";
const WORKER_SCRIPT_PATH = path.join(__dirname, "hf_t2v_worker.py");

function createHfVideoWorker({ logger = console } = {}) {
  let processRef = null;
  let bootPromise = null;
  let closed = false;
  const pending = new Map();
  let queue = Promise.resolve();
  let stdoutBuffer = "";

  function settlePendingAsFailed(errorMessage) {
    for (const [, item] of pending.entries()) {
      clearTimeout(item.timeout);
      item.reject(new Error(errorMessage));
    }
    pending.clear();
  }

  function onStdout(data) {
    stdoutBuffer += String(data || "");
    const chunks = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = chunks.pop() || "";
    const lines = chunks.map((line) => line.trim()).filter(Boolean);

    for (const line of lines) {
      let payload;
      try {
        payload = JSON.parse(line);
      } catch (_err) {
        logger.warn?.(`[HF Worker] Ligne JSON invalide: ${line.slice(0, 200)}`);
        continue;
      }

      const id = payload?.id;
      if (!id || !pending.has(id)) continue;
      const task = pending.get(id);
      pending.delete(id);
      clearTimeout(task.timeout);

      if (payload.ok) task.resolve(payload.result || {});
      else task.reject(new Error(payload.error || "Erreur worker HF"));
    }
  }

  function onStderr(data) {
    const message = String(data || "").trim();
    if (!message) return;
    logger.warn?.(`[HF Worker] ${message}`);
  }

  function ensureWorkerProcess() {
    if (closed) {
      throw new Error("Worker HF fermé");
    }
    if (processRef && !processRef.killed) {
      return processRef;
    }

    const child = spawn(PYTHON_BIN, [WORKER_SCRIPT_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env
    });

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.on("error", (error) => {
      settlePendingAsFailed(`Worker HF indisponible: ${error.message}`);
      processRef = null;
    });
    child.on("close", (code) => {
      settlePendingAsFailed(`Worker HF arrêté (code ${code ?? "?"})`);
      processRef = null;
    });

    processRef = child;
    return child;
  }

  async function request(payload, timeoutMs = 600000) {
    const worker = ensureWorkerProcess();
    const id = randomUUID();
    const body = JSON.stringify({ ...payload, id });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Timeout worker HF"));
      }, timeoutMs);

      pending.set(id, { resolve, reject, timeout });
      worker.stdin.write(`${body}\n`, (err) => {
        if (!err) return;
        clearTimeout(timeout);
        pending.delete(id);
        reject(new Error(`Impossible d'écrire vers le worker HF: ${err.message}`));
      });
    });
  }

  async function boot() {
    if (bootPromise) return bootPromise;
    bootPromise = request({ action: "ping" }, 30000).catch((error) => {
      bootPromise = null;
      throw error;
    });
    return bootPromise;
  }

  function runSerialized(taskFn) {
    const next = queue.then(taskFn, taskFn);
    queue = next.catch(() => {});
    return next;
  }

  async function generateClip({
    outputPath,
    prompt,
    modelId,
    negativePrompt,
    durationSec,
    fps,
    numFrames,
    numInferenceSteps,
    guidanceScale,
    seed,
    width,
    height
  }) {
    return runSerialized(async () => {
      await boot();
      return request(
        {
          action: "generate",
          outputPath,
          prompt,
          modelId,
          negativePrompt,
          durationSec,
          fps,
          numFrames,
          numInferenceSteps,
          guidanceScale,
          seed,
          width,
          height
        },
        60 * 60 * 1000
      );
    });
  }

  async function shutdown() {
    closed = true;
    if (!processRef || processRef.killed) return;
    try {
      await request({ action: "shutdown" }, 10000).catch(() => {});
    } finally {
      processRef.kill("SIGTERM");
      processRef = null;
    }
  }

  return {
    generateClip,
    shutdown
  };
}

module.exports = {
  createHfVideoWorker,
  WORKER_SCRIPT_PATH
};
