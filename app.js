const runtimeConfig = typeof window.CLIPFORGE_CONFIG !== "undefined" ? window.CLIPFORGE_CONFIG : {};
const defaults = runtimeConfig.defaults || {};

const config = {
  apiBase: runtimeConfig.apiBase || "",
  pollIntervalMs: Number(runtimeConfig.pollIntervalMs) || 1200,
  sampleTranscript: runtimeConfig.sampleTranscript || "",
  defaultClipDuration: Number(defaults.clipDurationSec) || 30,
  defaultClipsCount: Number(defaults.clipsCount) || 4,
  defaultMinGapSec: Number(defaults.minGapSecBetweenClips) || 0,
  defaultIgnoreIntroSec: Number(defaults.ignoreIntroSec) || 0
};

const state = {
  backendAvailable: false,
  youtubeCookiesConfigured: false,
  youtubeCookiesUpdatedAt: "",
  quickMode: true,
  languageMode: "translate-to-french",
  noAddedAudio: false,
  localVideoFile: null,
  localVideoObjectUrl: "",
  localVideoDuration: 0,
  sourceVideoUrl: "",
  activeJobId: "",
  pollTimer: null,
  clips: [],
  selectedClipIndex: -1,
  subtitleTheme: "classic",
  highlightMode: "balanced",
  includeAutoTranscript: false,
  dubFrenchAudio: true,
  autoDubVoiceBySpeaker: true,
  includeSrtInZip: true,
  burnSubtitles: false,
  ignoreIntroSec: config.defaultIgnoreIntroSec,
  currentAspectRatio: "9:16"
};

const dom = {
  videoUrlInput: document.getElementById("videoUrlInput"),
  quickMode: document.getElementById("quickMode"),
  languageMode: document.getElementById("languageMode"),
  youtubeCookiesInput: document.getElementById("youtubeCookiesInput"),
  saveYoutubeCookiesBtn: document.getElementById("saveYoutubeCookiesBtn"),
  clearYoutubeCookiesBtn: document.getElementById("clearYoutubeCookiesBtn"),
  youtubeCookiesStatus: document.getElementById("youtubeCookiesStatus"),
  videoInput: document.getElementById("videoInput"),
  clipDuration: document.getElementById("clipDuration"),
  clipsCount: document.getElementById("clipsCount"),
  clipsCountValue: document.getElementById("clipsCountValue"),
  aspectRatio: document.getElementById("aspectRatio"),
  transcriptInput: document.getElementById("transcriptInput"),
  subtitleTheme: document.getElementById("subtitleTheme"),
  highlightMode: document.getElementById("highlightMode"),
  ignoreIntroSec: document.getElementById("ignoreIntroSec"),
  includeAutoTranscript: document.getElementById("includeAutoTranscript"),
  dubFrenchAudio: document.getElementById("dubFrenchAudio"),
  autoDubVoiceBySpeaker: document.getElementById("autoDubVoiceBySpeaker"),
  includeSrtInZip: document.getElementById("includeSrtInZip"),
  burnSubtitles: document.getElementById("burnSubtitles"),
  minGapSecBetweenClips: document.getElementById("minGapSecBetweenClips"),
  minGapValue: document.getElementById("minGapValue"),
  generateScriptBtn: document.getElementById("generateScriptBtn"),
  analyzeBtn: document.getElementById("analyzeBtn"),
  generationProgress: document.getElementById("generationProgress"),
  generationProgressText: document.getElementById("generationProgressText"),
  player: document.getElementById("player"),
  videoShell: document.querySelector(".video-shell"),
  subtitleOverlay: document.getElementById("subtitleOverlay"),
  clipsList: document.getElementById("clipsList"),
  statusBadge: document.getElementById("statusBadge"),
  playClipBtn: document.getElementById("playClipBtn"),
  exportClipBtn: document.getElementById("exportClipBtn"),
  downloadJsonBtn: document.getElementById("downloadJsonBtn"),
  downloadZipBtn: document.getElementById("downloadZipBtn"),
  downloadSrtBtn: document.getElementById("downloadSrtBtn"),
  backendMeta: document.getElementById("backendMeta"),
  selectedClipTitle: document.getElementById("selectedClipTitle"),
  selectedClipScore: document.getElementById("selectedClipScore"),
  selectedClipSummary: document.getElementById("selectedClipSummary")
};

function apiUrl(path) {
  return `${config.apiBase.trim()}${path}`;
}

