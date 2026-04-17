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
  youtubeApiAvailable: false,
  tiktokConfigured: false,
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
  frameMode: "full-video",
  includeAutoTranscript: false,
  dubFrenchAudio: true,
  autoDubVoiceBySpeaker: true,
  includeSrtInZip: true,
  burnSubtitles: false,
  ignoreIntroSec: config.defaultIgnoreIntroSec,
  currentAspectRatio: "9:16",
  batchRunning: false,
  batchStopRequested: false,
  batchJobs: [],
  discoverRunning: false,
  discoverResults: [],
  automationRunning: false,
  automationRunId: "",
  automationPollTimer: null,
  automationItems: [],
  automationScheduleEnabled: false
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
  frameMode: document.getElementById("frameMode"),
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
  discoverQuery: document.getElementById("discoverQuery"),
  discoverMaxResults: document.getElementById("discoverMaxResults"),
  discoverOrder: document.getElementById("discoverOrder"),
  discoverMinDurationSec: document.getElementById("discoverMinDurationSec"),
  discoverLanguage: document.getElementById("discoverLanguage"),
  discoverRegion: document.getElementById("discoverRegion"),
  discoverPublishedWithinDays: document.getElementById("discoverPublishedWithinDays"),
  discoverExcludeChannels: document.getElementById("discoverExcludeChannels"),
  discoverExcludeSeen: document.getElementById("discoverExcludeSeen"),
  discoverYoutubeBtn: document.getElementById("discoverYoutubeBtn"),
  useDiscoverResultsBtn: document.getElementById("useDiscoverResultsBtn"),
  discoverAndRunBatchBtn: document.getElementById("discoverAndRunBatchBtn"),
  discoverGeneratePublishBtn: document.getElementById("discoverGeneratePublishBtn"),
  discoverStatus: document.getElementById("discoverStatus"),
  discoverResultsList: document.getElementById("discoverResultsList"),
  automationStatus: document.getElementById("automationStatus"),
  automationItemsList: document.getElementById("automationItemsList"),
  tiktokAccessToken: document.getElementById("tiktokAccessToken"),
  tiktokOpenId: document.getElementById("tiktokOpenId"),
  tiktokPrivacy: document.getElementById("tiktokPrivacy"),
  tiktokHashtags: document.getElementById("tiktokHashtags"),
  saveTikTokConfigBtn: document.getElementById("saveTikTokConfigBtn"),
  clearTikTokConfigBtn: document.getElementById("clearTikTokConfigBtn"),
  tiktokConfigStatus: document.getElementById("tiktokConfigStatus"),
  automationIntervalMinutes: document.getElementById("automationIntervalMinutes"),
  automationBaseUrl: document.getElementById("automationBaseUrl"),
  saveAutomationScheduleBtn: document.getElementById("saveAutomationScheduleBtn"),
  disableAutomationScheduleBtn: document.getElementById("disableAutomationScheduleBtn"),
  runAutomationNowBtn: document.getElementById("runAutomationNowBtn"),
  automationScheduleStatus: document.getElementById("automationScheduleStatus"),
  batchVideoUrlsInput: document.getElementById("batchVideoUrlsInput"),
  batchClipsCount: document.getElementById("batchClipsCount"),
  batchIgnoreIntroSec: document.getElementById("batchIgnoreIntroSec"),
  startBatchBtn: document.getElementById("startBatchBtn"),
  stopBatchBtn: document.getElementById("stopBatchBtn"),
  batchStatus: document.getElementById("batchStatus"),
  batchJobsList: document.getElementById("batchJobsList"),
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
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

function setBatchStatus(message, isError = false) {
  if (!dom.batchStatus) return;
  dom.batchStatus.textContent = message;
  dom.batchStatus.classList.toggle("note-error", isError);
}

function setBatchControlsDisabled(isRunning) {
  state.batchRunning = isRunning;
  if (dom.startBatchBtn) dom.startBatchBtn.disabled = isRunning || !state.backendAvailable;
  if (dom.stopBatchBtn) dom.stopBatchBtn.disabled = !isRunning;
  setDiscoverControlsDisabled(state.discoverRunning);
}

function formatCompactNumber(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0";
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return String(Math.round(num));
}

function formatSecondsShort(totalSeconds) {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}`;
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, "0")}`;
  return `${seconds}s`;
}

function setDiscoverStatus(message, isError = false) {
  if (!dom.discoverStatus) return;
  dom.discoverStatus.textContent = message;
  dom.discoverStatus.classList.toggle("note-error", isError);
}

function setDiscoverControlsDisabled(disabled) {
  state.discoverRunning = disabled;
  const isEnabled = state.backendAvailable && state.youtubeApiAvailable;
  if (dom.discoverYoutubeBtn) dom.discoverYoutubeBtn.disabled = disabled || !isEnabled;
  if (dom.useDiscoverResultsBtn) dom.useDiscoverResultsBtn.disabled = disabled || !state.discoverResults.length;
  if (dom.discoverAndRunBatchBtn) {
    dom.discoverAndRunBatchBtn.disabled = disabled || !isEnabled || state.batchRunning;
  }
  if (dom.discoverGeneratePublishBtn) {
    dom.discoverGeneratePublishBtn.disabled = disabled || !isEnabled || state.batchRunning;
  }
}

