const runtimeConfig = typeof window.CLIPFORGE_CONFIG !== "undefined" ? window.CLIPFORGE_CONFIG : {};
const defaults = runtimeConfig.defaults || {};

const config = {
  defaultClipDuration: Number(defaults.clipDurationSec) || 30,
  defaultClipsCount: Number(defaults.clipsCount) || 4,
  minSubtitleWords: 4,
  maxSubtitleWords: 10
};

const state = {
  videoFile: null,
  videoUrl: "",
  videoDuration: 0,
  clips: [],
  selectedClipIndex: -1,
  subtitleTracksByClip: [],
  transcriptText: "",
  aspectRatio: "9:16",
  playerLoopInterval: null
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

function tokenizeTranscript(transcript) {
  return transcript
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => w.trim())
    .filter(Boolean);
}

function splitIntoSubtitleChunks(words) {
  const chunks = [];
  let cursor = 0;
  while (cursor < words.length) {
    const size =
      config.minSubtitleWords +
      Math.floor(Math.random() * (config.maxSubtitleWords - config.minSubtitleWords + 1));
    const group = words.slice(cursor, cursor + size);
    if (!group.length) {
      break;
    }
    chunks.push(group.join(" "));
    cursor += size;
  }
  return chunks;
}

function buildSubtitleTrackForClip(clip, clipText) {
  const words = tokenizeTranscript(clipText);
  if (!words.length) {
    return [];
  }

  const chunks = splitIntoSubtitleChunks(words);
  const clipDuration = Math.max(0.1, clip.end - clip.start);
  const perChunk = clipDuration / chunks.length;
  const cues = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const start = clip.start + perChunk * i;
    const end = i === chunks.length - 1 ? clip.end : clip.start + perChunk * (i + 1);
    cues.push({
      start,
      end,
      text: chunks[i]
    });
  }

  return cues;
}

function mockEnergyAtTime(time, duration) {
  const x = time / Math.max(duration, 1);
  const base = 0.45 + 0.2 * Math.sin(x * Math.PI * 8);
  const randomSpike = (Math.sin(x * 62.3) + Math.sin(x * 22.1)) * 0.08;
  return Math.max(0, Math.min(1, base + randomSpike));
}

function generateCandidateMoments(duration, step) {
  const moments = [];
  for (let t = 0; t < duration; t += step) {
    const score = mockEnergyAtTime(t, duration);
    moments.push({ t, score });
  }
  return moments.sort((a, b) => b.score - a.score);
}

function selectBestClips(duration, clipDuration, clipsCount) {
  const maxStart = Math.max(0, duration - clipDuration);
  const moments = generateCandidateMoments(duration, Math.min(4, clipDuration / 3));
  const chosen = [];

  for (const moment of moments) {
    let start = Math.max(0, moment.t - clipDuration * 0.25);
    start = Math.min(start, maxStart);
    const end = Math.min(duration, start + clipDuration);

    const overlaps = chosen.some((clip) => {
      const inter = Math.max(0, Math.min(clip.end, end) - Math.max(clip.start, start));
      return inter > clipDuration * 0.45;
    });

    if (!overlaps) {
      chosen.push({
        start,
        end,
        score: Number(moment.score.toFixed(3))
      });
      if (chosen.length >= clipsCount) {
        break;
      }
    }
  }

  if (!chosen.length) {
    chosen.push({
      start: 0,
      end: Math.min(duration, clipDuration),
      score: 0.5
    });
  }

  return chosen
    .sort((a, b) => a.start - b.start)
    .map((clip, index) => ({
      id: `clip-${index + 1}`,
      title: `Clip ${index + 1}`,
      ...clip
    }));
}

function segmentTranscriptForClips(transcript, clips) {
  const words = tokenizeTranscript(transcript);
  if (!words.length) {
    return clips.map(() => "");
  }

  const distribution = [];
  const durationTotal = clips.reduce((acc, clip) => acc + (clip.end - clip.start), 0) || 1;
  let assigned = 0;

  clips.forEach((clip, idx) => {
    const ratio = (clip.end - clip.start) / durationTotal;
    let wordsForClip = Math.round(words.length * ratio);
    if (idx === clips.length - 1) {
      wordsForClip = words.length - assigned;
    }
    wordsForClip = Math.max(0, wordsForClip);
    distribution.push(words.slice(assigned, assigned + wordsForClip).join(" "));
    assigned += wordsForClip;
  });

  return distribution;
}

function updatePlayerAspect(aspect) {
  const shell = document.querySelector(".video-shell");
  if (!shell) return;
  if (aspect === "9:16") shell.style.aspectRatio = "9 / 16";
  if (aspect === "1:1") shell.style.aspectRatio = "1 / 1";
  if (aspect === "16:9") shell.style.aspectRatio = "16 / 9";
}

function updateStatus(text, ready = false) {
  dom.statusBadge.textContent = text;
  dom.statusBadge.classList.toggle("ready", ready);
}

function clearClipLoop() {
  if (state.playerLoopInterval) {
    clearInterval(state.playerLoopInterval);
    state.playerLoopInterval = null;
  }
}

