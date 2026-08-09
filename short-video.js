const dom = {
  youtubeBadge: document.getElementById("youtubeBadge"),
  youtubeMeta: document.getElementById("youtubeMeta"),
  youtubeConnectBtn: document.getElementById("youtubeConnectBtn"),
  youtubeDisconnectBtn: document.getElementById("youtubeDisconnectBtn"),
  tiktokBadge: document.getElementById("tiktokBadge"),
  tiktokMeta: document.getElementById("tiktokMeta"),
  tiktokConnectBtn: document.getElementById("tiktokConnectBtn"),
  tiktokDisconnectBtn: document.getElementById("tiktokDisconnectBtn"),
  tiktokAccessToken: document.getElementById("tiktokAccessToken"),
  tiktokOpenId: document.getElementById("tiktokOpenId"),
  tiktokManualSaveBtn: document.getElementById("tiktokManualSaveBtn"),
  publishForm: document.getElementById("publishForm"),
  videoFile: document.getElementById("videoFile"),
  videoUrl: document.getElementById("videoUrl"),
  dropzone: document.getElementById("dropzone"),
  dropLabel: document.getElementById("dropLabel"),
  title: document.getElementById("title"),
  hashtags: document.getElementById("hashtags"),
  description: document.getElementById("description"),
  publishYoutube: document.getElementById("publishYoutube"),
  publishTiktok: document.getElementById("publishTiktok"),
  madeForKids: document.getElementById("madeForKids"),
  youtubePrivacy: document.getElementById("youtubePrivacy"),
  tiktokPrivacy: document.getElementById("tiktokPrivacy"),
  publishBtn: document.getElementById("publishBtn"),
  toast: document.getElementById("toast"),
  results: document.getElementById("results")
};

function showToast(message, type = "ok") {
  dom.toast.hidden = false;
  dom.toast.className = `toast ${type}`;
  dom.toast.textContent = message;
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await response.json() : { error: await response.text() };
  if (!response.ok && response.status !== 207) {
    throw new Error(payload.error || `Erreur HTTP ${response.status}`);
  }
  return payload;
}

function setPlatformState(platform, connected, metaText, oauthReady) {
  const badge = platform === "youtube" ? dom.youtubeBadge : dom.tiktokBadge;
  const meta = platform === "youtube" ? dom.youtubeMeta : dom.tiktokMeta;
  const connectBtn = platform === "youtube" ? dom.youtubeConnectBtn : dom.tiktokConnectBtn;
  const disconnectBtn = platform === "youtube" ? dom.youtubeDisconnectBtn : dom.tiktokDisconnectBtn;

  badge.textContent = connected ? "Connecté" : oauthReady ? "Prêt à connecter" : "Config serveur manquante";
  badge.className = `badge ${connected ? "ok" : oauthReady ? "warn" : ""}`.trim();
  meta.textContent = metaText;
  disconnectBtn.hidden = !connected;
  if (!oauthReady && platform === "youtube") {
    connectBtn.setAttribute("aria-disabled", "true");
    connectBtn.title = "Ajoute GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET sur le serveur";
  }
}

async function refreshStatus() {
  const status = await api("/api/short-video/status");
  const yt = status.youtube || {};
  const tt = status.tiktok || {};

  setPlatformState(
    "youtube",
    Boolean(yt.connected),
    yt.connected
      ? `Connecté${yt.channelTitle ? ` — ${yt.channelTitle}` : ""}${yt.email ? ` (${yt.email})` : ""}`
      : yt.oauthReady
        ? "OAuth Google prêt. Clique Connecter YouTube."
        : "Ajoute GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.",
    Boolean(yt.oauthReady)
  );

  setPlatformState(
    "tiktok",
    Boolean(tt.connected),
    tt.connected
      ? `Connecté${tt.displayName ? ` — ${tt.displayName}` : ""}${tt.openId ? ` · ${tt.openId}` : ""}`
      : tt.oauthReady
        ? "OAuth TikTok prêt. Clique Connecter TikTok (ou colle les tokens)."
        : "OAuth non configuré : utilise accessToken + openId manuellement.",
    Boolean(tt.oauthReady)
  );

  return status;
}

