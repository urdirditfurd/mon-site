const runtimeConfig = typeof window.CLIPFORGE_CONFIG !== "undefined" ? window.CLIPFORGE_CONFIG : {};
const defaults = runtimeConfig.defaults || {};

const config = {
  apiBase: runtimeConfig.apiBase || "",
  pollIntervalMs: Number(runtimeConfig.pollIntervalMs) || 1200,
  sampleTranscript: runtimeConfig.sampleTranscript || "",
  defaultClipDuration: Number(defaults.clipDurationSec) || 30,
  defaultClipsCount: Number(defaults.clipsCount) || 4,
  defaultMinGapSec: Number(defaults.minGapSecBetweenClips) || 4
};

const state = {
  backendAvailable: false,
  localVideoFile: null,
  localVideoObjectUrl: "",
  localVideoDuration: 0,
  activeJobId: "",
  pollTimer: null,
  clips: [],
  selectedClipIndex: -1
};

const dom = {
  videoInput: document.getElementById("videoInput"),
  clipDuration: document.getElementById("clipDuration"),
  clipsCount: document.getElementById("clipsCount"),
  clipsCountValue: document.getElementById("clipsCountValue"),
  aspectRatio: document.getElementById("aspectRatio"),
  transcriptInput: document.getElementById("transcriptInput"),
  generateScriptBtn: document.getElementById("generateScriptBtn"),
  analyzeBtn: document.getElementById("analyzeBtn"),
  player: document.getElementById("player"),
  subtitleOverlay: document.getElementById("subtitleOverlay"),
  clipsList: document.getElementById("clipsList"),
  statusBadge: document.getElementById("statusBadge"),
  playClipBtn: document.getElementById("playClipBtn"),
  exportClipBtn: document.getElementById("exportClipBtn"),
  downloadJsonBtn: document.getElementById("downloadJsonBtn")
};

function apiUrl(path) {
  const base = config.apiBase.trim();
  return `${base}${path}`;
}