function setAutomationControlsDisabled(disabled) {
  if (dom.saveTikTokConfigBtn) dom.saveTikTokConfigBtn.disabled = disabled || !state.backendAvailable;
  if (dom.clearTikTokConfigBtn) dom.clearTikTokConfigBtn.disabled = disabled || !state.backendAvailable;
  if (dom.saveAutomationScheduleBtn) dom.saveAutomationScheduleBtn.disabled = disabled || !state.backendAvailable;
  if (dom.disableAutomationScheduleBtn) {
    dom.disableAutomationScheduleBtn.disabled = disabled || !state.backendAvailable || !state.automationScheduleEnabled;
  }
  if (dom.runAutomationNowBtn) {
    dom.runAutomationNowBtn.disabled = disabled || !state.backendAvailable || !state.automationScheduleEnabled;
  }
}

function renderDiscoverResults() {
  if (!dom.discoverResultsList) return;
  if (!state.discoverResults.length) {
    dom.discoverResultsList.innerHTML = `<li class="empty">Aucune découverte pour le moment.</li>`;
    setDiscoverControlsDisabled(state.discoverRunning);
    return;
  }

  dom.discoverResultsList.innerHTML = state.discoverResults
    .map((item, idx) => {
      const duration = formatSecondsShort(item.durationSec);
      const views = formatCompactNumber(item.viewCount);
      const score = Math.round(Number(item.score || 0));
      const checked = item.selected ? "checked" : "";
      return `
        <li class="clip-item">
          <div class="clip-top">
            <h3 class="clip-title">#${idx + 1} · ${escapeHtml(item.channelTitle || "Chaîne inconnue")}</h3>
            <span class="chip">Score ${score}</span>
          </div>
          <label class="toggle-row compact discover-checkbox">
            <input type="checkbox" data-discover-id="${escapeHtml(item.videoId)}" ${checked}>
            <span>${escapeHtml(item.title || item.url)}</span>
          </label>
          <p class="clip-times">${duration} · ${views} vues · ${escapeHtml(item.publishedAt || "")}</p>
          <p class="clip-snippet">${escapeHtml(item.url)}</p>
        </li>
      `;
    })
    .join("");
  setDiscoverControlsDisabled(state.discoverRunning);
}

function getSelectedDiscoverUrls() {
  return state.discoverResults.filter((item) => item.selected).map((item) => item.url);
}

function pushSelectedDiscoverUrlsToBatch() {
  const selectedUrls = getSelectedDiscoverUrls();
  if (!selectedUrls.length) {
    setDiscoverStatus("Sélection vide: coche au moins un résultat V2.", true);
    return [];
  }
  if (dom.batchVideoUrlsInput) {
    dom.batchVideoUrlsInput.value = selectedUrls.join("\n");
  }
  setBatchStatus(`${selectedUrls.length} lien(s) injecté(s) depuis la découverte V2.`, false);
  setDiscoverStatus(`${selectedUrls.length} lien(s) envoyés vers le batch V1.`, false);
  return selectedUrls;
}

async function discoverYoutubeSources(autoRunBatch = false) {
  if (state.discoverRunning) return;
  if (!state.backendAvailable) {
    setDiscoverStatus("Backend indisponible — lance: npm start", true);
    return;
  }
  if (!state.youtubeApiAvailable) {
    setDiscoverStatus("YOUTUBE_API_KEY absente côté serveur. Configure la clé puis redémarre.", true);
    return;
  }

  const query = (dom.discoverQuery?.value || "").trim();
  if (!query) {
    setDiscoverStatus("Ajoute un mot-clé de niche pour la découverte V2.", true);
    return;
  }

  const params = new URLSearchParams({
    q: query,
    maxResults: String(Math.max(1, Math.min(25, Number(dom.discoverMaxResults?.value || 12)))),
    order: String(dom.discoverOrder?.value || "relevance"),
    minDurationSec: String(Math.max(0, Math.min(7200, Number(dom.discoverMinDurationSec?.value || 300)))),
    relevanceLanguage: String(dom.discoverLanguage?.value || ""),
    regionCode: String(dom.discoverRegion?.value || "FR"),
    publishedWithinDays: String(Math.max(0, Math.min(3650, Number(dom.discoverPublishedWithinDays?.value || 90)))),
    blockedChannelKeywords: String(dom.discoverExcludeChannels?.value || "").trim(),
    excludeSeen: String(Boolean(dom.discoverExcludeSeen?.checked))
  });

  setDiscoverControlsDisabled(true);
  setDiscoverStatus("Recherche YouTube V2 en cours…", false);

  try {
    const response = await fetch(apiUrl(`/api/youtube/discover?${params.toString()}`));
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Échec de la découverte YouTube V2.");
    }

    state.discoverResults = Array.isArray(payload.candidates)
      ? payload.candidates.map((candidate) => ({ ...candidate, selected: true }))
      : [];
    renderDiscoverResults();

    if (!state.discoverResults.length) {
      setDiscoverStatus("Aucun résultat trouvé. Ajuste la niche ou les filtres V2.", true);
      return;
    }

    const droppedByHistory = Number(payload?.stats?.droppedByHistory || 0);
    const droppedByChannel = Number(payload?.stats?.droppedByChannel || 0);
    const droppedByDuration = Number(payload?.stats?.droppedByDuration || 0);
    const skippedSummary = [];
    if (droppedByHistory > 0) skippedSummary.push(`${droppedByHistory} doublons historiques`);
    if (droppedByChannel > 0) skippedSummary.push(`${droppedByChannel} chaînes exclues`);
    if (droppedByDuration > 0) skippedSummary.push(`${droppedByDuration} trop courtes`);
    const skippedText = skippedSummary.length ? ` · filtrés: ${skippedSummary.join(", ")}` : "";
    setDiscoverStatus(`${state.discoverResults.length} lien(s) trouvés automatiquement${skippedText}.`, false);

    if (autoRunBatch) {
      pushSelectedDiscoverUrlsToBatch();
      if (state.batchRunning) {
        setDiscoverStatus("Batch déjà en cours: relance après la fin du batch actuel.", true);
        return;
      }
      await startBatchGeneration();
    }
  } catch (error) {
    setDiscoverStatus(error instanceof Error ? error.message : "Erreur découverte V2.", true);
  } finally {
    setDiscoverControlsDisabled(false);
  }
}