function handleOauthQueryParams() {
  const params = new URLSearchParams(window.location.search);
  const youtube = params.get("youtube");
  const tiktok = params.get("tiktok");
  const message = params.get("message") || "";

  if (youtube === "connected") showToast("YouTube connecté.", "ok");
  if (tiktok === "connected") showToast("TikTok connecté.", "ok");
  if (youtube === "error") showToast(`YouTube: ${message || "erreur OAuth"}`, "err");
  if (tiktok === "error") showToast(`TikTok: ${message || "erreur OAuth"}`, "err");

  if (youtube || tiktok) {
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, "", cleanUrl);
  }
}

function bindDropzone() {
  const zone = dom.dropzone;
  zone.addEventListener("click", () => dom.videoFile.click());
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("dragover");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("dragover");
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    dom.videoFile.files = transfer.files;
    dom.dropLabel.textContent = file.name;
  });
  dom.videoFile.addEventListener("change", () => {
    const file = dom.videoFile.files?.[0];
    dom.dropLabel.textContent = file ? file.name : "Déposer la vidéo générée";
  });
}

async function disconnect(platform) {
  await api(`/api/short-video/${platform}`, { method: "DELETE" });
  showToast(`${platform === "youtube" ? "YouTube" : "TikTok"} déconnecté.`, "ok");
  await refreshStatus();
}

async function saveTiktokManual() {
  const accessToken = dom.tiktokAccessToken.value.trim();
  const openId = dom.tiktokOpenId.value.trim();
  if (!accessToken || !openId) {
    showToast("Access token et openId requis.", "err");
    return;
  }
  await api("/api/short-video/tiktok/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessToken, openId })
  });
  dom.tiktokAccessToken.value = "";
  dom.tiktokOpenId.value = "";
  showToast("TikTok enregistré.", "ok");
  await refreshStatus();
}

async function publishShort(event) {
  event.preventDefault();
  const file = dom.videoFile.files?.[0] || null;
  const videoUrl = dom.videoUrl.value.trim();
  if (!file && !videoUrl) {
    showToast("Ajoute un fichier vidéo ou un lien.", "err");
    return;
  }
  if (!dom.publishYoutube.checked && !dom.publishTiktok.checked) {
    showToast("Coche YouTube et/ou TikTok.", "err");
    return;
  }

  const formData = new FormData();
  if (file) formData.append("video", file);
  if (videoUrl) formData.append("videoUrl", videoUrl);
  formData.append("title", dom.title.value.trim());
  formData.append("description", dom.description.value.trim());
  formData.append("hashtags", dom.hashtags.value.trim());
  formData.append("publishYoutube", String(dom.publishYoutube.checked));
  formData.append("publishTiktok", String(dom.publishTiktok.checked));
  formData.append("madeForKids", String(dom.madeForKids.checked));
  formData.append("youtubePrivacy", dom.youtubePrivacy.value);
  formData.append("tiktokPrivacy", dom.tiktokPrivacy.value);

  dom.publishBtn.disabled = true;
  dom.publishBtn.textContent = "Publication en cours…";
  dom.results.hidden = true;

  try {
    const payload = await api("/api/short-video/publish", {
      method: "POST",
      body: formData
    });
    const okCount = (payload.results || []).filter((r) => r.ok).length;
    const total = (payload.results || []).length;
    showToast(
      payload.ok
        ? `Publié sur ${okCount}/${total} plateforme(s).`
        : `Publication partielle: ${okCount}/${total}.`,
      payload.ok ? "ok" : "err"
    );
    dom.results.hidden = false;
    dom.results.textContent = JSON.stringify(payload.results, null, 2);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Publication échouée.", "err");
  } finally {
    dom.publishBtn.disabled = false;
    dom.publishBtn.textContent = "Publier sur YouTube + TikTok";
  }
}

function bindEvents() {
  dom.youtubeDisconnectBtn.addEventListener("click", () => disconnect("youtube"));
  dom.tiktokDisconnectBtn.addEventListener("click", () => disconnect("tiktok"));
  dom.tiktokManualSaveBtn.addEventListener("click", () => {
    saveTiktokManual().catch((error) => {
      showToast(error instanceof Error ? error.message : "Erreur TikTok.", "err");
    });
  });
  dom.publishForm.addEventListener("submit", (event) => {
    publishShort(event).catch((error) => {
      showToast(error instanceof Error ? error.message : "Erreur publication.", "err");
    });
  });
  bindDropzone();
}

async function init() {
  bindEvents();
  handleOauthQueryParams();
  try {
    await refreshStatus();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "API Short Video indisponible.", "err");
  }
}

init();