function secondsToClock(value) {
  const sec = Math.max(0, Math.floor(value));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function updateStatus(text, ready = false) {
  dom.statusBadge.textContent = text;
  dom.statusBadge.classList.toggle("ready", ready);
}

function setButtonsEnabled(enabled) {
  dom.playClipBtn.disabled = !enabled;
  dom.exportClipBtn.disabled = !enabled;
  dom.downloadJsonBtn.disabled = !enabled;
}

function clearPolling() {
  if (state.pollTimer) {
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }
}

function resetClipState() {
  clearPolling();
  state.clips = [];
  state.selectedClipIndex = -1;
  setButtonsEnabled(false);
  renderClips();
  dom.subtitleOverlay.innerHTML = "Les sous-titres s’afficheront ici";
}

function renderClips() {
  dom.clipsList.innerHTML = "";
  if (!state.clips.length) {
    dom.clipsList.innerHTML = `<li class="empty">Aucun clip généré pour le moment.</li>`;
    return;
  }

  state.clips.forEach((clip, idx) => {
    const li = document.createElement("li");
    li.className = "clip-item";
    if (idx === state.selectedClipIndex) {
      li.classList.add("active");
    }
    li.innerHTML = `
      <div class="clip-top">
        <h3 class="clip-title">${clip.title}</h3>
        <span class="chip">Score ${clip.score}</span>
      </div>
      <p class="clip-times">${secondsToClock(clip.start)} → ${secondsToClock(clip.end)} (${Math.round(clip.duration)}s)</p>
      <div class="clip-actions">
        <button class="mini-btn" data-action="select">Sélectionner</button>
        <button class="mini-btn" data-action="play">Lire</button>
      </div>
    `;

    li.querySelector('[data-action="select"]').addEventListener("click", () => selectClip(idx, false));
    li.querySelector('[data-action="play"]').addEventListener("click", () => selectClip(idx, true));
    dom.clipsList.appendChild(li);
  });
}

function updateSubtitleOverlay() {
  if (state.selectedClipIndex < 0) {
    dom.subtitleOverlay.innerHTML = "Les sous-titres s’afficheront ici";
    return;
  }
  const clip = state.clips[state.selectedClipIndex];
  if (!clip) return;

  const t = dom.player.currentTime || 0;
  const cue = (clip.captions || []).find((item) => t >= item.start && t <= item.end);
  if (!cue) {
    dom.subtitleOverlay.innerHTML = "";
    return;
  }
  dom.subtitleOverlay.innerHTML = `<span>${cue.text}</span>`;
}

function selectClip(index, autoplay = false) {
  if (index < 0 || index >= state.clips.length) return;
  state.selectedClipIndex = index;
  renderClips();

  const clip = state.clips[index];
  dom.player.pause();
  dom.player.src = apiUrl(clip.streamUrl);
  dom.player.currentTime = 0;
  dom.player.load();
  dom.subtitleOverlay.innerHTML = "";
  updateStatus(`Clip sélectionné: ${clip.title} (${secondsToClock(clip.start)} → ${secondsToClock(clip.end)})`, true);

  if (autoplay) {
    dom.player.play().catch(() => {});
  }
}

function triggerDownload(url, filenameHint = "") {
  const link = document.createElement("a");
  link.href = apiUrl(url);
  if (filenameHint) {
    link.download = filenameHint;
  }
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function checkBackendHealth() {
  try {
    const response = await fetch(apiUrl("/api/health"));
    if (!response.ok) throw new Error("health check failed");
    state.backendAvailable = true;
    updateStatus("Backend prêt", true);
    return;
  } catch (_error) {
    state.backendAvailable = false;
    updateStatus("Backend indisponible — lance: npm start", false);
  }
}

async function createJob() {
  if (!state.localVideoFile) {
    updateStatus("Chargez une vidéo avant de générer.", false);
    return;
  }
  if (!state.backendAvailable) {
    updateStatus("Backend indisponible — lance: npm start", false);
    return;
  }

  const body = new FormData();
  body.append("video", state.localVideoFile);
  body.append("clipDuration", String(Number(dom.clipDuration.value)));
  body.append("clipsCount", String(Number(dom.clipsCount.value)));
  body.append("aspectRatio", dom.aspectRatio.value);
  body.append("transcript", dom.transcriptInput.value.trim());
  body.append("minGapSecBetweenClips", String(config.defaultMinGapSec));

  dom.analyzeBtn.disabled = true;
  resetClipState();
  updateStatus("Upload et création du job…", false);

  try {
    const response = await fetch(apiUrl("/api/jobs"), {
      method: "POST",
      body
    });
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      throw new Error(details.error || "Impossible de créer le job");
    }
    const payload = await response.json();
    state.activeJobId = payload.id;
    updateStatus(`Job créé (${payload.id.slice(0, 8)}...), en file d'attente`, false);
    scheduleJobPolling();
  } catch (error) {
    updateStatus(error instanceof Error ? error.message : "Erreur réseau", false);
    dom.analyzeBtn.disabled = false;
  }
}

function scheduleJobPolling() {
  clearPolling();
  state.pollTimer = setTimeout(() => {
    void pollJob();
  }, config.pollIntervalMs);
}

async function pollJob() {
  if (!state.activeJobId) return;
  try {
    const response = await fetch(apiUrl(`/api/jobs/${state.activeJobId}`));
    if (!response.ok) {
      throw new Error("Job introuvable");
    }
    const job = await response.json();

    if (job.status === "queued") {
      updateStatus("Job en file d'attente…", false);
      scheduleJobPolling();
      return;
    }

    if (job.status === "processing") {
      updateStatus(`Traitement en cours… ${job.progress || 0}%`, false);
      scheduleJobPolling();
      return;
    }

    if (job.status === "failed") {
      updateStatus(job.error || "Traitement échoué", false);
      dom.analyzeBtn.disabled = false;
      return;
    }

    if (job.status === "completed") {
      state.clips = job.clips || [];
      renderClips();
      if (state.clips.length > 0) {
        setButtonsEnabled(true);
        selectClip(0, false);
      }
      dom.analyzeBtn.disabled = false;
      updateStatus(`${state.clips.length} clips générés (audio conservé)`, true);
      return;
    }

    scheduleJobPolling();
  } catch (error) {
    updateStatus(error instanceof Error ? error.message : "Erreur polling", false);
    dom.analyzeBtn.disabled = false;
  }
}

function useSampleTranscript() {
  dom.transcriptInput.value = config.sampleTranscript;
}

function initFileInput() {
  dom.videoInput.addEventListener("change", () => {
    const file = dom.videoInput.files && dom.videoInput.files[0];
    if (!file) return;

    state.localVideoFile = file;
    state.activeJobId = "";
    resetClipState();

    if (state.localVideoObjectUrl) {
      URL.revokeObjectURL(state.localVideoObjectUrl);
    }
    state.localVideoObjectUrl = URL.createObjectURL(file);
    dom.player.src = state.localVideoObjectUrl;
    dom.player.load();

    dom.player.onloadedmetadata = () => {
      state.localVideoDuration = dom.player.duration || 0;
      updateStatus(`Vidéo locale prête (${secondsToClock(state.localVideoDuration)})`, true);
    };
  });
}

function initEvents() {
  dom.clipsCount.addEventListener("input", () => {
    dom.clipsCountValue.textContent = dom.clipsCount.value;
  });
  dom.generateScriptBtn.addEventListener("click", useSampleTranscript);
  dom.analyzeBtn.addEventListener("click", () => {
    void createJob();
  });

  dom.playClipBtn.addEventListener("click", () => {
    if (state.selectedClipIndex < 0) return;
    dom.player.currentTime = 0;
    dom.player.play().catch(() => {});
  });

  dom.exportClipBtn.addEventListener("click", () => {
    if (state.selectedClipIndex < 0) return;
    const clip = state.clips[state.selectedClipIndex];
    if (!clip) return;
    triggerDownload(clip.downloadUrl, `${clip.id}.mp4`);
  });

  dom.downloadJsonBtn.addEventListener("click", () => {
    if (!state.activeJobId) return;
    triggerDownload(`/api/jobs/${state.activeJobId}/plan`, `clipforge-plan-${state.activeJobId}.json`);
  });

  dom.player.addEventListener("timeupdate", updateSubtitleOverlay);
}

function initDefaults() {
  dom.clipDuration.value = String(config.defaultClipDuration);
  dom.clipsCount.value = String(config.defaultClipsCount);
  dom.clipsCountValue.textContent = String(config.defaultClipsCount);
}

async function init() {
  initDefaults();
  initEvents();
  initFileInput();
  setButtonsEnabled(false);
  await checkBackendHealth();
}

void init();