function setAutomationStatus(message, isError = false) {
  if (!dom.automationStatus) return;
  dom.automationStatus.textContent = message;
  dom.automationStatus.classList.toggle("note-error", isError);
}

function renderAutomationItems(items = []) {
  state.automationItems = Array.isArray(items) ? items : [];
  if (!dom.automationItemsList) return;
  if (!state.automationItems.length) {
    dom.automationItemsList.innerHTML = `<li class="empty">Aucune automatisation lancée.</li>`;
    return;
  }
  dom.automationItemsList.innerHTML = state.automationItems
    .map((item, idx) => {
      const status = escapeHtml(item.status || "inconnu");
      const sourceUrl = escapeHtml(item.sourceUrl || "");
      const jobId = escapeHtml(item.jobId || "");
      const publishedCount = Array.isArray(item.published)
        ? item.published.filter((pub) => pub.publishStatus === "published").length
        : 0;
      const generated = Number(item.generatedClips || 0);
      const err = escapeHtml(item.error || item.publishError || "");
      return `
        <li class="clip-item">
          <div class="clip-top">
            <h3 class="clip-title">Source auto #${idx + 1}</h3>
            <span class="chip">${status}</span>
          </div>
          <p class="clip-snippet">${sourceUrl}</p>
          <p class="clip-times">Job: ${jobId || "—"} · clips: ${generated} · publiés: ${publishedCount}</p>
          ${err ? `<p class="hint small note-error no-margin">${err}</p>` : ""}
        </li>
      `;
    })
    .join("");
}

function renderAutomationScheduleStatus(payload) {
  const enabled = Boolean(payload?.enabled);
  state.automationScheduleEnabled = enabled;
  if (dom.automationIntervalMinutes && payload?.intervalMinutes) {
    dom.automationIntervalMinutes.value = String(payload.intervalMinutes);
  }
  if (dom.automationBaseUrl && typeof payload?.payload?.baseUrl === "string") {
    dom.automationBaseUrl.value = String(payload.payload.baseUrl || "");
  }
  if (dom.automationScheduleStatus) {
    const pieces = [];
    pieces.push(enabled ? "Planification active" : "Planification inactive");
    if (payload?.intervalMinutes) pieces.push(`intervalle ${payload.intervalMinutes} min`);
    if (payload?.nextRunAt) pieces.push(`prochain run: ${new Date(payload.nextRunAt).toLocaleString()}`);
    if (payload?.lastRunAt) pieces.push(`dernier run: ${new Date(payload.lastRunAt).toLocaleString()}`);
    if (payload?.lastRunStatus) pieces.push(`statut dernier run: ${payload.lastRunStatus}`);
    if (payload?.lastError) pieces.push(`erreur: ${payload.lastError}`);
    dom.automationScheduleStatus.textContent = pieces.join(" · ");
    dom.automationScheduleStatus.classList.toggle("note-error", Boolean(payload?.lastError));
  }
  setAutomationControlsDisabled(false);
}

async function refreshTikTokConfigStatus() {
  if (!state.backendAvailable) {
    setAutomationStatus("Backend indisponible.", true);
    return;
  }
  try {
    const response = await fetch(apiUrl("/api/tiktok/config/status"));
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Impossible de lire la config TikTok.");
    }
    state.tiktokConfigured = Boolean(payload.configured);
    const configured = Boolean(payload.configured);
    const privacy = payload.defaultPrivacyLevel || "SELF_ONLY";
    const tags = String(payload.defaultHashtags || "");
    if (dom.tiktokPrivacy) dom.tiktokPrivacy.value = privacy;
    if (dom.tiktokHashtags) dom.tiktokHashtags.value = tags;
    if (dom.tiktokConfigStatus) {
      dom.tiktokConfigStatus.textContent = configured
        ? `Configuration TikTok active · privacy ${privacy}${tags ? ` · tags: ${tags}` : ""}`
        : "Configuration TikTok inactive.";
      dom.tiktokConfigStatus.classList.toggle("note-error", !configured);
    }
    if (configured) {
      setAutomationStatus(`TikTok configuré · privacy ${privacy}${tags ? ` · tags: ${tags}` : ""}`, false);
    } else {
      setAutomationStatus("TikTok non configuré: ajoute accessToken + openId.", true);
    }
  } catch (error) {
    setAutomationStatus(error instanceof Error ? error.message : "Erreur config TikTok.", true);
  }
}

