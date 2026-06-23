(function () {
  "use strict";

  const STORAGE_KEY = "sulphur-studio-config-v1";

  const els = {
    health: document.getElementById("sulphurHealth"),
    model: document.getElementById("sulModel"),
    duration: document.getElementById("sulDuration"),
    aspect: document.getElementById("sulAspect"),
    concurrency: document.getElementById("sulConcurrency"),
    falKey: document.getElementById("sulFalKey"),
    replicateKey: document.getElementById("sulReplicateKey"),
    novitaKey: document.getElementById("sulNovitaKey"),
    hfToken: document.getElementById("sulHfToken"),
    prompt: document.getElementById("sulPrompt"),
    generateBtn: document.getElementById("sulGenerateBtn"),
    singleBar: document.getElementById("sulSingleBar"),
    singlePreview: document.getElementById("sulSinglePreview"),
    bulkPrompts: document.getElementById("sulBulkPrompts"),
    bulkBtn: document.getElementById("sulBulkBtn"),
    bulkBar: document.getElementById("sulBulkBar"),
    bulkSummary: document.getElementById("sulBulkSummary"),
    bulkClips: document.getElementById("sulBulkClips"),
    longTopic: document.getElementById("sulLongTopic"),
    longDuration: document.getElementById("sulLongDuration"),
    longScene: document.getElementById("sulLongScene"),
    longMistral: document.getElementById("sulLongMistral"),
    longBtn: document.getElementById("sulLongBtn"),
    longBar: document.getElementById("sulLongBar"),
    longSummary: document.getElementById("sulLongSummary"),
    longVideo: document.getElementById("sulLongVideo"),
    log: document.getElementById("sulLog")
  };

  const tabs = document.querySelectorAll(".sulphur-tab");
  const panels = document.querySelectorAll(".sulphur-panel");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      panels.forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      const target = document.querySelector(`.sulphur-panel[data-panel="${tab.dataset.tab}"]`);
      if (target) target.classList.add("active");
    });
  });

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  function saveConfig() {
    const cfg = {
      modelKey: els.model.value,
      duration: els.duration.value,
      aspect: els.aspect.value,
      concurrency: els.concurrency.value,
      falKey: els.falKey.value,
      replicateKey: els.replicateKey.value,
      novitaKey: els.novitaKey.value,
      hfToken: els.hfToken.value,
      mistralKey: els.longMistral.value
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    } catch {
      // ignore quota
    }
  }

  function appendLog(msg) {
    const time = new Date().toLocaleTimeString();
    const line = document.createElement("div");
    line.textContent = `[${time}] ${msg}`;
    els.log.appendChild(line);
    els.log.scrollTop = els.log.scrollHeight;
  }

  function buildHeaders(includeBody = false) {
    const headers = {};
    if (includeBody) headers["Content-Type"] = "application/json";
    const f = els.falKey.value.trim();
    const r = els.replicateKey.value.trim();
    const n = els.novitaKey.value.trim();
    const h = els.hfToken.value.trim();
    if (f) headers["x-fal-key"] = f;
    if (r) headers["x-replicate-key"] = r;
    if (n) headers["x-novita-key"] = n;
    if (h) headers["x-hf-token"] = h;
    return headers;
  }

  function commonBody(extra) {
    return Object.assign(
      {
        modelKey: els.model.value,
        durationSec: Number(els.duration.value) || undefined,
        aspectRatio: els.aspect.value,
        concurrency: Number(els.concurrency.value) || 2
      },
      extra || {}
    );
  }

  async function loadModels() {
    try {
      const res = await fetch("/api/sulphur/models");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      els.model.innerHTML = "";
      data.models.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m.key;
        opt.textContent = m.label + (m.hfModelId ? ` — ${m.hfModelId}` : "");
        if (m.key === data.defaultModel) opt.selected = true;
        els.model.appendChild(opt);
      });
      const cfg = loadConfig();
      if (cfg.modelKey) els.model.value = cfg.modelKey;
      if (cfg.duration) els.duration.value = cfg.duration;
      if (cfg.aspect) els.aspect.value = cfg.aspect;
      if (cfg.concurrency) els.concurrency.value = cfg.concurrency;
      if (cfg.falKey) els.falKey.value = cfg.falKey;
      if (cfg.replicateKey) els.replicateKey.value = cfg.replicateKey;
      if (cfg.novitaKey) els.novitaKey.value = cfg.novitaKey;
      if (cfg.hfToken) els.hfToken.value = cfg.hfToken;
      if (cfg.mistralKey) els.longMistral.value = cfg.mistralKey;
    } catch (error) {
      appendLog(`Erreur chargement modèles : ${error.message || error}`);
    }
  }

  async function checkHealth() {
    try {
      const res = await fetch("/api/sulphur/health");
      const data = await res.json();
      const local = data.localAvailable ? "local OK" : "cloud only";
      els.health.textContent = `prêt · ${local}`;
      els.health.style.background = "#064e3b";
      els.health.style.color = "#a7f3d0";
    } catch (error) {
      els.health.textContent = "indisponible";
      els.health.style.background = "#7f1d1d";
      els.health.style.color = "#fecaca";
    }
  }

  els.generateBtn.addEventListener("click", async () => {
    saveConfig();
    const prompt = els.prompt.value.trim();
    if (!prompt) return appendLog("Prompt vide.");
    els.generateBtn.disabled = true;
    els.singleBar.style.width = "10%";
    els.singlePreview.innerHTML = "";
    appendLog(`Single: génération en cours (${els.model.value})…`);
    try {
      const res = await fetch("/api/sulphur/generate", {
        method: "POST",
        headers: buildHeaders(true),
        body: JSON.stringify(commonBody({ prompt }))
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      els.singleBar.style.width = "100%";
      els.singlePreview.innerHTML = `
        <video controls style="width:100%;border-radius:10px;background:#000;" src="${data.streamUrl}"></video>
        <p style="font-size:12px;margin-top:6px;color:#94a3b8;">
          Provider <b>${data.provider}</b> · ${data.model} · ${data.size} octets ·
          <a style="color:#a5b4fc;" href="${data.downloadUrl}" download>Télécharger</a>
        </p>`;
      appendLog(`Single OK via ${data.provider}`);
    } catch (error) {
      appendLog(`Erreur single : ${error.message || error}`);
      els.singleBar.style.width = "0%";
    } finally {
      els.generateBtn.disabled = false;
    }
  });

  function renderBulkItems(job) {
    if (!job.items || !job.items.length) return;
    els.bulkClips.innerHTML = "";
    job.items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "sulphur-clip";
      const video = item.downloadUrl
        ? `<video controls preload="metadata" src="${item.downloadUrl}"></video>`
        : `<div style="width:120px;height:180px;display:flex;align-items:center;justify-content:center;background:#0b1220;border-radius:6px;color:#64748b;font-size:11px;">${item.status}</div>`;
      const link = item.downloadUrl
        ? `<a style="color:#a5b4fc;font-size:12px;" href="${item.downloadUrl}" download>Télécharger</a>`
        : `<span style="color:#fca5a5;font-size:12px;">${(item.error || "").slice(0, 120)}</span>`;
      row.innerHTML = `
        ${video}
        <div class="sulphur-clip-meta">
          <div class="prompt">#${item.index} — ${item.prompt}</div>
          <div class="meta">${item.status}${item.provider ? ` · ${item.provider}` : ""} · ${link}</div>
        </div>`;
      els.bulkClips.appendChild(row);
    });
  }

  async function pollJob(id, kind) {
    const path = `/api/sulphur/${kind}/${id}`;
    while (true) {
      await new Promise((r) => setTimeout(r, 2500));
      const res = await fetch(path);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const job = await res.json();
      if (kind === "bulk") {
        els.bulkBar.style.width = `${job.progress || 0}%`;
        els.bulkSummary.textContent = `${job.done || 0}/${job.total} · ${job.status}`;
        renderBulkItems(job);
      } else {
        els.longBar.style.width = `${job.progress || 0}%`;
        els.longSummary.textContent = `${job.title || ""} · ${job.done || 0}/${job.total || 0} scènes · ${job.status}`;
      }
      if (Array.isArray(job.logs)) {
        const lastLogs = job.logs.slice(-3);
        lastLogs.forEach((entry) => appendLog(entry.message));
      }
      if (job.status === "completed" || job.status === "failed") return job;
    }
  }

  els.bulkBtn.addEventListener("click", async () => {
    saveConfig();
    const text = els.bulkPrompts.value.trim();
    if (!text) return appendLog("Aucun prompt.");
    const prompts = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!prompts.length) return appendLog("Aucun prompt valide.");
    els.bulkBtn.disabled = true;
    els.bulkClips.innerHTML = "";
    els.bulkBar.style.width = "0%";
    els.bulkSummary.textContent = `0/${prompts.length} · démarrage`;
    appendLog(`Bulk: ${prompts.length} prompts en file…`);
    try {
      const res = await fetch("/api/sulphur/bulk", {
        method: "POST",
        headers: buildHeaders(true),
        body: JSON.stringify(commonBody({ prompts }))
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const final = await pollJob(data.id, "bulk");
      appendLog(`Bulk terminé : ${final.status}`);
    } catch (error) {
      appendLog(`Erreur bulk : ${error.message || error}`);
    } finally {
      els.bulkBtn.disabled = false;
    }
  });

  els.longBtn.addEventListener("click", async () => {
    saveConfig();
    const topic = els.longTopic.value.trim();
    if (!topic) return appendLog("Sujet vide.");
    els.longBtn.disabled = true;
    els.longBar.style.width = "0%";
    els.longVideo.style.display = "none";
    appendLog(`Long: génération sur "${topic}"…`);
    try {
      const res = await fetch("/api/sulphur/long", {
        method: "POST",
        headers: buildHeaders(true),
        body: JSON.stringify(commonBody({
          topic,
          durationSec: Number(els.longDuration.value),
          sceneSec: Number(els.longScene.value),
          mistralKey: els.longMistral.value.trim() || undefined
        }))
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const final = await pollJob(data.id, "long");
      if (final.status === "completed" && final.downloadUrl) {
        els.longVideo.src = final.downloadUrl;
        els.longVideo.style.display = "block";
        appendLog(`Long terminé : ${final.downloadUrl}`);
      } else {
        appendLog(`Long terminé : ${final.status} ${final.error || ""}`);
      }
    } catch (error) {
      appendLog(`Erreur long : ${error.message || error}`);
    } finally {
      els.longBtn.disabled = false;
    }
  });

  ["change", "input"].forEach((evt) => {
    [
      els.model, els.duration, els.aspect, els.concurrency,
      els.falKey, els.replicateKey, els.novitaKey, els.hfToken, els.longMistral
    ].forEach((el) => el && el.addEventListener(evt, saveConfig));
  });

  loadModels().then(checkHealth);
})();