function startLoopForSelectedClip() {
  clearClipLoop();
  const clip = state.clips[state.selectedClipIndex];
  if (!clip) return;

  state.playerLoopInterval = setInterval(() => {
    if (!dom.player.paused && dom.player.currentTime >= clip.end) {
      dom.player.currentTime = clip.start;
    }
  }, 120);
}

function highlightSelectedClip() {
  const items = dom.clipsList.querySelectorAll(".clip-item");
  items.forEach((item, idx) => {
    item.classList.toggle("active", idx === state.selectedClipIndex);
  });
}

function updateSubtitleOverlay() {
  if (state.selectedClipIndex < 0) {
    dom.subtitleOverlay.innerHTML = "Les sous-titres s’afficheront ici";
    return;
  }
  const track = state.subtitleTracksByClip[state.selectedClipIndex] || [];
  const t = dom.player.currentTime;
  const cue = track.find((c) => t >= c.start && t <= c.end);
  if (!cue) {
    dom.subtitleOverlay.innerHTML = "";
    return;
  }
  dom.subtitleOverlay.innerHTML = `<span>${cue.text}</span>`;
}

function selectClip(index, autoplay = false) {
  if (index < 0 || index >= state.clips.length) return;
  state.selectedClipIndex = index;
  highlightSelectedClip();

  const clip = state.clips[index];
  dom.player.currentTime = clip.start;
  if (autoplay) {
    dom.player.play().catch(() => {});
  }
  startLoopForSelectedClip();
  updateStatus(`Clip sélectionné: ${clip.title} (${secondsToClock(clip.start)} → ${secondsToClock(clip.end)})`, true);
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
    li.innerHTML = `
      <div class="clip-top">
        <h3 class="clip-title">${clip.title}</h3>
        <span class="chip">Score ${clip.score}</span>
      </div>
      <p class="clip-times">${secondsToClock(clip.start)} → ${secondsToClock(clip.end)} (${Math.round(clip.end - clip.start)}s)</p>
      <div class="clip-actions">
        <button class="mini-btn" data-action="select">Sélectionner</button>
        <button class="mini-btn" data-action="play">Lire</button>
      </div>
    `;

    li.querySelector('[data-action="select"]').addEventListener("click", () => {
      selectClip(idx, false);
    });
    li.querySelector('[data-action="play"]').addEventListener("click", () => {
      selectClip(idx, true);
    });

    dom.clipsList.appendChild(li);
  });

  highlightSelectedClip();
}

function setButtonsEnabled(enabled) {
  dom.playClipBtn.disabled = !enabled;
  dom.exportClipBtn.disabled = !enabled;
  dom.downloadJsonBtn.disabled = !enabled;
}

function createBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function exportSelectedClip() {
  const clip = state.clips[state.selectedClipIndex];
  if (!clip || !state.videoUrl) return;

  updateStatus("Export en cours…", false);
  dom.exportClipBtn.disabled = true;

  try {
    const tempVideo = document.createElement("video");
    tempVideo.src = state.videoUrl;
    tempVideo.muted = true;
    tempVideo.crossOrigin = "anonymous";
    tempVideo.playsInline = true;
    await tempVideo.play().catch(() => {});
    tempVideo.pause();

    const width = 720;
    const ratio = state.aspectRatio;
    const height = ratio === "9:16" ? 1280 : ratio === "1:1" ? 720 : 405;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    const stream = canvas.captureStream(30);
    const chunks = [];
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    const recorder = new MediaRecorder(stream, { mimeType: mime });

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };

    const track = state.subtitleTracksByClip[state.selectedClipIndex] || [];
    const duration = clip.end - clip.start;
    const fps = 30;
    const frameDuration = 1 / fps;

    tempVideo.currentTime = clip.start;
    await new Promise((resolve) => {
      const onSeek = () => {
        tempVideo.removeEventListener("seeked", onSeek);
        resolve();
      };
      tempVideo.addEventListener("seeked", onSeek);
    });

    recorder.start();
    const started = performance.now();

    for (let local = 0; local < duration; local += frameDuration) {
      const absolute = clip.start + local;
      tempVideo.currentTime = absolute;

      await new Promise((resolve) => {
        const onSeek = () => {
          tempVideo.removeEventListener("seeked", onSeek);
          resolve();
        };
        tempVideo.addEventListener("seeked", onSeek);
      });

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(tempVideo, 0, 0, width, height);

      const cue = track.find((c) => absolute >= c.start && absolute <= c.end);
      if (cue) {
        ctx.font = "bold 34px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const maxTextWidth = width - 80;
        const lines = wrapText(cue.text, maxTextWidth, ctx);
        const lineHeight = 42;
        const blockHeight = lines.length * lineHeight + 14;
        const y = height - 120;

        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(40, y - blockHeight / 2, width - 80, blockHeight);
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.strokeRect(40, y - blockHeight / 2, width - 80, blockHeight);

        ctx.fillStyle = "#fff";
        lines.forEach((line, index) => {
          const yy = y - ((lines.length - 1) * lineHeight) / 2 + index * lineHeight;
          ctx.fillText(line, width / 2, yy);
        });
      }
    }

    recorder.stop();

    await new Promise((resolve) => {
      recorder.onstop = resolve;
    });

    const blob = new Blob(chunks, { type: "video/webm" });
    createBlobDownload(blob, `${clip.id}.webm`);

    const elapsed = ((performance.now() - started) / 1000).toFixed(1);
    updateStatus(`Export terminé (${elapsed}s)`, true);
  } catch (error) {
    console.error(error);
    updateStatus("Échec export. Vérifiez le format de la vidéo.", false);
  } finally {
    dom.exportClipBtn.disabled = false;
  }
}