async function saveTikTokConfigFromUi() {
  if (!state.backendAvailable) {
    setAutomationStatus("Backend indisponible.", true);
    return;
  }
  const accessToken = String(dom.tiktokAccessToken?.value || "").trim();
  const openId = String(dom.tiktokOpenId?.value || "").trim();
  const defaultPrivacyLevel = String(dom.tiktokPrivacy?.value || "SELF_ONLY").trim();
  const defaultHashtags = String(dom.tiktokHashtags?.value || "").trim();
  if (!accessToken || !openId) {
    setAutomationStatus("Access token TikTok + OpenID requis.", true);
    return;
  }
  if (dom.saveTikTokConfigBtn) dom.saveTikTokConfigBtn.disabled = true;
  try {
    const response = await fetch(apiUrl("/api/tiktok/config"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken, openId, defaultPrivacyLevel, defaultHashtags })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Impossible de sauvegarder la config TikTok.");
    }
    if (dom.tiktokAccessToken) dom.tiktokAccessToken.value = "";
    if (dom.tiktokOpenId) dom.tiktokOpenId.value = "";
    setAutomationStatus("Config TikTok enregistrée.", false);
    await refreshTikTokConfigStatus();
    await refreshAutomationScheduleStatus();
  } catch (error) {
    setAutomationStatus(error instanceof Error ? error.message : "Erreur sauvegarde TikTok.", true);
  } finally {
    if (dom.saveTikTokConfigBtn) dom.saveTikTokConfigBtn.disabled = false;
  }
}

async function clearTikTokConfigFromUi() {
  if (!state.backendAvailable) {
    setAutomationStatus("Backend indisponible.", true);
    return;
  }
  if (dom.clearTikTokConfigBtn) dom.clearTikTokConfigBtn.disabled = true;
  try {
    const response = await fetch(apiUrl("/api/tiktok/config"), { method: "DELETE" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Impossible de supprimer la config TikTok.");
    }
    setAutomationStatus("Config TikTok supprimée.", false);
    await refreshTikTokConfigStatus();
    await refreshAutomationScheduleStatus();
  } catch (error) {
    setAutomationStatus(error instanceof Error ? error.message : "Erreur suppression TikTok.", true);
  } finally {
    if (dom.clearTikTokConfigBtn) dom.clearTikTokConfigBtn.disabled = false;
  }
}

function buildAutomationRequestPayload() {
  return {
    q: String(dom.discoverQuery?.value || "").trim(),
    maxResults: Math.max(1, Math.min(25, Number(dom.discoverMaxResults?.value || 12))),
    order: String(dom.discoverOrder?.value || "relevance"),
    minDurationSec: Math.max(0, Math.min(7200, Number(dom.discoverMinDurationSec?.value || 300))),
    relevanceLanguage: String(dom.discoverLanguage?.value || ""),
    regionCode: String(dom.discoverRegion?.value || "FR"),
    publishedWithinDays: Math.max(0, Math.min(3650, Number(dom.discoverPublishedWithinDays?.value || 90))),
    blockedChannelKeywords: String(dom.discoverExcludeChannels?.value || "").trim(),
    excludeSeen: Boolean(dom.discoverExcludeSeen?.checked),
    clipDurationSec: 120,
    ignoreIntroSec: Math.max(0, Math.min(600, Number(dom.batchIgnoreIntroSec?.value || 20))),
    minGapSecBetweenClips: 6,
    hashtags: String(dom.tiktokHashtags?.value || "").trim(),
    defaultPrivacyLevel: String(dom.tiktokPrivacy?.value || "SELF_ONLY"),
    baseUrl: String(dom.automationBaseUrl?.value || "").trim() || window.location.origin
  };
}

async function refreshAutomationScheduleStatus() {
  if (!state.backendAvailable) {
    renderAutomationScheduleStatus({ enabled: false, lastError: "Backend indisponible." });
    return;
  }
  try {
    const response = await fetch(apiUrl("/api/automation/schedule/status"));
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Impossible de lire le statut de planification.");
    }
    renderAutomationScheduleStatus(payload);
  } catch (error) {
    renderAutomationScheduleStatus({
      enabled: false,
      lastError: error instanceof Error ? error.message : "Erreur statut planification."
    });
  }
}

async function saveAutomationScheduleFromUi() {
  if (!state.backendAvailable) {
    setAutomationStatus("Backend indisponible.", true);
    return;
  }
  const payload = buildAutomationRequestPayload();
  if (!payload.q) {
    setAutomationStatus("Ajoute une niche (champ découverte V2) avant d'activer l'auto-run.", true);
    return;
  }
  const intervalMinutes = Math.max(5, Math.min(1440, Number(dom.automationIntervalMinutes?.value || 120)));
  if (dom.saveAutomationScheduleBtn) dom.saveAutomationScheduleBtn.disabled = true;
  try {
    const response = await fetch(apiUrl("/api/automation/schedule"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        intervalMinutes,
        payload
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || "Impossible d'activer la planification.");
    }
    setAutomationStatus(`Auto-run activé toutes les ${intervalMinutes} min.`, false);
    renderAutomationScheduleStatus(result.schedule || {});
  } catch (error) {
    setAutomationStatus(error instanceof Error ? error.message : "Erreur activation auto-run.", true);
  } finally {
    if (dom.saveAutomationScheduleBtn) dom.saveAutomationScheduleBtn.disabled = false;
  }
}