function secondsToClock(value) {
  const sec = Math.max(0, Math.floor(value));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
  dom.downloadZipBtn.disabled = !enabled;
  dom.downloadSrtBtn.disabled = !enabled;
}

function setGenerationProgress(value) {
  const progress = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  if (dom.generationProgress) {
    dom.generationProgress.style.width = `${progress}%`;
  }
  if (dom.generationProgressText) {
    dom.generationProgressText.textContent = `Progression: ${progress}%`;
  }
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
  if (dom.selectedClipTitle) dom.selectedClipTitle.textContent = "Aucun clip sélectionné";
  if (dom.selectedClipScore) dom.selectedClipScore.textContent = "Virality score: --";
  if (dom.selectedClipSummary) dom.selectedClipSummary.textContent = "Le résumé transcript du clip apparaîtra ici.";
  setGenerationProgress(0);
}

function isNoAddedAudioSelected() {
  return state.noAddedAudio || state.languageMode === "no-added-audio";
}

function applySubtitleTheme(theme) {
  dom.subtitleOverlay.classList.remove("theme-classic", "theme-bold", "theme-cinema", "theme-neon");
  dom.subtitleOverlay.classList.add(`theme-${theme}`);
}

function applyPreviewAspectRatio(aspectRatio) {
  if (!dom.videoShell) return;
  const ratio = aspectRatio === "1:1" ? "1 / 1" : aspectRatio === "16:9" ? "16 / 9" : "9 / 16";
  dom.videoShell.style.aspectRatio = ratio;
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
    if (idx === state.selectedClipIndex) li.classList.add("active");

    const wordsCount = (clip.captions || []).map((c) => c.text).join(" ").split(/\s+/).filter(Boolean).length;
    const viralityScore = Math.max(1, Math.min(99, Math.round(Number(clip.score || 0) * 100)));
    const snippet = (clip.captions || [])
      .map((c) => c.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140);
    li.innerHTML = `
      <div class="clip-top">
        <h3 class="clip-title">${clip.title}</h3>
        <span class="chip">Virality ${viralityScore}/100</span>
      </div>
      <p class="clip-times">
        ${secondsToClock(clip.start)} → ${secondsToClock(clip.end)}
        (${Math.round(clip.duration)}s) · ${wordsCount} mots · ${clip.aspectRatio || "9:16"}
      </p>
      <p class="clip-snippet">${snippet || "Résumé transcript indisponible."}</p>
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
  if (clip.hasBurnedSubtitles) {
    dom.subtitleOverlay.innerHTML = "";
    dom.subtitleOverlay.style.display = "none";
    return;
  }
  dom.subtitleOverlay.style.display = "block";
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
  state.currentAspectRatio = clip.aspectRatio || state.currentAspectRatio;
  applyPreviewAspectRatio(state.currentAspectRatio);
  dom.player.pause();
  dom.player.src = apiUrl(clip.streamUrl);
  dom.player.currentTime = 0;
  dom.player.load();
  dom.subtitleOverlay.innerHTML = "";
  dom.subtitleOverlay.style.display = clip.hasBurnedSubtitles ? "none" : "block";
  if (dom.selectedClipTitle) dom.selectedClipTitle.textContent = clip.title;
  if (dom.selectedClipScore) {
    const viralityScore = Math.max(1, Math.min(99, Math.round(Number(clip.score || 0) * 100)));
    dom.selectedClipScore.textContent = `Virality score: ${viralityScore}/100 · ${clip.aspectRatio || state.currentAspectRatio}`;
  }
  if (dom.selectedClipSummary) {
    const summary =
      (clip.captions || [])
        .map((c) => c.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 220) || "Résumé transcript indisponible.";
    dom.selectedClipSummary.textContent = summary;
  }
  updateStatus(`Clip sélectionné: ${clip.title} (${secondsToClock(clip.start)} → ${secondsToClock(clip.end)})`, true);

  if (autoplay) dom.player.play().catch(() => {});
}

function triggerDownload(url, filenameHint = "") {
  const link = document.createElement("a");
  link.href = apiUrl(url);
  if (filenameHint) link.download = filenameHint;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function formatFrenchDate(isoDate) {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

function setYoutubeCookiesButtonsDisabled(disabled) {
  if (dom.saveYoutubeCookiesBtn) dom.saveYoutubeCookiesBtn.disabled = disabled;
  if (dom.clearYoutubeCookiesBtn) dom.clearYoutubeCookiesBtn.disabled = disabled;
}

function renderYoutubeCookiesStatus(meta = {}) {
  if (!dom.youtubeCookiesStatus) return;
  const configured = Boolean(meta.configured);
  const sizeBytes = Number(meta.sizeBytes || 0);
  const updatedAt = formatFrenchDate(meta.updatedAt || "");
  state.youtubeCookiesConfigured = configured;
  state.youtubeCookiesUpdatedAt = meta.updatedAt || "";

  if (configured) {
    const details = updatedAt ? ` · MAJ ${updatedAt}` : "";
    dom.youtubeCookiesStatus.textContent = `Cookies serveur: configurés (${sizeBytes} octets${details})`;
    dom.youtubeCookiesStatus.classList.remove("note-error");
    return;
  }

  dom.youtubeCookiesStatus.textContent = "Cookies serveur: non configurés";
  dom.youtubeCookiesStatus.classList.add("note-error");
}

async function refreshYoutubeCookiesStatus() {
  if (!state.backendAvailable) return;
  const response = await fetch(apiUrl("/api/youtube-cookies/status"));
  if (!response.ok) throw new Error("Impossible de lire le statut des cookies serveur");
  const meta = await response.json();
  renderYoutubeCookiesStatus(meta);
}

async function saveYoutubeCookies() {
  if (!state.backendAvailable) {
    updateStatus("Backend indisponible — lance: npm start", false);
    return;
  }
  const youtubeCookies = (dom.youtubeCookiesInput?.value || "").trim();
  if (!youtubeCookies) {
    updateStatus("Colle d'abord tes cookies YouTube avant de les enregistrer.", false);
    return;
  }

  setYoutubeCookiesButtonsDisabled(true);
  try {
    const response = await fetch(apiUrl("/api/youtube-cookies"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ youtubeCookies })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Impossible d'enregistrer les cookies YouTube");
    }
    renderYoutubeCookiesStatus(payload);
    if (dom.youtubeCookiesInput) dom.youtubeCookiesInput.value = "";
    updateStatus("Cookies YouTube enregistrés. Ils seront réutilisés automatiquement.", true);
  } catch (error) {
    updateStatus(error instanceof Error ? error.message : "Erreur lors de la sauvegarde des cookies", false);
  } finally {
    setYoutubeCookiesButtonsDisabled(false);
  }
}

async function clearYoutubeCookies() {
  if (!state.backendAvailable) {
    updateStatus("Backend indisponible — lance: npm start", false);
    return;
  }
  setYoutubeCookiesButtonsDisabled(true);
  try {
    const response = await fetch(apiUrl("/api/youtube-cookies"), { method: "DELETE" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Impossible de supprimer les cookies YouTube");
    }
    renderYoutubeCookiesStatus(payload);
    updateStatus("Cookies YouTube supprimés du serveur.", true);
  } catch (error) {
    updateStatus(error instanceof Error ? error.message : "Erreur lors de la suppression des cookies", false);
  } finally {
    setYoutubeCookiesButtonsDisabled(false);
  }
}

async function checkBackendHealth() {
  try {
    const [healthRes, cfgRes] = await Promise.all([
      fetch(apiUrl("/api/health")),
      fetch(apiUrl("/api/config"))
    ]);
    if (!healthRes.ok) throw new Error("health check failed");
    const payload = await healthRes.json();
    const serverConfig = cfgRes.ok ? await cfgRes.json() : null;
    state.backendAvailable = true;
    updateStatus("Backend prêt", true);
    if (serverConfig?.defaults) {
      const defaultsCfg = serverConfig.defaults;
      if (typeof defaultsCfg.clipDuration === "number") dom.clipDuration.value = String(defaultsCfg.clipDuration);
      if (typeof defaultsCfg.clipsCount === "number") {
        dom.clipsCount.value = String(defaultsCfg.clipsCount);
        dom.clipsCountValue.textContent = String(defaultsCfg.clipsCount);
      }
      if (typeof defaultsCfg.minGap === "number") {
        dom.minGapSecBetweenClips.value = String(defaultsCfg.minGap);
        dom.minGapValue.textContent = `${defaultsCfg.minGap}s`;
      }
      if (typeof defaultsCfg.ignoreIntroSec === "number" && dom.ignoreIntroSec) {
        state.ignoreIntroSec = defaultsCfg.ignoreIntroSec;
        dom.ignoreIntroSec.value = String(defaultsCfg.ignoreIntroSec);
      }
    }
    if (serverConfig?.youtubeCookies) {
      renderYoutubeCookiesStatus(serverConfig.youtubeCookies);
    } else {
      renderYoutubeCookiesStatus({
        configured: Boolean(payload.youtubeCookiesConfigured),
        sizeBytes: 0,
        updatedAt: null
      });
    }

    dom.backendMeta.textContent =
      `Queue: ${payload.queueMode} · Concurrency: ${payload.workerConcurrency} · ` +
      `Whisper: ${payload.whisperAvailable ? "oui" : "non"} · yt-dlp: ${payload.ytDlpAvailable ? "oui" : "non"} · ` +
      `TTS FR: ${payload.edgeTtsAvailable ? "oui" : "non"} · Cookies YouTube: ${state.youtubeCookiesConfigured ? "oui" : "non"}`;
    return;
  } catch (_error) {
    state.backendAvailable = false;
    updateStatus("Backend indisponible — lance: npm start", false);
    dom.backendMeta.textContent = "Aucune connexion backend";
    renderYoutubeCookiesStatus({ configured: false, sizeBytes: 0, updatedAt: null });
  }
}

async function createJob() {
  const rawVideoUrl = (dom.videoUrlInput.value || "").trim();
  const hasFile = Boolean(state.localVideoFile);
  const hasUrl = rawVideoUrl.length > 0;
  if (!hasFile && !hasUrl) {
    updateStatus("Ajoute un lien vidéo ou un fichier avant de générer.", false);
    return;
  }
  if (!state.backendAvailable) {
    updateStatus("Backend indisponible — lance: npm start", false);
    return;
  }

  const useQuickMode = Boolean(state.quickMode);
  const clipDuration = Number(dom.clipDuration.value);
  const clipsCount = Number(dom.clipsCount.value);
  const aspectRatio = dom.aspectRatio.value;
  const languageMode = dom.languageMode?.value || state.languageMode;
  state.languageMode = languageMode;
  state.noAddedAudio = languageMode === "no-added-audio";
  let includeAutoTranscript = state.includeAutoTranscript;
  let dubFrenchAudio = state.dubFrenchAudio;
  let autoDubVoiceBySpeaker = state.autoDubVoiceBySpeaker;
  let burnSubtitles = state.burnSubtitles;

  if (isNoAddedAudioSelected() || languageMode === "already-french") {
    dubFrenchAudio = false;
    autoDubVoiceBySpeaker = false;
  } else if (useQuickMode) {
    // Quick mode applies recommended defaults without overriding chosen duration.
    includeAutoTranscript = true;
    dubFrenchAudio = true;
    autoDubVoiceBySpeaker = true;
    burnSubtitles = false;
  }

  const body = new FormData();
  if (hasUrl) {
    body.append("videoUrl", rawVideoUrl);
  } else if (hasFile) {
    body.append("video", state.localVideoFile);
  }
  body.append("clipDuration", String(clipDuration));
  body.append("clipsCount", String(clipsCount));
  body.append("aspectRatio", aspectRatio);
  body.append("languageMode", languageMode);
  body.append("transcript", dom.transcriptInput.value.trim());
  body.append("subtitleTheme", state.subtitleTheme);
  body.append("highlightMode", state.highlightMode);
  body.append("includeAutoTranscript", String(includeAutoTranscript));
  body.append("dubFrenchAudio", String(dubFrenchAudio));
  body.append("autoDubVoiceBySpeaker", String(autoDubVoiceBySpeaker));
  body.append("includeSrtInZip", String(state.includeSrtInZip));
  body.append("burnSubtitles", String(burnSubtitles));
  body.append("minGapSecBetweenClips", String(Number(dom.minGapSecBetweenClips.value)));
  body.append("ignoreIntroSec", String(Number(dom.ignoreIntroSec?.value || state.ignoreIntroSec || 0)));
  const youtubeCookies = (dom.youtubeCookiesInput?.value || "").trim();
  if (youtubeCookies) {
    body.append("youtubeCookies", youtubeCookies);
  }

  dom.analyzeBtn.disabled = true;
  resetClipState();
  setGenerationProgress(5);
  updateStatus(hasUrl ? "Analyse du lien et création du job…" : "Upload et création du job…", false);

  try {
    const response = await fetch(apiUrl("/api/jobs"), { method: "POST", body });
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      throw new Error(details.error || "Impossible de créer le job");
    }
    const payload = await response.json();
    state.activeJobId = payload.id;
    updateStatus(`Job créé (${payload.id.slice(0, 8)}...), démarrage…`, false);
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
    if (!response.ok) throw new Error("Job introuvable");
    const job = await response.json();

    if (job.status === "queued") {
      setGenerationProgress(Math.max(8, Number(job.progress) || 0));
      updateStatus("Job en file d'attente…", false);
      scheduleJobPolling();
      return;
    }
    if (job.status === "processing") {
      setGenerationProgress(job.progress || 0);
      updateStatus(`Traitement en cours… ${job.progress || 0}%`, false);
      scheduleJobPolling();
      return;
    }
    if (job.status === "failed") {
      setGenerationProgress(100);
      updateStatus(job.error || "Traitement échoué", false);
      dom.analyzeBtn.disabled = false;
      return;
    }
    if (job.status === "completed") {
      setGenerationProgress(100);
      state.clips = job.clips || [];
      state.subtitleTheme = job.params?.subtitleTheme || state.subtitleTheme;
      state.burnSubtitles = Boolean(job.params?.burnSubtitles);
      state.dubFrenchAudio = Boolean(job.params?.dubFrenchAudio);
      state.autoDubVoiceBySpeaker = Boolean(job.params?.autoDubVoiceBySpeaker);
      state.ignoreIntroSec = Number(job.params?.ignoreIntroSec || state.ignoreIntroSec || 0);
      state.languageMode = job.params?.languageMode || state.languageMode;
      state.noAddedAudio = state.languageMode === "no-added-audio";
      state.currentAspectRatio = job.params?.aspectRatio || state.currentAspectRatio;
      dom.subtitleTheme.value = state.subtitleTheme;
      if (dom.burnSubtitles) dom.burnSubtitles.checked = state.burnSubtitles;
      if (dom.dubFrenchAudio) dom.dubFrenchAudio.checked = state.dubFrenchAudio;
      if (dom.autoDubVoiceBySpeaker) dom.autoDubVoiceBySpeaker.checked = state.autoDubVoiceBySpeaker;
      if (dom.ignoreIntroSec) dom.ignoreIntroSec.value = String(state.ignoreIntroSec);
      if (dom.languageMode) dom.languageMode.value = state.languageMode;
      applySubtitleTheme(state.subtitleTheme);
      applyPreviewAspectRatio(state.currentAspectRatio);

      renderClips();
      if (state.clips.length > 0) {
        setButtonsEnabled(true);
        selectClip(0, false);
      }
      dom.analyzeBtn.disabled = false;
      updateStatus(`${state.clips.length} shorts générés`, true);
      if (job.autoTranscriptUsed) {
        dom.backendMeta.textContent = `${dom.backendMeta.textContent} · transcription auto utilisée`;
      }
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

  dom.videoUrlInput.addEventListener("input", () => {
    state.sourceVideoUrl = dom.videoUrlInput.value.trim();
  });

  if (dom.youtubeCookiesInput) {
    dom.youtubeCookiesInput.addEventListener("input", () => {
      // keep latest value via DOM read in createJob
    });
  }
}

function initEvents() {
  dom.clipsCount.addEventListener("input", () => {
    dom.clipsCountValue.textContent = dom.clipsCount.value;
  });

  dom.minGapSecBetweenClips.addEventListener("input", () => {
    dom.minGapValue.textContent = `${dom.minGapSecBetweenClips.value}s`;
  });

  dom.subtitleTheme.addEventListener("change", () => {
    state.subtitleTheme = dom.subtitleTheme.value;
    applySubtitleTheme(state.subtitleTheme);
  });

  dom.highlightMode.addEventListener("change", () => {
    state.highlightMode = dom.highlightMode.value;
  });

  dom.aspectRatio.addEventListener("change", () => {
    state.currentAspectRatio = dom.aspectRatio.value;
    applyPreviewAspectRatio(state.currentAspectRatio);
  });

  if (dom.ignoreIntroSec) {
    dom.ignoreIntroSec.addEventListener("change", () => {
      state.ignoreIntroSec = Number(dom.ignoreIntroSec.value || 0);
    });
  }

  if (dom.quickMode) {
    dom.quickMode.addEventListener("change", () => {
      state.quickMode = dom.quickMode.checked;
    });
  }

  if (dom.languageMode) {
    dom.languageMode.addEventListener("change", () => {
      state.languageMode = dom.languageMode.value;
      state.noAddedAudio = state.languageMode === "no-added-audio";
      if (state.languageMode === "already-french" || isNoAddedAudioSelected()) {
        state.dubFrenchAudio = false;
        state.autoDubVoiceBySpeaker = false;
        if (dom.dubFrenchAudio) dom.dubFrenchAudio.checked = false;
        if (dom.autoDubVoiceBySpeaker) dom.autoDubVoiceBySpeaker.checked = false;
      }
    });
  }

  dom.includeAutoTranscript.addEventListener("change", () => {
    state.includeAutoTranscript = dom.includeAutoTranscript.checked;
  });

  if (dom.dubFrenchAudio) {
    dom.dubFrenchAudio.addEventListener("change", () => {
      state.dubFrenchAudio = dom.dubFrenchAudio.checked;
    });
  }

  if (dom.autoDubVoiceBySpeaker) {
    dom.autoDubVoiceBySpeaker.addEventListener("change", () => {
      state.autoDubVoiceBySpeaker = dom.autoDubVoiceBySpeaker.checked;
    });
  }

  dom.includeSrtInZip.addEventListener("change", () => {
    state.includeSrtInZip = dom.includeSrtInZip.checked;
  });

  dom.burnSubtitles.addEventListener("change", () => {
    state.burnSubtitles = dom.burnSubtitles.checked;
  });

  dom.generateScriptBtn.addEventListener("click", useSampleTranscript);
  dom.analyzeBtn.addEventListener("click", () => {
    void createJob();
  });
  if (dom.saveYoutubeCookiesBtn) {
    dom.saveYoutubeCookiesBtn.addEventListener("click", () => {
      void saveYoutubeCookies();
    });
  }
  if (dom.clearYoutubeCookiesBtn) {
    dom.clearYoutubeCookiesBtn.addEventListener("click", () => {
      void clearYoutubeCookies();
    });
  }

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

  dom.downloadZipBtn.addEventListener("click", () => {
    if (!state.activeJobId) return;
    triggerDownload(`/api/jobs/${state.activeJobId}/bundle`, `clipforge-bundle-${state.activeJobId}.zip`);
  });

  dom.downloadSrtBtn.addEventListener("click", () => {
    if (state.selectedClipIndex < 0 || !state.activeJobId) return;
    const clip = state.clips[state.selectedClipIndex];
    if (!clip) return;
    triggerDownload(`/api/jobs/${state.activeJobId}/clips/${clip.id}/srt`, `${clip.id}.srt`);
  });

  dom.player.addEventListener("timeupdate", updateSubtitleOverlay);
}

function initDefaults() {
  dom.clipDuration.value = String(config.defaultClipDuration);
  dom.clipsCount.value = String(config.defaultClipsCount);
  dom.clipsCountValue.textContent = String(config.defaultClipsCount);
  dom.minGapSecBetweenClips.value = String(config.defaultMinGapSec);
  dom.minGapValue.textContent = `${config.defaultMinGapSec}s`;
  state.ignoreIntroSec = config.defaultIgnoreIntroSec;
  if (dom.ignoreIntroSec) dom.ignoreIntroSec.value = String(state.ignoreIntroSec);
  dom.subtitleTheme.value = state.subtitleTheme;
  dom.highlightMode.value = state.highlightMode;
  if (dom.dubFrenchAudio) dom.dubFrenchAudio.checked = state.dubFrenchAudio;
  if (dom.autoDubVoiceBySpeaker) dom.autoDubVoiceBySpeaker.checked = state.autoDubVoiceBySpeaker;
  if (dom.quickMode) dom.quickMode.checked = state.quickMode;
  if (dom.languageMode) dom.languageMode.value = state.languageMode;
  applySubtitleTheme(state.subtitleTheme);
  applyPreviewAspectRatio(state.currentAspectRatio);
  setGenerationProgress(0);
}

async function init() {
  initDefaults();
  initEvents();
  initFileInput();
  setButtonsEnabled(false);
  await checkBackendHealth();
  if (state.backendAvailable) {
    try {
      await refreshYoutubeCookiesStatus();
    } catch (_error) {
      // ignore: status already derived from /api/config or /api/health
    }
  }
}

void init();
