(function initQwenVideoUi() {
  const STORAGE_KEY = "qwen-video-ia-settings-v1";
  let pollTimer = null;
  let currentJobId = null;

  function $(id) {
    return document.getElementById(id);
  }

  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveSettings(patch) {
    const next = { ...loadSettings(), ...patch };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function apiBase() {
    if (location.protocol === "file:") return "http://localhost:3000";
    return location.origin;
  }

  function toast(msg, type) {
    const el = $("toast");
    if (!el) return;
    el.className = `alert ${type || "info"}`;
    el.textContent = msg;
    el.classList.remove("hidden");
  }

  function log(line) {
    const box = $("log");
    if (!box) return;
    const row = document.createElement("div");
    row.className = "log-line";
    row.textContent = `[${new Date().toLocaleTimeString("fr-FR")}] ${line}`;
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
  }

  function setProgress(pct, label, detail) {
    const fill = $("progressFill");
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, pct || 0))}%`;
    if ($("statusLabel")) $("statusLabel").textContent = label || "—";
    if ($("progressDetail")) $("progressDetail").textContent = detail || "";
  }

  function formatDuration(sec) {
    if (sec < 60) return `${sec} s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s ? `${m} min ${s} s` : `${m} min`;
  }

  function updateDurationLabel() {
    const total = Number($("totalSec")?.value || 60);
    const seg = Number($("segmentSec")?.value || 5);
    const count = Math.max(1, Math.ceil(total / seg));
    if ($("totalLabel")) $("totalLabel").textContent = formatDuration(total);
    if ($("planSummary")) {
      $("planSummary").textContent =
        `${count} segments × ${seg} s ≈ ${formatDuration(count * seg)} (${$("model")?.value || ""})`;
    }
  }

  function restoreForm() {
    const s = loadSettings();
    if (s.script && $("script")) $("script").value = s.script;
    if (s.totalSec && $("totalSec")) $("totalSec").value = s.totalSec;
    if (s.segmentSec && $("segmentSec")) $("segmentSec").value = s.segmentSec;
    if (s.model && $("model")) $("model").value = s.model;
    if (s.engine && $("engine")) $("engine").value = s.engine;
    if (s.aspect && $("aspect")) $("aspect").value = s.aspect;
    if (s.resolution && $("resolution")) $("resolution").value = s.resolution;
    if (s.pinokioUrl && $("pinokioUrl")) $("pinokioUrl").value = s.pinokioUrl;
    if (s.apiKey && $("apiKey")) $("apiKey").value = s.apiKey;
    updateDurationLabel();
  }

  function persistForm() {
    saveSettings({
      script: $("script")?.value || "",
      totalSec: Number($("totalSec")?.value || 60),
      segmentSec: Number($("segmentSec")?.value || 5),
      model: $("model")?.value,
      engine: $("engine")?.value,
      aspect: $("aspect")?.value,
      resolution: $("resolution")?.value,
      pinokioUrl: $("pinokioUrl")?.value,
      apiKey: $("apiKey")?.value || ""
    });
  }

  async function refreshHealth() {
    try {
      const res = await fetch(`${apiBase()}/api/qwen/health`);
      const data = await res.json();
      const server = $("pill-server");
      const ffmpeg = $("pill-ffmpeg");
      const engine = $("pill-engine");
      if (server) {
        server.textContent = data.ok ? "Serveur OK" : "Serveur erreur";
        server.className = `pill ${data.ok ? "ok" : "warn"}`;
      }
      if (ffmpeg) {
        ffmpeg.textContent = data.ffmpegReady ? "FFmpeg OK" : "FFmpeg manquant";
        ffmpeg.className = `pill ${data.ffmpegReady ? "ok" : "warn"}`;
      }
      if (engine) {
        const pinOk = Boolean(data.pinokio?.ok);
        const mode = data.pinokio?.mode || "";
        const pin = pinOk ? `Wan ON (${mode || "ok"})` : "Wan OFF — lance Pinokio";
        engine.textContent = pin;
        engine.className = `pill ${pinOk ? "ok" : "warn"}`;
      }
      return data;
    } catch {
      const server = $("pill-server");
      if (server) {
        server.textContent = "Serveur hors ligne";
        server.className = "pill warn";
      }
      toast("Lance npm start puis recharge cette page.", "warn");
      return null;
    }
  }

  async function previewPlan() {
    persistForm();
    const body = {
      totalSec: Number($("totalSec").value),
      segmentSec: Number($("segmentSec").value),
      script: $("script").value,
      model: $("model").value
    };
    const res = await fetch(`${apiBase()}/api/qwen/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur plan");
    $("planSummary").textContent =
      `${data.segmentCount} segments × ${data.segmentSec} s ≈ ${formatDuration(data.estimatedSec)}`;
    log(`Plan: ${data.segmentCount} segments`);
    data.segments.slice(0, 4).forEach((s) => log(`  #${s.index + 1} ${s.prompt.slice(0, 90)}…`));
    if (data.segments.length > 4) log(`  … +${data.segments.length - 4} autres`);
    toast("Plan prêt.", "info");
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function pollJob(jobId) {
    const res = await fetch(`${apiBase()}/api/qwen/jobs/${jobId}`);
    const job = await res.json();
    if (!res.ok) throw new Error(job.error || "Job introuvable");

    setProgress(job.progress?.pct || 0, job.progress?.label || job.status, job.progress?.detail || "");
    if (Array.isArray(job.logs)) {
      const box = $("log");
      if (box && job.logs.length) {
        const last = job.logs[job.logs.length - 1];
        if (!box.dataset.lastLog || box.dataset.lastLog !== last) {
          box.dataset.lastLog = last;
          log(last.replace(/^\[[^\]]+\]\s*/, ""));
        }
      }
    }

    if (job.status === "done") {
      stopPolling();
      $("btnGenerate").disabled = false;
      const url = `${apiBase()}${job.downloadUrl}`;
      $("previewWrap").classList.remove("hidden");
      $("preview").src = url;
      $("btnDownload").href = url;
      toast("Vidéo prête.", "info");
      log("Terminé — téléchargement disponible");
    } else if (job.status === "error") {
      stopPolling();
      $("btnGenerate").disabled = false;
      toast(job.error || "Échec génération", "error");
      log(`ERREUR: ${job.error || "?"}`);
    }
  }

  async function generate() {
    persistForm();
    stopPolling();
    $("log").innerHTML = "";
    $("previewWrap").classList.add("hidden");
    $("btnGenerate").disabled = true;
    setProgress(2, "Création du job…", "");

    const payload = {
      engine: $("engine").value,
      model: $("model").value,
      script: $("script").value,
      totalSec: Number($("totalSec").value),
      segmentSec: Number($("segmentSec").value),
      aspectRatio: $("aspect").value,
      resolution: $("resolution").value,
      pinokioUrl: $("pinokioUrl").value,
      apiKey: $("apiKey").value
    };

    try {
      const res = await fetch(`${apiBase()}/api/qwen/jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(payload.apiKey ? { "x-qwen-key": payload.apiKey } : {})
        },
        body: JSON.stringify(payload)
      });
      const job = await res.json();
      if (!res.ok) throw new Error(job.error || "Impossible de créer le job");
      currentJobId = job.id;
      log(`Job ${job.id.slice(0, 8)}… démarré (${job.engine})`);
      toast("Génération lancée.", "info");
      await pollJob(job.id);
      pollTimer = setInterval(() => {
        pollJob(job.id).catch((err) => {
          stopPolling();
          $("btnGenerate").disabled = false;
          toast(err.message || String(err), "error");
        });
      }, 1500);
    } catch (error) {
      $("btnGenerate").disabled = false;
      toast(error.message || String(error), "error");
      log(error.message || String(error));
    }
  }

  function bind() {
    ["totalSec", "segmentSec", "model"].forEach((id) => {
      $(id)?.addEventListener("input", updateDurationLabel);
      $(id)?.addEventListener("change", updateDurationLabel);
    });
    $("btnPlan")?.addEventListener("click", () => {
      previewPlan().catch((err) => toast(err.message || String(err), "error"));
    });
    $("btnGenerate")?.addEventListener("click", () => {
      generate().catch((err) => toast(err.message || String(err), "error"));
    });
    window.addEventListener("beforeunload", persistForm);
  }

  restoreForm();
  bind();
  refreshHealth();
  updateDurationLabel();
})();
