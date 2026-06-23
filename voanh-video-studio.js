/**
 * VOANH Video Studio — génération longue durée (10+ min)
 * Pipeline : Mistral (script) → FAL.ai Kling (clips) → FFmpeg/Creatomate (assemblage)
 */
(function initVoanhVideoStudio(global) {
  const API_BASE = detectApiBase();
  const VIDEO_PROVIDERS = {
    hfLocal: "huggingface-local",
    fal: "fal"
  };
  const FAL_MODELS = {
    kling: "fal-ai/kling-video/v2/master/text-to-video",
    klingTurbo: "fal-ai/kling-video/v1.6/standard/text-to-video"
  };
  const HF_MODELS = {
    sulphur2: "SulphurAI/Sulphur-2-base",
    wan21_13b: "Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
    wan22_a14b: "Wan-AI/Wan2.2-T2V-A14B-Diffusers"
  };

  const videoState = {
    running: false,
    cancelRequested: false,
    clipUrls: [],
    scenes: []
  };

  function detectApiBase() {
    if (global.location?.protocol === "file:") return null;
    return `${global.location.origin}/api/voanh`;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getFalKey() {
    try {
      const cookie = document.cookie.match(/(?:^|;\s*)fal_api_key=([^;]+)/);
      if (cookie) return decodeURIComponent(cookie[1]);
    } catch (_err) { /* ignore */ }
    try {
      return localStorage.getItem("voanh_fal_api_key") || "";
    } catch (_err) {
      return "";
    }
  }

  function setFalKey(key) {
    const value = String(key || "").trim();
    try {
      const expires = new Date();
      expires.setDate(expires.getDate() + 365);
      document.cookie = `fal_api_key=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/;SameSite=Strict`;
    } catch (_err) { /* ignore */ }
    try {
      localStorage.setItem("voanh_fal_api_key", value);
    } catch (_err) { /* ignore */ }
    updateFalStatusPill();
  }

  function getVideoProvider() {
    const input = document.getElementById("video-provider");
    const raw = input?.value || localStorage.getItem("voanh_video_provider") || VIDEO_PROVIDERS.hfLocal;
    return raw === VIDEO_PROVIDERS.fal ? VIDEO_PROVIDERS.fal : VIDEO_PROVIDERS.hfLocal;
  }

  function setVideoProvider(provider) {
    const normalized = provider === VIDEO_PROVIDERS.fal ? VIDEO_PROVIDERS.fal : VIDEO_PROVIDERS.hfLocal;
    const input = document.getElementById("video-provider");
    if (input) input.value = normalized;
    try {
      localStorage.setItem("voanh_video_provider", normalized);
    } catch (_err) {
      // ignore storage errors
    }
    applyVideoProviderUi();
  }

  function getHfModel() {
    const input = document.getElementById("video-hf-model");
    const raw = input?.value || localStorage.getItem("voanh_hf_model") || HF_MODELS.sulphur2;
    return raw || HF_MODELS.sulphur2;
  }

  function setHfModel(modelId) {
    const input = document.getElementById("video-hf-model");
    if (input && modelId) input.value = modelId;
    try {
      localStorage.setItem("voanh_hf_model", modelId || HF_MODELS.sulphur2);
    } catch (_err) {
      // ignore storage errors
    }
  }

  function getCreatomateKey() {
    try {
      return localStorage.getItem("voanh_creatomate_api_key") || "";
    } catch (_err) {
      return "";
    }
  }

  function setCreatomateKey(key) {
    try {
      localStorage.setItem("voanh_creatomate_api_key", String(key || "").trim());
    } catch (_err) { /* ignore */ }
  }

  function updateFalStatusPill() {
    const pill = document.getElementById("fal-status");
    if (!pill) return;
    if (getVideoProvider() === VIDEO_PROVIDERS.hfLocal) {
      pill.className = "status-pill active";
      pill.innerHTML = '<span class="status-dot"></span>HF LOCAL';
      return;
    }
    const key = getFalKey();
    if (key.length >= 20) {
      pill.className = "status-pill active";
      pill.innerHTML = '<span class="status-dot"></span>VIDEO ON';
    } else {
      pill.className = "status-pill";
      pill.innerHTML = '<span class="status-dot"></span>VIDEO OFF';
    }
  }

  function applyVideoProviderUi() {
    const provider = getVideoProvider();
    const showFal = provider === VIDEO_PROVIDERS.fal;
    const falGroup = document.getElementById("fal-key-group");
    const falModel = document.getElementById("video-fal-model");
    if (falGroup) falGroup.style.display = showFal ? "" : "none";
    if (falModel) falModel.disabled = !showFal;
    updateFalStatusPill();
  }

  function setProgress(pct, label, detail) {
    const bar = document.getElementById("video-progress-bar");
    const lbl = document.getElementById("video-progress-label");
    const det = document.getElementById("video-progress-detail");
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    if (lbl) lbl.textContent = label || "";
    if (det) det.textContent = detail || "";
  }

  function appendVideoLog(line) {
    const log = document.getElementById("video-log");
    if (!log) return;
    const row = document.createElement("div");
    row.className = "video-log-line";
    row.textContent = `[${new Date().toLocaleTimeString("fr-FR")}] ${line}`;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  async function apiFetch(path, options = {}) {
    if (!API_BASE) throw new Error("Serveur VOANH requis pour le proxy vidéo. Lancez: npm start puis ouvrez /voanh");
    const headers = { ...(options.headers || {}) };
    if (options.falKey) headers["x-fal-key"] = options.falKey;
    if (options.creatomateKey) headers["x-creatomate-key"] = options.creatomateKey;
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    if (!res.ok) throw new Error(body.error || body.message || text || res.statusText);
    return body;
  }

  async function planScenesWithMistral({ topic, durationMin, clipSec, aspectRatio, mistralKey, modelId }) {
    const sceneCount = Math.ceil((durationMin * 60) / clipSec);
    const prompt = `Tu es un directeur de création vidéo YouTube. Génère un plan pour une vidéo ORIGINALE de ${durationMin} minutes.

Sujet : ${topic}
Format : ${aspectRatio}
Durée par scène : ${clipSec} secondes
Nombre de scènes EXACT : ${sceneCount}

Règles :
- Contenu 100% original, pas de logos, pas de visages de célébrités
- Prompts visuels cinématiques pour IA (silhouettes, ambiance, pas de texte à l'écran)
- Narration voix-off en français pour chaque scène
- Histoire cohérente du début à la fin

Réponds UNIQUEMENT en JSON valide :
{
  "title": "titre accrocheur",
  "scenes": [
    {
      "index": 1,
      "visualPrompt": "description visuelle détaillée en anglais pour IA vidéo",
      "narration": "texte voix-off français",
      "durationSec": ${clipSec}
    }
  ]
}`;

    const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mistralKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: modelId || "mistral-small-2506",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.75,
        max_tokens: Math.min(16000, 400 + sceneCount * 120)
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Mistral plan: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || "";
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    if (!Array.isArray(parsed.scenes) || !parsed.scenes.length) {
      throw new Error("Plan de scènes invalide");
    }
    return parsed;
  }

  async function submitFalClip({ falKey, modelPath, prompt, duration, aspectRatio }) {
    return apiFetch("/fal/submit", {
      method: "POST",
      falKey,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelKey: modelPath,
        prompt,
        duration: String(duration),
        aspectRatio
      })
    });
  }

  async function pollFalResult({ falKey, modelPath, requestId, onTick }) {
    const maxAttempts = 180;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (videoState.cancelRequested) throw new Error("Génération annulée");
      const status = await apiFetch(
        `/fal/status?requestId=${encodeURIComponent(requestId)}&modelPath=${encodeURIComponent(modelPath)}`,
        { falKey }
      );
      if (onTick) onTick(status);
      const state = String(status.status || "").toUpperCase();
      if (state === "COMPLETED") {
        const result = await apiFetch(
          `/fal/result?requestId=${encodeURIComponent(requestId)}&modelPath=${encodeURIComponent(modelPath)}`,
          { falKey }
        );
        const url =
          result?.video?.url ||
          result?.data?.video?.url ||
          result?.output?.video?.url ||
          result?.response?.video?.url;
        if (!url) throw new Error("URL vidéo absente dans la réponse FAL");
        return url;
      }
      if (state === "FAILED" || state === "ERROR") {
        throw new Error(status.error || "Échec génération clip FAL");
      }
      await sleep(4000);
    }
    throw new Error("Timeout génération clip FAL");
  }

  async function assembleWithServer(clipUrls) {
    return apiFetch("/assemble", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clipUrls })
    });
  }

  async function assembleWithCreatomate({ creatomateKey, clipUrls, clipSec, aspectRatio, title }) {
    const isPortrait = aspectRatio === "9:16";
    const width = isPortrait ? 1080 : 1920;
    const height = isPortrait ? 1920 : 1080;
    let cursor = 0;
    const elements = clipUrls.map((url) => {
      const el = {
        type: "video",
        source: url,
        time: cursor,
        duration: clipSec,
        fit: "cover"
      };
      cursor += clipSec;
      return el;
    });

    const render = await apiFetch("/creatomate/render", {
      method: "POST",
      creatomateKey,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: {
          output_format: "mp4",
          width,
          height,
          frame_rate: 30,
          duration: cursor,
          fill_color: "#000000",
          elements: [
            {
              type: "composition",
              track: 1,
              elements
            },
            {
              type: "text",
              text: title || "VOANH",
              time: 0,
              duration: Math.min(3, cursor),
              y: "8%",
              width: "90%",
              height: "12%",
              font_family: "Montserrat",
              font_weight: "700",
              fill_color: "#ffffff",
              background_align: "center"
            }
          ]
        }
      })
    });

    const renderId = render?.id || render?.[0]?.id;
    if (!renderId) throw new Error("ID render Creatomate manquant");

    for (let i = 0; i < 120; i += 1) {
      if (videoState.cancelRequested) throw new Error("Assemblage annulé");
      const status = await apiFetch(`/creatomate/render/${renderId}`, { creatomateKey });
      const st = String(status.status || "").toLowerCase();
      if (st === "succeeded" && status.url) {
        return { downloadUrl: status.url, provider: "creatomate" };
      }
      if (st === "failed") throw new Error(status.error_message || "Échec Creatomate");
      await sleep(5000);
    }
    throw new Error("Timeout assemblage Creatomate");
  }

  async function runVideoGeneration() {
    if (videoState.running) return;

    const topic = document.getElementById("video-topic")?.value?.trim();
    const durationMin = Number(document.getElementById("video-duration-min")?.value || 10);
    const clipSec = Number(document.getElementById("video-clip-sec")?.value || 10);
    const aspectRatio = document.getElementById("video-aspect")?.value || "9:16";
    const videoProvider = getVideoProvider();
    const hfModel = getHfModel();
    const modelPath = document.getElementById("video-fal-model")?.value || FAL_MODELS.kling;
    const assemblyMode = document.getElementById("video-assembly")?.value || "server";
    const falKey = document.getElementById("fal-api-key-input")?.value?.trim() || getFalKey();
    const creatomateKey = document.getElementById("creatomate-api-key-input")?.value?.trim() || getCreatomateKey();
    const mistralKey = global.state?.apiKey;

    if (!topic) {
      global.toast?.("Décrivez le sujet de la vidéo", "error");
      return;
    }
    if (videoProvider === VIDEO_PROVIDERS.fal && (!falKey || falKey.length < 20)) {
      global.toast?.("Configurez votre clé FAL.ai", "error");
      return;
    }
    if (!mistralKey) {
      global.toast?.("Configurez d'abord votre clé Mistral", "error");
      return;
    }
    if (assemblyMode === "creatomate" && !creatomateKey) {
      global.toast?.("Clé Creatomate requise pour ce mode d'assemblage", "error");
      return;
    }

    const sceneCount = Math.ceil((durationMin * 60) / clipSec);
    if (sceneCount > 90) {
      global.toast?.("Trop de scènes — réduisez la durée ou augmentez la durée par clip", "error");
      return;
    }

    const proceed = global.confirm(
      videoProvider === VIDEO_PROVIDERS.fal
        ? `Génération : ~${durationMin} min → ${sceneCount} clips de ${clipSec}s.\nCoût FAL estimé : ~${(sceneCount * 0.08 * clipSec).toFixed(1)}€.\nContinuer ?`
        : `Génération locale Hugging Face : ~${durationMin} min → ${sceneCount} clips de ${clipSec}s.\nModèle : ${hfModel}\nContinuer ?`
    );
    if (!proceed) return;

    if (videoProvider === VIDEO_PROVIDERS.fal) {
      setFalKey(falKey);
    }
    setVideoProvider(videoProvider);
    setHfModel(hfModel);
    if (creatomateKey) setCreatomateKey(creatomateKey);

    videoState.running = true;
    videoState.cancelRequested = false;
    videoState.clipUrls = [];
    videoState.scenes = [];

    const btn = document.getElementById("video-generate-btn");
    const cancelBtn = document.getElementById("video-cancel-btn");
    const resultBox = document.getElementById("video-result");
    if (btn) btn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = false;
    if (resultBox) resultBox.style.display = "none";

    const log = document.getElementById("video-log");
    if (log) log.innerHTML = "";

    try {
      setProgress(2, "Planification Mistral…", `${sceneCount} scènes`);
      appendVideoLog("Génération du plan de scènes via Mistral…");

      const plan = await planScenesWithMistral({
        topic,
        durationMin,
        clipSec,
        aspectRatio,
        mistralKey,
        modelId: global.state?.model
      });

      videoState.scenes = plan.scenes.slice(0, sceneCount);
      appendVideoLog(`Plan OK : "${plan.title}" — ${videoState.scenes.length} scènes`);

      for (let i = 0; i < videoState.scenes.length; i += 1) {
        if (videoState.cancelRequested) throw new Error("Annulé");
        const scene = videoState.scenes[i];
        const pct = 5 + Math.round((i / videoState.scenes.length) * 80);
        setProgress(pct, `Clip ${i + 1}/${videoState.scenes.length}`, scene.visualPrompt?.slice(0, 80) || "");
        appendVideoLog(`Clip ${i + 1} : soumission FAL…`);

        const visual = `${scene.visualPrompt}. Cinematic, original content, no logos, no celebrity faces, no text overlay.`;
        const submit = await submitFalClip({
          falKey,
          modelPath,
          prompt: visual,
          duration: clipSec,
          aspectRatio
        });

        appendVideoLog(`Clip ${i + 1} : file d'attente ${submit.requestId}`);
        const clipUrl = await pollFalResult({
          falKey,
          modelPath: submit.modelPath || modelPath,
          requestId: submit.requestId,
          onTick: (st) => appendVideoLog(`Clip ${i + 1} : ${st.status}`)
        });

        videoState.clipUrls.push(clipUrl);
        appendVideoLog(`Clip ${i + 1} : terminé`);
      }

      setProgress(88, "Assemblage final…", `${videoState.clipUrls.length} clips`);
      appendVideoLog("Assemblage de la vidéo longue…");

      let finalUrl;
      let provider;
      if (assemblyMode === "creatomate") {
        const out = await assembleWithCreatomate({
          creatomateKey,
          clipUrls: videoState.clipUrls,
          clipSec,
          aspectRatio,
          title: plan.title
        });
        finalUrl = out.downloadUrl;
        provider = out.provider;
      } else {
        const out = await assembleWithServer(videoState.clipUrls);
        finalUrl = out.downloadUrl?.startsWith("http")
          ? out.downloadUrl
          : `${global.location.origin}${out.downloadUrl}`;
        provider = "ffmpeg";
      }

      setProgress(100, "Terminé !", `${durationMin} min assemblées`);
      appendVideoLog(`Vidéo finale prête (${provider})`);

      if (resultBox) {
        resultBox.style.display = "block";
        resultBox.innerHTML = `
          <div class="success-block">
            <strong>✓ Vidéo longue générée</strong><br>
            ${plan.title || topic}<br>
            ${videoState.clipUrls.length} clips · ~${durationMin} min<br>
            <a href="${finalUrl}" target="_blank" rel="noopener" style="color:var(--cyan)">⬇ Télécharger la vidéo MP4</a>
          </div>`;
      }
      global.toast?.("Vidéo longue générée avec succès !", "success");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      appendVideoLog(`ERREUR : ${msg}`);
      global.toast?.(msg, "error");
      setProgress(0, "Erreur", msg);
    } finally {
      videoState.running = false;
      if (btn) btn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = true;
    }
  }

  function bindVideoStudio() {
    updateFalStatusPill();
    applyVideoProviderUi();

    const openBtn = document.getElementById("open-video-modal");
    const openMob = document.getElementById("open-video-modal-mob");
    const modal = document.getElementById("video-modal");
    const close = () => modal?.classList.remove("active");

    const open = () => {
      const falInput = document.getElementById("fal-api-key-input");
      const cmInput = document.getElementById("creatomate-api-key-input");
      if (falInput) falInput.value = getFalKey();
      if (cmInput) cmInput.value = getCreatomateKey();
      setVideoProvider(getVideoProvider());
      setHfModel(getHfModel());
      modal?.classList.add("active");
    };

    if (openBtn) openBtn.onclick = open;
    if (openMob) openMob.onclick = () => {
      document.getElementById("mobile-menu")?.classList.remove("open");
      open();
    };

    document.getElementById("close-video-modal")?.addEventListener("click", close);
    document.getElementById("close-video-modal-2")?.addEventListener("click", close);
    modal?.addEventListener("click", (e) => {
      if (e.target === modal) close();
    });

    document.getElementById("save-fal-key")?.addEventListener("click", () => {
      const key = document.getElementById("fal-api-key-input")?.value?.trim();
      if (!key || key.length < 20) {
        global.toast?.("Clé FAL invalide", "error");
        return;
      }
      setFalKey(key);
      global.toast?.("Clé FAL.ai enregistrée", "success");
    });
    document.getElementById("video-provider")?.addEventListener("change", (event) => {
      setVideoProvider(event.target?.value);
    });
    document.getElementById("video-hf-model")?.addEventListener("change", (event) => {
      setHfModel(event.target?.value);
    });

    document.getElementById("video-generate-btn")?.addEventListener("click", async () => {
      const auto = document.getElementById("video-auto-mode")?.checked;
      const provider = getVideoProvider();
      if (auto || provider === VIDEO_PROVIDERS.hfLocal) {
        const topic = document.getElementById("video-topic")?.value?.trim();
        const durationMin = Number(document.getElementById("video-duration-min")?.value || 10);
        const mistralKey = global.state?.apiKey;
        if (!topic || !mistralKey) {
          global.toast?.("Sujet et clé Mistral requis", "error");
          return;
        }
        try {
          const job = await startAutoJob({ topic, durationMin, mistralKey, mistralModel: global.state?.model });
          appendVideoLog(`Job auto #${job.id} lancé en arrière-plan`);
          setProgress(5, "Production auto…", `Job ${job.id}`);
          pollAutoJob(job.id, (status) => {
            setProgress(status.progress || 0, status.status, `${status.scenesDone || 0}/${status.sceneCount || "?"} scènes`);
            if (status.logs?.length) {
              const last = status.logs[status.logs.length - 1];
              appendVideoLog(last.message);
            }
          }).then((finalJob) => {
            if (finalJob.status === "completed") {
              const url = `${global.location.origin}${finalJob.downloadUrl}`;
              document.getElementById("video-result").style.display = "block";
              document.getElementById("video-result").innerHTML = `
                <div class="success-block">
                  <strong>✓ Vidéo auto générée</strong><br>
                  <a href="${url}" target="_blank" rel="noopener" style="color:var(--cyan)">⬇ Télécharger MP4</a>
                </div>`;
              global.toast?.("Vidéo automatique prête !", "success");
            } else {
              global.toast?.(finalJob.error || "Échec production auto", "error");
            }
          });
        } catch (err) {
          global.toast?.(err.message || String(err), "error");
        }
        return;
      }
      runVideoGeneration();
    });
    document.getElementById("video-cancel-btn")?.addEventListener("click", () => {
      videoState.cancelRequested = true;
      appendVideoLog("Annulation demandée…");
    });

    document.getElementById("video-use-chat")?.addEventListener("click", () => {
      const msgs = (global.state?.messages || []).filter((m) => m.role === "user");
      const last = msgs[msgs.length - 1];
      const input = document.getElementById("video-topic");
      if (last?.content && input) {
        input.value = last.content.slice(0, 500);
        global.toast?.("Sujet importé depuis le chat", "info");
      }
    });

    if (API_BASE) {
      apiFetch("/health")
        .then((h) => {
          if (h?.videoGeneration?.defaultProvider) {
            setVideoProvider(h.videoGeneration.defaultProvider);
          } else {
            applyVideoProviderUi();
          }
          appendVideoLog(`Serveur vidéo OK — ffmpeg: ${h.ffmpegReady ? "oui" : "non"}`);
        })
        .catch(() => appendVideoLog("Mode hors-ligne : lancez npm start pour l'assemblage FFmpeg"));
    }
  }

  global.VoanhVideoStudio = {
    bindVideoStudio,
    getFalKey,
    setFalKey,
    parseVideoCommand,
    startAutoJob,
    pollAutoJob,
    handleChatVideoCommand,
    ensureVideoProducerAgent,
    VIDEO_AGENT_ID: "voanh-video-forge-agent"
  };

  function parseVideoCommand(text) {
    const raw = String(text || "").trim();
    if (!raw) return null;

    const slash = raw.match(/^\/video(?:@auto)?\s+(\d{1,2})\s*(?:min(?:utes?)?)?\s*[:\-]?\s*(.+)$/i);
    if (slash) {
      return { topic: slash[2].trim(), durationMin: Number(slash[1]), auto: true };
    }

    const fr = raw.match(
      /(?:g[ée]n[èe]re|cr[ée]e|produis|lance)\s+(?:moi\s+)?(?:une\s+)?vid[ée]o(?:\s+de)?\s+(\d{1,2})\s*(?:min(?:utes?)?)?\s+(?:sur|about|au sujet de)\s+(.+)$/i
    );
    if (fr) {
      return { topic: fr[2].trim(), durationMin: Number(fr[1]), auto: true };
    }

    if (/^\/video\s+(.+)$/i.test(raw)) {
      return { topic: raw.replace(/^\/video\s+/i, "").trim(), durationMin: 10, auto: true };
    }

    return null;
  }

  function isVideoAutomationAgent(agent) {
    if (!agent) return false;
    const tags = (agent.tags || []).map((t) => String(t).toLowerCase());
    return (
      agent.videoAutomation === true ||
      tags.includes("video") ||
      tags.includes("video-auto") ||
      /videoforge|video forge|producteur vid/i.test(agent.name || "")
    );
  }

  async function startAutoJob({ topic, durationMin = 10, clipSec, aspectRatio, modelPath, mistralKey, mistralModel }) {
    const videoProvider = getVideoProvider();
    const falKey = getFalKey();
    const hfModel = getHfModel();
    if (!mistralKey) throw new Error("Clé Mistral requise");
    if (videoProvider === VIDEO_PROVIDERS.fal && (!falKey || falKey.length < 20)) {
      throw new Error("Clé FAL.ai requise — ouvrez ▶ VIDÉO");
    }

    const payload = {
      topic,
      durationMin,
      clipSec: clipSec || Number(document.getElementById("video-clip-sec")?.value || 10),
      aspectRatio: aspectRatio || document.getElementById("video-aspect")?.value || "9:16",
      videoProvider,
      modelPath: modelPath || document.getElementById("video-fal-model")?.value || FAL_MODELS.kling,
      hfModel,
      mistralModel: mistralModel || global.state?.model,
      mistralKey,
      falKey: videoProvider === VIDEO_PROVIDERS.fal ? falKey : ""
    };

    return apiFetch("/jobs/auto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  async function pollAutoJob(jobId, onUpdate) {
    for (let i = 0; i < 3600; i += 1) {
      const job = await apiFetch(`/jobs/${encodeURIComponent(jobId)}`);
      if (onUpdate) onUpdate(job);
      if (job.status === "completed" || job.status === "failed") return job;
      await sleep(5000);
    }
    throw new Error("Timeout suivi job vidéo");
  }

  async function handleChatVideoCommand(text, hooks = {}) {
    const agent = global.state?.agent;
    let parsed = parseVideoCommand(text);
    const agentVideoMode = isVideoAutomationAgent(agent);

    if (!parsed && agentVideoMode) {
      const wantsVideo = /vid[ée]o|youtube|shorts?|script|sc[èe]ne|moneti|cm\s*2026|coupe du monde/i.test(text);
      if (wantsVideo) {
        const dur = text.match(/(\d{1,2})\s*min/i);
        parsed = { topic: text.trim(), durationMin: dur ? Number(dur[1]) : 10, auto: true };
      }
    }

    if (!parsed?.topic) return false;

    const mistralKey = global.state?.apiKey;
    if (!mistralKey) {
      global.toast?.("Configurez votre clé Mistral", "error");
      return true;
    }

    try {
      const job = await startAutoJob({
        topic: parsed.topic,
        durationMin: parsed.durationMin,
        mistralKey,
        mistralModel: global.state?.model
      });

      hooks.onJobStarted?.(job);
      global.toast?.(`Production vidéo lancée (${parsed.durationMin} min)`, "success");

      pollAutoJob(job.id, (status) => hooks.onJobUpdate?.(status))
        .then((finalJob) => hooks.onJobDone?.(finalJob))
        .catch((err) => hooks.onJobError?.(err));

      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      global.toast?.(msg, "error");
      hooks.onJobError?.(error);
      return true;
    }
  }

  async function ensureVideoProducerAgent(db, uuidFn, nowFn) {
    if (!db?.get || !db?.put) return null;
    const id = "voanh-video-forge-agent";
    const existing = await db.get("agents", id).catch(() => null);
    if (existing) return existing;

    const agent = {
      id,
      name: "VideoForge Auto",
      desc: "Producteur vidéo IA — génère des vidéos longues (10+ min) en automatique via le chat",
      instructions: [
        "Tu es VideoForge, producteur vidéo IA intégré à VOANH.",
        "Quand l'utilisateur demande une vidéo, guide-le vers la commande : /video 10min sujet",
        "Ou reformule sa demande et confirme : durée cible, angle, public.",
        "Tu ne génères pas la vidéo toi-même : le pipeline automatique Mistral + FAL + FFmpeg s'en charge.",
        "Rappelle : contenu original uniquement, pas de logos ni célébrités."
      ].join("\n"),
      primer: "Je transforme vos idées en vidéos longues prêtes pour YouTube.",
      tags: ["video", "video-auto", "youtube", "automation"],
      videoAutomation: true,
      style: "creatif",
      temperature: 0.65,
      memPrio: 3,
      maxTokens: 4096,
      modelPref: "mistral-small-2506",
      created: nowFn ? nowFn() : Date.now()
    };

    await db.put("agents", agent);
    return agent;
  }
})(window);