async function disableAutomationScheduleFromUi() {
  if (!state.backendAvailable) {
    setAutomationStatus("Backend indisponible.", true);
    return;
  }
  if (dom.disableAutomationScheduleBtn) dom.disableAutomationScheduleBtn.disabled = true;
  try {
    const response = await fetch(apiUrl("/api/automation/schedule"), { method: "DELETE" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || "Impossible de désactiver la planification.");
    }
    setAutomationStatus("Auto-run désactivé.", false);
    renderAutomationScheduleStatus(result.schedule || {});
  } catch (error) {
    setAutomationStatus(error instanceof Error ? error.message : "Erreur désactivation auto-run.", true);
  } finally {
    if (dom.disableAutomationScheduleBtn) dom.disableAutomationScheduleBtn.disabled = false;
  }
}

async function runAutomationNowFromUi() {
  if (!state.backendAvailable) {
    setAutomationStatus("Backend indisponible.", true);
    return;
  }
  if (!state.automationScheduleEnabled) {
    setAutomationStatus("Active d'abord la planification pour utiliser “Lancer maintenant”.", true);
    return;
  }
  if (dom.runAutomationNowBtn) dom.runAutomationNowBtn.disabled = true;
  setAutomationStatus("Run immédiat déclenché…", false);
  try {
    const response = await fetch(apiUrl("/api/automation/schedule/run-now"), { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Impossible de lancer le run immédiat.");
    }
    const run = payload.run || {};
    renderAutomationItems(run.items || []);
    const published = Number(run.clipsPublished || 0);
    const failed = Number(run.publishFailed || 0);
    setAutomationStatus(`Run immédiat terminé · publiés: ${published} · échecs: ${failed}`, failed > 0);
    if (payload.schedule) {
      renderAutomationScheduleStatus(payload.schedule);
    } else {
      await refreshAutomationScheduleStatus();
    }
  } catch (error) {
    setAutomationStatus(error instanceof Error ? error.message : "Erreur run immédiat.", true);
  } finally {
    if (dom.runAutomationNowBtn) dom.runAutomationNowBtn.disabled = false;
  }
}

async function runFullAutomation() {
  if (state.discoverRunning || state.batchRunning) return;
  if (!state.backendAvailable) {
    setAutomationStatus("Backend indisponible.", true);
    return;
  }
  if (!state.youtubeApiAvailable) {
    setAutomationStatus("YOUTUBE_API_KEY absente côté serveur.", true);
    return;
  }
  const query = String(dom.discoverQuery?.value || "").trim();
  if (!query) {
    setAutomationStatus("Ajoute une niche dans le champ découverte V2.", true);
    return;
  }
  const requestPayload = buildAutomationRequestPayload();
  setDiscoverControlsDisabled(true);
  setAutomationControlsDisabled(true);
  setAutomationStatus("Automatisation complète en cours (découverte → génération → publication)…", false);
  try {
    const response = await fetch(apiUrl("/api/automation/discover-generate-publish"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Automatisation complète échouée.");
    }
    const run = payload?.id ? payload : payload.run || {};
    const published = Number(run.clipsPublished || 0);
    const failed = Number(run.publishFailed || 0);
    setAutomationStatus(`Auto-publish terminé · publiés: ${published} · échecs: ${failed}`, failed > 0);
    renderAutomationItems(run.items || []);
    if (Array.isArray(run.items) && run.items.length > 0) {
      const lastDone = run.items
        .slice()
        .reverse()
        .find((item) => item.jobId && item.status === "published");
      if (lastDone?.jobId) {
        await loadJobIntoWorkspace(lastDone.jobId);
      }
    }
  } catch (error) {
    setAutomationStatus(error instanceof Error ? error.message : "Erreur auto-publish.", true);
  } finally {
    setDiscoverControlsDisabled(false);
    setAutomationControlsDisabled(false);
    await refreshAutomationScheduleStatus();
  }
}

function parseBatchUrls(rawText) {
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const seen = new Set();
  const urls = [];
  for (const line of lines) {
    let parsed;
    try {
      parsed = new URL(line);
    } catch (_error) {
      throw new Error(`Lien invalide dans le batch: ${line}`);
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`Lien non supporté (http/https requis): ${line}`);
    }
    const normalized = parsed.toString();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
  }
  return urls;
}

function renderBatchJobs() {
  if (!dom.batchJobsList) return;
  if (!state.batchJobs.length) {
    dom.batchJobsList.innerHTML = `<li class="empty">Aucun batch lancé.</li>`;
    return;
  }

  dom.batchJobsList.innerHTML = state.batchJobs
    .map((item, idx) => {
      const progress =
        item.status === "processing" || item.status === "queued"
          ? ` · ${Math.max(0, Math.min(100, Number(item.progress) || 0))}%`
          : "";
      const clipsLabel = item.clipsCount ? ` · clips: ${item.clipsCount}` : "";
      const errorLabel = item.error ? `<p class="hint small note-error no-margin">${escapeHtml(item.error)}</p>` : "";
      const actions = item.jobId
        ? `
          <div class="clip-actions">
            <button class="mini-btn" data-action="open-job" data-job-id="${item.jobId}">Ouvrir</button>
            ${
              item.status === "completed"
                ? `<button class="mini-btn" data-action="download-bundle" data-job-id="${item.jobId}">ZIP</button>`
                : ""
            }
          </div>
        `
        : "";
      return `
        <li class="clip-item">
          <div class="clip-top">
            <h3 class="clip-title">Source ${idx + 1}</h3>
            <span class="chip">${escapeHtml(item.status)}${progress}${clipsLabel}</span>
          </div>
          <p class="clip-snippet">${escapeHtml(item.sourceUrl)}</p>
          ${actions}
          ${errorLabel}
        </li>
      `;
    })
    .join("");
}

async function createBatchJobFromUrl(sourceUrl, clipsCount, ignoreIntroSec) {
  const body = new FormData();
  body.append("videoUrl", sourceUrl);
  body.append("clipDuration", "120");
  body.append("clipsCount", String(clipsCount));
  body.append("aspectRatio", "9:16");
  body.append("frameMode", "full-video");
  body.append("languageMode", "no-added-audio");
  body.append("transcript", "");
  body.append("subtitleTheme", "classic");
  body.append("highlightMode", "viral");
  body.append("includeAutoTranscript", "false");
  body.append("dubFrenchAudio", "false");
  body.append("autoDubVoiceBySpeaker", "false");
  body.append("includeSrtInZip", "false");
  body.append("burnSubtitles", "false");
  body.append("minGapSecBetweenClips", "6");
  body.append("ignoreIntroSec", String(ignoreIntroSec));

  const youtubeCookies = (dom.youtubeCookiesInput?.value || "").trim();
  if (youtubeCookies) {
    body.append("youtubeCookies", youtubeCookies);
  }

  const response = await fetch(apiUrl("/api/jobs"), { method: "POST", body });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Impossible de créer le job batch");
  }
  return payload;
}

