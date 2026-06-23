/**
 * ClipForge Video Factory — interface surface (script, durée, format)
 */
(function initVideoFactory(global) {
  const COLAB_URL =
    "https://colab.research.google.com/github/urdirditfurd/mon-site/blob/main/colab/text-to-video-gratuit.ipynb";
  const STORAGE_KEY = "vf_settings_v1";

  const state = {
    aspectRatio: "9:16",
    engine: "colab",
    running: false,
    cancelRequested: false,
    jobId: null
  };

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

  function getApiBase() {
    const saved = document.getElementById("vf-api-base")?.value?.trim();
    if (saved) return saved.replace(/\/$/, "");
    if (global.location?.protocol !== "file:") {
      return `${global.location.origin}`;
    }
    return "http://localhost:3000";
  }

  function sulphurUrl(path) {
    return `${getApiBase()}/api/sulphur${path}`;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function log(line) {
    const box = $("vf-log");
    if (!box) return;
    const row = document.createElement("div");
    row.className = "log-line";
    row.textContent = `[${new Date().toLocaleTimeString("fr-FR")}] ${line}`;
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
  }

  function setProgress(pct, label, detail) {
    const fill = $("vf-progress-fill");
    const lbl = $("vf-progress-label");
    const det = $("vf-progress-detail");
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    if (lbl) lbl.textContent = label || "";
    if (det) det.textContent = detail || "";
  }

  function toast(msg, type = "info") {
    const el = $("vf-toast");
    if (!el) return;
    el.className = `alert alert-${type === "error" ? "error" : type === "warn" ? "warn" : "info"}`;
    el.textContent = msg;
    el.classList.remove("hidden");
  }

  function getScript() {
    return String($("vf-script")?.value || "").trim();
  }

  function getDurationMin() {
    return Number($("vf-duration")?.value || 1);
  }

  function getClipSec() {
    return Number($("vf-clip-sec")?.value || 4);
  }

  function getMistralKey() {
    return String($("vf-mistral-key")?.value || loadSettings().mistralKey || "").trim();
  }

  function updateDurationLabel() {
    const min = getDurationMin();
    const clip = getClipSec();
    const scenes = Math.max(1, Math.ceil((min * 60) / clip));
    const label = $("vf-duration-label");
    const scenesEl = $("vf-scenes-estimate");
    if (label) {
      if (min < 1) {
        label.textContent = `${Math.round(min * 60)} s`;
      } else {
        label.textContent = `${min} min`;
      }
    }
    if (scenesEl) scenesEl.textContent = String(scenes);
  }

  function updateMetrics() {
    updateDurationLabel();
    const engine = state.engine;
    const min = getDurationMin();
    const scenes = Math.max(1, Math.ceil((min * 60) / getClipSec()));
    const durLabel = $("vf-duration-label")?.textContent || `${min} min`;
    $("vf-metric-duration").textContent = durLabel;
    $("vf-metric-scenes").textContent = String(scenes);
    $("vf-metric-format").textContent = state.aspectRatio;
    $("vf-metric-cost").textContent =
      engine === "fal" ? `~${(scenes * 0.5).toFixed(1)} €` : "0 €";
    $("vf-metric-engine").textContent =
      engine === "colab"
        ? "Google Colab"
        : engine === "server"
          ? "Serveur local"
          : "FAL cloud";
  }

  function bindFormatCards() {
    document.querySelectorAll("[data-aspect]").forEach((card) => {
      card.addEventListener("click", () => {
        document.querySelectorAll("[data-aspect]").forEach((c) => c.classList.remove("active"));
        card.classList.add("active");
        state.aspectRatio = card.getAttribute("data-aspect") || "9:16";
        updateMetrics();
      });
    });
  }

  function bindEngineTabs() {
    document.querySelectorAll("[data-engine]").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll("[data-engine]").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        state.engine = tab.getAttribute("data-engine") || "colab";
        $("vf-server-fields")?.classList.toggle("hidden", state.engine !== "server");
        $("vf-fal-fields")?.classList.toggle("hidden", state.engine !== "fal");
        $("vf-colab-note")?.classList.toggle("hidden", state.engine !== "colab");
        updateMetrics();
      });
    });
  }

  async function checkServerHealth() {
    try {
      const res = await fetch(sulphurUrl("/health"));
      const data = await res.json();
      const pill = $("vf-server-pill");
      if (pill) {
        const gpu = data.engine?.cuda ? "GPU OK" : "Sans GPU local";
        pill.textContent = `Serveur connecté · ${gpu}`;
        pill.classList.add("live");
      }
      return data;
    } catch {
      const pill = $("vf-server-pill");
      if (pill) {
        pill.textContent = "Serveur hors ligne";
        pill.classList.remove("live");
      }
      return null;
    }
  }

  function escapePythonTriple(text) {
    return String(text || "").replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"');
  }

  function buildColabSnippet() {
    const script = getScript();
    const firstLine = script.split("\n")[0]?.trim() || "Ma vidéo IA";
    return `# Collez dans la cellule Configuration du notebook Colab (Video Factory)
TOPIC = """${escapePythonTriple(firstLine)}"""
SCRIPT = """${escapePythonTriple(script)}"""
DURATION_MIN = ${getDurationMin()}
CLIP_SEC = ${getClipSec()}
ASPECT = "${state.aspectRatio}"
BATCH_COUNT = 1
FPS = 16
MISTRAL_API_KEY = "${getMistralKey().replace(/"/g, '\\"')}"
HF_TOKEN = ""
`;
  }

  function downloadColabConfig() {
    const snippet = buildColabSnippet();
    const blob = new Blob([snippet], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "colab-video-config.py";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function launchColab() {
    const script = getScript();
    if (!script) {
      toast("Collez votre script avant de lancer Colab.", "warn");
      return;
    }
    const snippet = buildColabSnippet();
    try {
      await navigator.clipboard.writeText(snippet);
      toast("Configuration copiée ! Collez-la dans la cellule Configuration du notebook Colab.", "info");
    } catch {
      downloadColabConfig();
      toast("Téléchargement de colab-video-config.py — copiez son contenu dans Colab.", "info");
    }
    log("Ouverture Google Colab…");
    log("1. GPU T4 activé  2. Coller la config  3. Tout exécuter  4. Télécharger final.mp4");
    global.open(COLAB_URL, "_blank", "noopener");
  }

  async function apiPost(path, body, headers = {}) {
    const res = await fetch(sulphurUrl(path), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers
      },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      throw new Error(data.error || data.message || text || res.statusText);
    }
    return data;
  }

  async function pollJob(jobId) {
    for (let i = 0; i < 7200; i += 1) {
      if (state.cancelRequested) throw new Error("Génération annulée");
      const res = await fetch(sulphurUrl(`/jobs/${encodeURIComponent(jobId)}`));
      const job = await res.json();
      setProgress(job.progress || 0, job.status || "…", `${job.scenesDone || 0}/${job.sceneCount || "?"}`);
      const lastLog = job.logs?.[job.logs.length - 1];
      if (lastLog?.message) log(lastLog.message);
      if (job.status === "completed") return job;
      if (job.status === "failed") throw new Error(job.error || "Échec génération");
      await new Promise((r) => setTimeout(r, 4000));
    }
    throw new Error("Timeout — la génération prend trop de temps");
  }

  async function runServerGeneration() {
    const script = getScript();
    if (!script) {
      toast("Collez votre script.", "warn");
      return;
    }

    const health = await checkServerHealth();
    if (!health) {
      toast("Serveur inaccessible. Lancez npm start ou utilisez le mode Colab.", "error");
      return;
    }
    if (!health.engine?.cuda && !health.engine?.ready) {
      toast(
        "Pas de GPU NVIDIA sur le serveur. Utilisez le mode Colab gratuit ou installez CUDA.",
        "warn"
      );
      return;
    }

    const mistralKey = getMistralKey();
    saveSettings({
      apiBase: getApiBase(),
      mistralKey
    });

    state.running = true;
    state.cancelRequested = false;
    $("vf-generate-btn").disabled = true;
    $("vf-cancel-btn").disabled = false;
    $("vf-result").classList.add("hidden");
    $("vf-log").innerHTML = "";

    try {
      setProgress(2, "Envoi au studio…", "");
      log("Création du job Sulphur…");

      const job = await apiPost(
        "/jobs/auto",
        {
          provider: "sulphur",
          script,
          durationMin: getDurationMin(),
          clipSec: getClipSec(),
          aspectRatio: state.aspectRatio,
          hfModel: "wan21lite",
          plannerMode: mistralKey ? "mistral" : "free",
          mistralKey: mistralKey || undefined
        },
        mistralKey ? { "x-mistral-key": mistralKey } : {}
      );

      state.jobId = job.id;
      log(`Job #${job.id} en file d'attente`);
      const finalJob = await pollJob(job.id);
      const url = `${getApiBase()}${finalJob.downloadUrl}`;
      setProgress(100, "Terminé", "MP4 prêt");
      const result = $("vf-result");
      result.classList.remove("hidden");
      result.innerHTML = `
        <strong>✓ Vidéo générée</strong><br>
        ${finalJob.title || "Votre vidéo"}<br>
        <a href="${url}" target="_blank" rel="noopener">⬇ Télécharger le MP4</a>
      `;
      toast("Vidéo prête !", "info");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`ERREUR : ${msg}`);
      toast(msg, "error");
      setProgress(0, "Erreur", msg);
    } finally {
      state.running = false;
      $("vf-generate-btn").disabled = false;
      $("vf-cancel-btn").disabled = true;
    }
  }

  async function runGeneration() {
    if (state.running) return;
    if (state.engine === "colab") {
      await launchColab();
      return;
    }
    if (state.engine === "server") {
      await runServerGeneration();
      return;
    }
    toast("Mode FAL cloud : utilisez VOANH /voanh pour l'instant.", "warn");
  }

  function restoreSettings() {
    const saved = loadSettings();
    if (saved.apiBase && $("vf-api-base")) $("vf-api-base").value = saved.apiBase;
    if (saved.mistralKey && $("vf-mistral-key")) $("vf-mistral-key").value = saved.mistralKey;
    if (saved.script && $("vf-script")) $("vf-script").value = saved.script;
  }

  function bindUi() {
    const isFile = global.location?.protocol === "file:";
    const banner = $("vf-file-banner");
    if (banner && isFile) {
      banner.classList.add("visible");
    }

    $("vf-duration")?.addEventListener("input", updateMetrics);
    $("vf-clip-sec")?.addEventListener("change", updateMetrics);
    $("vf-script")?.addEventListener("input", () => {
      saveSettings({ script: getScript() });
    });
    $("vf-api-base")?.addEventListener("change", () => {
      saveSettings({ apiBase: getApiBase() });
      checkServerHealth();
    });
    $("vf-mistral-key")?.addEventListener("change", () => {
      saveSettings({ mistralKey: getMistralKey() });
    });

    $("vf-generate-btn")?.addEventListener("click", runGeneration);
    $("vf-cancel-btn")?.addEventListener("click", () => {
      state.cancelRequested = true;
      log("Annulation demandée…");
    });
    $("vf-check-server")?.addEventListener("click", checkServerHealth);
    $("vf-download-colab")?.addEventListener("click", downloadColabConfig);

    bindFormatCards();
    bindEngineTabs();
    restoreSettings();
    updateMetrics();
    checkServerHealth();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindUi);
  } else {
    bindUi();
  }

  global.VideoFactory = { runGeneration, launchColab, checkServerHealth, downloadColabConfig };
})(window);
