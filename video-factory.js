/**
 * ClipForge Video Factory — génération interne automatique (sans Colab)
 */
(function initVideoFactory(global) {
  const COLAB_URL =
    "https://colab.research.google.com/github/urdirditfurd/mon-site/blob/main/colab/text-to-video-gratuit.ipynb";
  const FAL_MODEL_ECO = "fal-ai/kling-video/v1.6/standard/text-to-video";
  const STORAGE_KEY = "vf_settings_v1";

  const state = {
    aspectRatio: "9:16",
    engine: "auto",
    running: false,
    cancelRequested: false,
    jobId: null,
    lastLogCount: 0,
    serverHealth: null
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
    try {
      const shared = JSON.parse(localStorage.getItem("clipforge-ai-keys") || "{}");
      if (shared.mistralApiKey) return String(shared.mistralApiKey).trim();
    } catch {
      /* ignore */
    }
    return String($("vf-mistral-key")?.value || loadSettings().mistralKey || "").trim();
  }

  function getFalKey() {
    try {
      const shared = JSON.parse(localStorage.getItem("clipforge-ai-keys") || "{}");
      if (shared.falApiKey) return String(shared.falApiKey).trim();
    } catch {
      /* ignore */
    }
    return String($("vf-fal-key")?.value || loadSettings().falKey || "").trim();
  }

  function getWanPromptExtend() {
    const el = $("vf-wan-prompt-extend");
    if (!el) return loadSettings().wanPromptExtend !== false;
    return el.checked;
  }

  function updateWanExtendHint() {
    const hint = $("vf-wan-extend-hint");
    const row = $("vf-wan-extend-row");
    if (!hint || !row) return;
    const mistral = getMistralKey();
    const resolved = resolveProvider(state.serverHealth);
    const wanMode = resolved.provider === "sulphur";
    row.style.opacity = wanMode ? "1" : "0.55";
    if (!wanMode) {
      hint.textContent = "Actif uniquement pour Wan 2.1 local/Colab (moteur GPU ou CPU). Ignoré avec FAL cloud.";
    } else if (!mistral) {
      hint.textContent = "Ajoutez une clé Mistral gratuite pour activer l'enrichissement Wan 2.1.";
    } else if (getWanPromptExtend()) {
      hint.textContent = "Chaque scène sera enrichie style Wan officiel avant génération (0 €, ~1 appel Mistral/scène).";
    } else {
      hint.textContent = "Enrichissement désactivé — prompts visuels bruts envoyés à Wan.";
    }
  }

  function updateDurationLabel() {
    const min = getDurationMin();
    const clip = getClipSec();
    const scenes = Math.max(1, Math.ceil((min * 60) / clip));
    const label = $("vf-duration-label");
    const scenesEl = $("vf-scenes-estimate");
    if (label) {
      label.textContent = min < 1 ? `${Math.round(min * 60)} s` : `${min} min`;
    }
    if (scenesEl) scenesEl.textContent = String(scenes);
  }

  function engineLabel(engine, provider) {
    if (engine === "gpu") return "GPU local (0 €)";
    if (engine === "fal" || provider === "fal") return "Cloud FAL";
    if (engine === "auto") return "Automatique";
    return "Automatique";
  }

  function updateMetrics() {
    updateDurationLabel();
    const scenes = Math.max(1, Math.ceil((getDurationMin() * 60) / getClipSec()));
    const durLabel = $("vf-duration-label")?.textContent || "1 min";
    $("vf-metric-duration").textContent = durLabel;
    $("vf-metric-scenes").textContent = String(scenes);
    $("vf-metric-format").textContent = state.aspectRatio;
    const resolved = resolveProvider(state.serverHealth);
    $("vf-metric-engine").textContent = engineLabel(state.engine, resolved.provider);
    $("vf-metric-cost").textContent =
      resolved.provider === "fal" ? `~${(scenes * 0.08).toFixed(1)} €` : "0 €";
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
        state.engine = tab.getAttribute("data-engine") || "auto";
        $("vf-fal-fields")?.classList.toggle("hidden", state.engine === "gpu");
        updateMetrics();
        updateWanExtendHint();
      });
    });
  }

  function resolveProvider(health) {
    const falKey = getFalKey();
    const engine = state.engine;
    const snapdragon = Boolean(health?.snapdragon || health?.engine?.snapdragon);
    const scenes = Math.max(1, Math.ceil((getDurationMin() * 60) / getClipSec()));

    if (engine === "gpu") {
      if (!health?.engine?.cuda) {
        return {
          provider: null,
          error: snapdragon
            ? "Snapdragon X Elite : pas de GPU NVIDIA. Utilisez Automatique + clé FAL."
            : "GPU NVIDIA requis pour ce mode."
        };
      }
      return { provider: "sulphur", hfModel: "wan21lite", label: "GPU local" };
    }

    if (engine === "fal") {
      if (!falKey || falKey.length < 20) {
        return { provider: null, error: "Clé FAL.ai requise (fal.ai — crédits offerts à l'inscription)." };
      }
      return { provider: "fal", modelPath: FAL_MODEL_ECO, label: "Cloud FAL" };
    }

    // auto
    if (health?.engine?.cuda) {
      return { provider: "sulphur", hfModel: "wan21lite", label: "GPU détecté" };
    }

    if (snapdragon && falKey && falKey.length >= 20) {
      return {
        provider: "fal",
        modelPath: FAL_MODEL_ECO,
        label: "Snapdragon + FAL (rapide, recommandé)"
      };
    }

    if (snapdragon && health?.canGenerateLocal && health?.engine?.cpuGenerationAllowed) {
      if (getDurationMin() > 1.5 || scenes > 20) {
        return {
          provider: null,
          error:
            `Vidéo trop longue pour CPU ARM (${scenes} scènes). Sur Snapdragon : baissez à 1 min max, ` +
            "ou ajoutez une clé FAL gratuite pour génération rapide en interne."
        };
      }
      return {
        provider: "sulphur",
        hfModel: "wan21lite",
        label: "Snapdragon CPU — Wan 2.1 (0€, ~5-15 min/scène)"
      };
    }

    if (falKey && falKey.length >= 20) {
      return { provider: "fal", modelPath: FAL_MODEL_ECO, label: "Cloud FAL (sans GPU)" };
    }

    return {
      provider: null,
      error: snapdragon
        ? "Snapdragon X Elite détecté. Ajoutez une clé FAL (rapide, crédits gratuits) pour générer en interne, " +
          "ou réduisez la durée à ≤1 min pour le mode CPU gratuit Wan 2.1."
        : "Pas de GPU détecté. Ajoutez une clé FAL gratuite (fal.ai) ou lancez le serveur sur un PC avec GPU NVIDIA."
    };
  }

  async function checkServerHealth() {
    try {
      const res = await fetch(sulphurUrl("/health"));
      const data = await res.json();
      state.serverHealth = data;
      const pill = $("vf-server-pill");
      const statusEl = $("vf-auto-status");
      const resolved = resolveProvider(data);

      if (pill) {
        if (data.snapdragon) {
          pill.textContent = data.engine?.cuda
            ? "Snapdragon · GPU OK"
            : getFalKey().length >= 20
              ? "Snapdragon · FAL prêt"
              : "Snapdragon X Elite détecté";
        } else if (data.engine?.cuda) {
          pill.textContent = "Serveur · GPU NVIDIA OK";
        } else if (getFalKey().length >= 20) {
          pill.textContent = "Serveur · Cloud FAL prêt";
        } else {
          pill.textContent = "Serveur · ajoutez clé FAL";
        }
        pill.classList.add("live");
      }

      const snapCard = $("vf-snapdragon-card");
      if (snapCard) {
        snapCard.classList.toggle("hidden", !data.snapdragon);
      }

      if (statusEl) {
        if (data.snapdragon) {
          if (resolved.provider === "fal") {
            statusEl.textContent =
              "Snapdragon X Elite : génération rapide en interne via FAL cloud (recommandé). Votre NPU reste libre pour Cursor.";
          } else if (resolved.provider === "sulphur") {
            statusEl.textContent =
              "Snapdragon X Elite : mode 100 % gratuit CPU (Wan 2.1). Comptez ~5-15 min par scène — idéal pour vidéos courtes ≤1 min.";
          } else {
            statusEl.textContent = resolved.error || data.engine?.hint || "Configurez FAL ou réduisez la durée.";
          }
        } else if (resolved.provider === "sulphur") {
          statusEl.textContent =
            "Génération 100 % automatique en interne via GPU local. Cliquez sur Générer — aucune action Colab.";
        } else if (resolved.provider === "fal") {
          statusEl.textContent =
            "Génération automatique via le serveur + FAL.ai (cloud). Votre script, durée et format sont envoyés en interne.";
        } else {
          statusEl.textContent = resolved.error || "Configurez le serveur pour générer.";
        }
      }

      updateMetrics();
      updateWanExtendHint();
      return data;
    } catch {
      state.serverHealth = null;
      const pill = $("vf-server-pill");
      if (pill) {
        pill.textContent = "Serveur hors ligne — lancez npm start";
        pill.classList.remove("live");
      }
      const statusEl = $("vf-auto-status");
      if (statusEl) {
        statusEl.textContent =
          "Lancez le serveur : ouvrez un terminal dans le dossier mon-site, tapez npm start, puis recliquez Générer.";
      }
      updateMetrics();
      updateWanExtendHint();
      return null;
    }
  }

  async function apiPost(path, body, headers = {}) {
    const res = await fetch(sulphurUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
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
    state.lastLogCount = 0;
    for (let i = 0; i < 7200; i += 1) {
      if (state.cancelRequested) throw new Error("Génération annulée");
      const res = await fetch(sulphurUrl(`/jobs/${encodeURIComponent(jobId)}`));
      const job = await res.json();

      const statusLabels = {
        queued: "En file d'attente",
        planning: "Découpage du script…",
        generating: "Génération des scènes…",
        assembling: "Assemblage MP4…",
        completed: "Terminé",
        failed: "Échec"
      };
      setProgress(
        job.progress || 0,
        statusLabels[job.status] || job.status || "…",
        `${job.scenesDone || 0}/${job.sceneCount || "?"} scènes`
      );

      const logs = job.logs || [];
      for (let j = state.lastLogCount; j < logs.length; j += 1) {
        if (logs[j]?.message) log(logs[j].message);
      }
      state.lastLogCount = logs.length;

      if (job.status === "completed") return job;
      if (job.status === "failed") throw new Error(job.error || "Échec génération");
      await new Promise((r) => setTimeout(r, 3500));
    }
    throw new Error("Timeout — la génération prend trop de temps");
  }

  async function runInternalGeneration() {
    if (state.running) return;

    const script = getScript();
    if (!script) {
      toast("Collez votre script avant de générer.", "warn");
      return;
    }

    const health = await checkServerHealth();
    if (!health) {
      toast("Serveur inaccessible. Ouvrez un terminal : cd mon-site puis npm start", "error");
      log("ERREUR : impossible de joindre http://localhost:3000 — lancez npm start");
      return;
    }
    if (!health.ffmpegReady) {
      toast("FFmpeg manquant sur le serveur. Installez FFmpeg puis relancez npm start.", "error");
      return;
    }

    const resolved = resolveProvider(health);
    if (!resolved.provider) {
      toast(resolved.error || "Configuration insuffisante", "error");
      log(resolved.error || "Configuration insuffisante");
      return;
    }

    const mistralKey = getMistralKey();
    const falKey = getFalKey();
    saveSettings({
      apiBase: getApiBase(),
      mistralKey,
      falKey,
      script
    });
    try {
      localStorage.setItem(
        "clipforge-ai-keys",
        JSON.stringify({ mistralApiKey: mistralKey, falApiKey: falKey })
      );
    } catch {
      /* ignore */
    }

    state.running = true;
    state.cancelRequested = false;
    $("vf-generate-btn").disabled = true;
    $("vf-cancel-btn").disabled = false;
    $("vf-result").classList.add("hidden");
    $("vf-log").innerHTML = "";

    try {
      log(`Pipeline interne : ${resolved.label}`);
      log(`Script ${script.length} car. · ${getDurationMin()} min · ${state.aspectRatio}`);
      setProgress(2, "Envoi au studio…", resolved.label);

      const payload = {
        provider: resolved.provider,
        script,
        durationMin: getDurationMin(),
        clipSec: getClipSec(),
        aspectRatio: state.aspectRatio,
        plannerMode: mistralKey ? "mistral" : "free",
        mistralKey: mistralKey || undefined,
        falKey: resolved.provider === "fal" ? falKey : undefined,
        hfModel: resolved.hfModel || "wan21lite",
        modelPath: resolved.modelPath || FAL_MODEL_ECO,
        wanPromptExtend: getWanPromptExtend()
      };

      const headers = {};
      if (mistralKey) headers["x-mistral-key"] = mistralKey;
      if (falKey) headers["x-fal-key"] = falKey;

      const job = await apiPost("/jobs/auto", payload, headers);
      state.jobId = job.id;
      log(`Job #${job.id} créé — génération en arrière-plan`);

      const finalJob = await pollJob(job.id);
      const url = `${getApiBase()}${finalJob.downloadUrl}`;

      setProgress(100, "Terminé", "MP4 prêt");
      const result = $("vf-result");
      result.classList.remove("hidden");
      result.innerHTML = `
        <strong>✓ Vidéo générée automatiquement</strong><br>
        ${finalJob.title || "Votre vidéo"} · ${finalJob.scenesDone || "?"} scènes<br>
        <a href="${url}" target="_blank" rel="noopener">⬇ Télécharger le MP4</a>
        <br><video src="${url}" controls style="width:100%;max-height:320px;margin-top:12px;border-radius:10px"></video>
      `;
      toast("Vidéo prête — téléchargement disponible ci-dessous.", "info");
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

  function openColabFallback() {
    global.open(COLAB_URL, "_blank", "noopener");
    log("Colab ouvert en secours manuel uniquement.");
  }

  function restoreSettings() {
    const saved = loadSettings();
    try {
      const shared = JSON.parse(localStorage.getItem("clipforge-ai-keys") || "{}");
      if (shared.mistralApiKey && $("vf-mistral-key")) $("vf-mistral-key").value = shared.mistralApiKey;
      if (shared.falApiKey && $("vf-fal-key")) $("vf-fal-key").value = shared.falApiKey;
      if ($("vf-wan-prompt-extend") && shared.wanPromptExtend !== undefined) {
        $("vf-wan-prompt-extend").checked = shared.wanPromptExtend !== false;
      }
    } catch {
      /* ignore */
    }
    if (saved.apiBase && $("vf-api-base")) $("vf-api-base").value = saved.apiBase;
    if (saved.mistralKey && $("vf-mistral-key")) $("vf-mistral-key").value = saved.mistralKey;
    if (saved.falKey && $("vf-fal-key")) $("vf-fal-key").value = saved.falKey;
    if (saved.script && $("vf-script")) $("vf-script").value = saved.script;
    if ($("vf-wan-prompt-extend")) {
      $("vf-wan-prompt-extend").checked = saved.wanPromptExtend !== false;
    }
    if (saved.engine) {
      document.querySelector(`[data-engine="${saved.engine}"]`)?.click();
    }
    updateWanExtendHint();
  }

  function bindUi() {
    const isFile = global.location?.protocol === "file:";
    const banner = $("vf-file-banner");
    if (banner && isFile) banner.classList.add("visible");

    $("vf-duration")?.addEventListener("input", updateMetrics);
    $("vf-clip-sec")?.addEventListener("change", updateMetrics);
    $("vf-script")?.addEventListener("input", () => saveSettings({ script: getScript() }));
    $("vf-api-base")?.addEventListener("change", () => {
      saveSettings({ apiBase: getApiBase() });
      checkServerHealth();
    });
    $("vf-mistral-key")?.addEventListener("change", () => {
      saveSettings({ mistralKey: getMistralKey() });
      updateWanExtendHint();
      checkServerHealth();
    });
    $("vf-fal-key")?.addEventListener("change", () => {
      saveSettings({ falKey: getFalKey() });
      checkServerHealth();
    });
    $("vf-wan-prompt-extend")?.addEventListener("change", () => {
      saveSettings({ wanPromptExtend: getWanPromptExtend() });
      try {
        const shared = JSON.parse(localStorage.getItem("clipforge-ai-keys") || "{}");
        shared.wanPromptExtend = getWanPromptExtend();
        localStorage.setItem("clipforge-ai-keys", JSON.stringify(shared));
      } catch {
        /* ignore */
      }
      updateWanExtendHint();
    });

    $("vf-generate-btn")?.addEventListener("click", () => {
      saveSettings({ engine: state.engine });
      runInternalGeneration();
    });
    $("vf-cancel-btn")?.addEventListener("click", () => {
      state.cancelRequested = true;
      log("Annulation demandée…");
    });
    $("vf-check-server")?.addEventListener("click", checkServerHealth);
    $("vf-colab-fallback")?.addEventListener("click", openColabFallback);

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

  global.VideoFactory = { runInternalGeneration, checkServerHealth, openColabFallback };
})(window);