async function pollJobUntilDone(jobId, onUpdate) {
  while (true) {
    const response = await fetch(apiUrl(`/api/jobs/${jobId}`));
    if (!response.ok) {
      throw new Error(`Job ${jobId.slice(0, 8)} introuvable`);
    }
    const job = await response.json();
    if (typeof onUpdate === "function") onUpdate(job);
    if (job.status === "completed" || job.status === "failed") {
      return job;
    }
    await sleep(config.pollIntervalMs);
  }
}

async function loadJobIntoWorkspace(jobId) {
  const response = await fetch(apiUrl(`/api/jobs/${jobId}`));
  if (!response.ok) throw new Error("Impossible de charger ce job");
  const job = await response.json();
  if (job.status !== "completed") {
    throw new Error("Le job n'est pas encore terminé");
  }
  state.activeJobId = job.id;
  applyCompletedJob(job, `Job ${job.id.slice(0, 8)} chargé`);
}

async function startBatchGeneration() {
  if (state.batchRunning) return;
  if (!state.backendAvailable) {
    updateStatus("Backend indisponible — lance: npm start", false);
    return;
  }
  if (state.batchRunning) {
    updateStatus("Le batch est en cours. Attends la fin avant une génération unitaire.", false);
    return;
  }

  let sources = [];
  try {
    sources = parseBatchUrls(dom.batchVideoUrlsInput?.value || "");
  } catch (error) {
    setBatchStatus(error instanceof Error ? error.message : "Batch invalide.", true);
    return;
  }
  if (!sources.length) {
    setBatchStatus("Ajoute au moins un lien vidéo dans la zone batch.", true);
    return;
  }

  const clipsCount = Math.max(1, Math.min(8, Number(dom.batchClipsCount?.value || 4)));
  const ignoreIntroSec = Math.max(0, Math.min(120, Number(dom.batchIgnoreIntroSec?.value || 20)));

  state.batchStopRequested = false;
  state.batchJobs = sources.map((sourceUrl) => ({
    sourceUrl,
    status: "queued",
    progress: 0,
    clipsCount: 0,
    jobId: "",
    error: ""
  }));
  renderBatchJobs();
  setBatchControlsDisabled(true);
  updateStatus("Batch V1 lancé…", false);
  setBatchStatus(`Batch démarré (${sources.length} sources).`, false);

  let completedCount = 0;
  let failedCount = 0;
  let stoppedCount = 0;
  let lastCompletedJob = null;

  for (let index = 0; index < state.batchJobs.length; index += 1) {
    if (state.batchStopRequested) break;

    const item = state.batchJobs[index];
    item.status = "creating";
    item.progress = 0;
    renderBatchJobs();
    setBatchStatus(`Création du job ${index + 1}/${state.batchJobs.length}…`, false);

    try {
      const created = await createBatchJobFromUrl(item.sourceUrl, clipsCount, ignoreIntroSec);
      item.jobId = created.id;
      item.status = "queued";
      renderBatchJobs();

      const finalJob = await pollJobUntilDone(created.id, (job) => {
        item.status = job.status;
        item.progress = Number(job.progress) || 0;
        renderBatchJobs();
      });

      if (finalJob.status === "completed") {
        item.status = "completed";
        item.progress = 100;
        item.clipsCount = (finalJob.clips || []).length;
        completedCount += 1;
        lastCompletedJob = finalJob;
      } else {
        item.status = "failed";
        item.error = finalJob.error || "Traitement échoué";
        failedCount += 1;
      }
    } catch (error) {
      item.status = "failed";
      item.error = error instanceof Error ? error.message : "Erreur batch";
      failedCount += 1;
    }

    renderBatchJobs();
    if (state.batchStopRequested) break;
  }

  if (state.batchStopRequested) {
    for (const item of state.batchJobs) {
      if (item.status === "queued") {
        item.status = "stopped";
        stoppedCount += 1;
      }
    }
  }

  renderBatchJobs();
  setBatchControlsDisabled(false);
  state.batchStopRequested = false;
  const summary = `Batch terminé · OK: ${completedCount} · Erreurs: ${failedCount} · Arrêtés: ${stoppedCount}`;
  setBatchStatus(summary, failedCount > 0);
  updateStatus(summary, failedCount === 0);

  if (lastCompletedJob) {
    state.activeJobId = lastCompletedJob.id;
    applyCompletedJob(lastCompletedJob, `${summary} · dernier job chargé`);
  }
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
    state.youtubeApiAvailable = Boolean(
      serverConfig?.capabilities?.youtubeDiscovery ?? payload.youtubeApiAvailable ?? false
    );
    setBatchControlsDisabled(state.batchRunning);
    setDiscoverControlsDisabled(state.discoverRunning);
    setAutomationControlsDisabled(false);
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
      if (typeof defaultsCfg.frameMode === "string" && dom.frameMode) {
        state.frameMode = defaultsCfg.frameMode;
        dom.frameMode.value = defaultsCfg.frameMode;
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
      `TTS FR: ${payload.edgeTtsAvailable ? "oui" : "non"} · Cookies YouTube: ${state.youtubeCookiesConfigured ? "oui" : "non"} · API YouTube: ${state.youtubeApiAvailable ? "oui" : "non"}`;
    return;
  } catch (_error) {
    state.backendAvailable = false;
    state.youtubeApiAvailable = false;
    setBatchControlsDisabled(false);
    setDiscoverControlsDisabled(false);
    setAutomationControlsDisabled(true);
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
  const frameMode = dom.frameMode?.value || state.frameMode;
  state.frameMode = frameMode;
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
  body.append("frameMode", frameMode);
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

function applyCompletedJob(job, readyStatusText = "") {
  setGenerationProgress(100);
  state.clips = job.clips || [];
  state.subtitleTheme = job.params?.subtitleTheme || state.subtitleTheme;
  state.burnSubtitles = Boolean(job.params?.burnSubtitles);
  state.dubFrenchAudio = Boolean(job.params?.dubFrenchAudio);
  state.autoDubVoiceBySpeaker = Boolean(job.params?.autoDubVoiceBySpeaker);
  state.ignoreIntroSec = Number(job.params?.ignoreIntroSec || state.ignoreIntroSec || 0);
  state.languageMode = job.params?.languageMode || state.languageMode;
  state.frameMode = job.params?.frameMode || state.frameMode;
  state.noAddedAudio = state.languageMode === "no-added-audio";
  state.currentAspectRatio = job.params?.aspectRatio || state.currentAspectRatio;
  dom.subtitleTheme.value = state.subtitleTheme;
  if (dom.burnSubtitles) dom.burnSubtitles.checked = state.burnSubtitles;
  if (dom.dubFrenchAudio) dom.dubFrenchAudio.checked = state.dubFrenchAudio;
  if (dom.autoDubVoiceBySpeaker) dom.autoDubVoiceBySpeaker.checked = state.autoDubVoiceBySpeaker;
  if (dom.ignoreIntroSec) dom.ignoreIntroSec.value = String(state.ignoreIntroSec);
  if (dom.languageMode) dom.languageMode.value = state.languageMode;
  if (dom.frameMode) dom.frameMode.value = state.frameMode;
  applySubtitleTheme(state.subtitleTheme);
  applyPreviewAspectRatio(state.currentAspectRatio);

  renderClips();
  if (state.clips.length > 0) {
    setButtonsEnabled(true);
    selectClip(0, false);
  }
  dom.analyzeBtn.disabled = false;
  updateStatus(readyStatusText || `${state.clips.length} shorts générés`, true);
  if (job.autoTranscriptUsed && dom.backendMeta && !dom.backendMeta.textContent.includes("transcription auto utilisée")) {
    dom.backendMeta.textContent = `${dom.backendMeta.textContent} · transcription auto utilisée`;
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
      applyCompletedJob(job);
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

  if (dom.frameMode) {
    dom.frameMode.addEventListener("change", () => {
      state.frameMode = dom.frameMode.value;
    });
  }

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
  if (dom.discoverYoutubeBtn) {
    dom.discoverYoutubeBtn.addEventListener("click", () => {
      void discoverYoutubeSources(false);
    });
  }
  if (dom.useDiscoverResultsBtn) {
    dom.useDiscoverResultsBtn.addEventListener("click", () => {
      pushSelectedDiscoverUrlsToBatch();
    });
  }
  if (dom.discoverAndRunBatchBtn) {
    dom.discoverAndRunBatchBtn.addEventListener("click", () => {
      void discoverYoutubeSources(true);
    });
  }
  if (dom.discoverGeneratePublishBtn) {
    dom.discoverGeneratePublishBtn.addEventListener("click", () => {
      void runFullAutomation();
    });
  }
  if (dom.discoverResultsList) {
    dom.discoverResultsList.addEventListener("change", (event) => {
      const target = event.target instanceof HTMLInputElement ? event.target : null;
      if (!target || target.type !== "checkbox") return;
      const videoId = target.getAttribute("data-discover-id");
      if (!videoId) return;
      const item = state.discoverResults.find((entry) => entry.videoId === videoId);
      if (!item) return;
      item.selected = target.checked;
      setDiscoverControlsDisabled(state.discoverRunning);
    });
  }
  if (dom.startBatchBtn) {
    dom.startBatchBtn.addEventListener("click", () => {
      void startBatchGeneration();
    });
  }
  if (dom.stopBatchBtn) {
    dom.stopBatchBtn.addEventListener("click", () => {
      state.batchStopRequested = true;
      setBatchStatus("Arrêt demandé: fin de la vidéo en cours puis stop.", false);
    });
  }
  if (dom.batchJobsList) {
    dom.batchJobsList.addEventListener("click", (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target) return;
      const button = target.closest("button[data-action]");
      if (!button) return;
      const action = button.getAttribute("data-action");
      const jobId = button.getAttribute("data-job-id");
      if (!jobId) return;
      if (action === "open-job") {
        void loadJobIntoWorkspace(jobId).catch((error) => {
          updateStatus(error instanceof Error ? error.message : "Impossible de charger ce job", false);
        });
      }
      if (action === "download-bundle") {
        triggerDownload(`/api/jobs/${jobId}/bundle`, `clipforge-bundle-${jobId}.zip`);
      }
    });
  }
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
  if (dom.saveTikTokConfigBtn) {
    dom.saveTikTokConfigBtn.addEventListener("click", () => {
      void saveTikTokConfigFromUi();
    });
  }
  if (dom.clearTikTokConfigBtn) {
    dom.clearTikTokConfigBtn.addEventListener("click", () => {
      void clearTikTokConfigFromUi();
    });
  }
  if (dom.saveAutomationScheduleBtn) {
    dom.saveAutomationScheduleBtn.addEventListener("click", () => {
      void saveAutomationScheduleFromUi();
    });
  }
  if (dom.disableAutomationScheduleBtn) {
    dom.disableAutomationScheduleBtn.addEventListener("click", () => {
      void disableAutomationScheduleFromUi();
    });
  }
  if (dom.runAutomationNowBtn) {
    dom.runAutomationNowBtn.addEventListener("click", () => {
      void runAutomationNowFromUi();
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
  if (dom.frameMode) dom.frameMode.value = state.frameMode;
  if (dom.dubFrenchAudio) dom.dubFrenchAudio.checked = state.dubFrenchAudio;
  if (dom.autoDubVoiceBySpeaker) dom.autoDubVoiceBySpeaker.checked = state.autoDubVoiceBySpeaker;
  if (dom.quickMode) dom.quickMode.checked = state.quickMode;
  if (dom.languageMode) dom.languageMode.value = state.languageMode;
  applySubtitleTheme(state.subtitleTheme);
  applyPreviewAspectRatio(state.currentAspectRatio);
  renderDiscoverResults();
  setDiscoverStatus("Découverte V2 inactive.", false);
  setAutomationStatus("TikTok auto-publish inactif.", false);
  renderAutomationItems([]);
  renderAutomationScheduleStatus({ enabled: false });
  setAutomationControlsDisabled(false);
  setDiscoverControlsDisabled(false);
  renderBatchJobs();
  setBatchStatus("Batch inactif.", false);
  setBatchControlsDisabled(false);
  setGenerationProgress(0);
}

async function init() {
  initDefaults();
  initEvents();
  initFileInput();
  setButtonsEnabled(false);
  renderDiscoverResults();
  setDiscoverControlsDisabled(false);
  setAutomationControlsDisabled(false);
  renderBatchJobs();
  setBatchControlsDisabled(false);
  await checkBackendHealth();
  setDiscoverControlsDisabled(false);
  setAutomationControlsDisabled(false);
  setBatchControlsDisabled(false);
  if (!state.backendAvailable) {
    setDiscoverStatus("Découverte V2 inactive (backend indisponible).", true);
    setBatchStatus("Batch inactif (backend indisponible).", true);
  }
  if (state.backendAvailable) {
    try {
      await refreshYoutubeCookiesStatus();
    } catch (_error) {
      // ignore: status already derived from /api/config or /api/health
    }
    try {
      await refreshTikTokConfigStatus();
    } catch (_error) {
      // ignore: UI will stay in "inactif" state on failure
    }
    try {
      await refreshAutomationScheduleStatus();
    } catch (_error) {
      // ignore
    }
  }
}

void init();