function wrapText(text, maxWidth, ctx) {
  const words = text.split(" ");
  const lines = [];
  let line = "";

  words.forEach((word) => {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  });
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function downloadPlanAsJson() {
  const payload = {
    createdAt: new Date().toISOString(),
    source: state.videoFile ? state.videoFile.name : null,
    sourceDuration: state.videoDuration,
    aspectRatio: state.aspectRatio,
    transcriptLength: state.transcriptText.length,
    clips: state.clips,
    subtitles: state.subtitleTracksByClip
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });
  createBlobDownload(blob, "clipforge-plan.json");
}

function useSampleTranscript() {
  const sample = [
    "Aujourd'hui je vais vous montrer comment passer de longues vidéos à des clips courts qui captent l'attention.",
    "Le secret est de garder des phrases courtes, un rythme rapide, et un hook fort dans les trois premières secondes.",
    "Ensuite on enchaîne avec une promesse claire, puis on apporte de la valeur avec une démonstration concrète.",
    "Enfin on termine par un call to action simple pour inciter l'audience à commenter, partager ou s'abonner."
  ].join(" ");
  dom.transcriptInput.value = sample;
}

function analyzeAndGenerate() {
  if (!state.videoFile || !state.videoDuration) {
    updateStatus("Chargez une vidéo avant de générer.", false);
    return;
  }

  const clipDuration = Number(dom.clipDuration.value);
  const clipsCount = Number(dom.clipsCount.value);
  const transcript = dom.transcriptInput.value.trim();

  state.transcriptText = transcript;
  state.aspectRatio = dom.aspectRatio.value;
  updatePlayerAspect(state.aspectRatio);

  const clips = selectBestClips(state.videoDuration, clipDuration, clipsCount);
  const transcriptParts = segmentTranscriptForClips(transcript, clips);
  const subtitleTracks = clips.map((clip, idx) =>
    buildSubtitleTrackForClip(clip, transcriptParts[idx] || "")
  );

  state.clips = clips;
  state.subtitleTracksByClip = subtitleTracks;
  state.selectedClipIndex = 0;

  renderClips();
  setButtonsEnabled(true);
  selectClip(0, false);
  updateStatus(`${clips.length} clips générés avec succès`, true);
}

function init() {
  dom.clipDuration.value = String(config.defaultClipDuration);
  dom.clipsCount.value = String(config.defaultClipsCount);
  dom.clipsCountValue.textContent = String(config.defaultClipsCount);

  dom.videoInput.addEventListener("change", () => {
    const file = dom.videoInput.files && dom.videoInput.files[0];
    if (!file) return;

    state.videoFile = file;
    if (state.videoUrl) {
      URL.revokeObjectURL(state.videoUrl);
    }
    state.videoUrl = URL.createObjectURL(file);
    dom.player.src = state.videoUrl;
    dom.player.load();

    dom.player.onloadedmetadata = () => {
      state.videoDuration = dom.player.duration || 0;
      updateStatus(`Vidéo prête (${secondsToClock(state.videoDuration)})`, true);
    };

    setButtonsEnabled(false);
    state.clips = [];
    state.subtitleTracksByClip = [];
    state.selectedClipIndex = -1;
    renderClips();
    clearClipLoop();
  });

  dom.clipsCount.addEventListener("input", () => {
    dom.clipsCountValue.textContent = dom.clipsCount.value;
  });

  dom.aspectRatio.addEventListener("change", () => {
    state.aspectRatio = dom.aspectRatio.value;
    updatePlayerAspect(state.aspectRatio);
  });

  dom.generateScriptBtn.addEventListener("click", useSampleTranscript);
  dom.analyzeBtn.addEventListener("click", analyzeAndGenerate);

  dom.playClipBtn.addEventListener("click", () => {
    const idx = state.selectedClipIndex;
    if (idx < 0) return;
    selectClip(idx, true);
  });

  dom.exportClipBtn.addEventListener("click", exportSelectedClip);
  dom.downloadJsonBtn.addEventListener("click", downloadPlanAsJson);

  dom.player.addEventListener("timeupdate", updateSubtitleOverlay);
  dom.player.addEventListener("pause", () => clearClipLoop());
  dom.player.addEventListener("play", () => {
    if (state.selectedClipIndex >= 0) startLoopForSelectedClip();
  });

  updatePlayerAspect(state.aspectRatio);
  setButtonsEnabled(false);
}

init();
