const express = require("express");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const { spawn } = require("child_process");
const { isYtDlpAvailable, buildYtDlpArgs } = require("./ytdlp");

const GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const YOUTUBE_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";
const TIKTOK_AUTH_BASE = "https://www.tiktok.com/v2/auth/authorize/";
const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const TIKTOK_USER_INFO_URL = "https://open.tiktokapis.com/v2/user/info/";
const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";

const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "openid",
  "email",
  "profile"
].join(" ");

const TIKTOK_SCOPES = ["user.info.basic", "video.upload", "video.publish"].join(",");

function createShortVideoBridgeRouter(options = {}) {
  const storageDir = options.storageDir || path.join(process.cwd(), "storage");
  const secretsDir = path.join(storageDir, "secrets");
  const uploadsDir = path.join(storageDir, "uploads");
  const bridgeDir = path.join(storageDir, "short-video");
  const youtubeStorePath = path.join(secretsDir, "youtube-oauth.json");
  const tiktokStorePath = path.join(secretsDir, "tiktok-config.json");
  const oauthStatePath = path.join(secretsDir, "short-video-oauth-state.json");

  const googleClientId = String(process.env.GOOGLE_CLIENT_ID || process.env.YOUTUBE_CLIENT_ID || "").trim();
  const googleClientSecret = String(
    process.env.GOOGLE_CLIENT_SECRET || process.env.YOUTUBE_CLIENT_SECRET || ""
  ).trim();
  const tiktokClientKey = String(process.env.TIKTOK_CLIENT_KEY || process.env.TIKTOK_CLIENT_ID || "").trim();
  const tiktokClientSecret = String(process.env.TIKTOK_CLIENT_SECRET || "").trim();
  const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");

  const router = express.Router();
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadsDir),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || "").toLowerCase() || ".mp4";
        cb(null, `short-${Date.now()}-${uuidv4()}${ext}`);
      }
    }),
    limits: { fileSize: 500 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok =
        String(file.mimetype || "").startsWith("video/") ||
        /\.(mp4|mov|webm|mkv|m4v)$/i.test(file.originalname || "");
      cb(ok ? null : new Error("Fichier vidéo requis (mp4/mov/webm)."), ok);
    }
  });

  async function ensureBridgeDirs() {
    await fsp.mkdir(secretsDir, { recursive: true });
    await fsp.mkdir(uploadsDir, { recursive: true });
    await fsp.mkdir(bridgeDir, { recursive: true });
  }

  function getRequestBaseUrl(req) {
    if (publicBaseUrl) return publicBaseUrl;
    const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
    if (!host) return "";
    return `${proto}://${host}`;
  }

  async function readJsonSafe(filePath, fallback) {
    try {
      if (!fs.existsSync(filePath)) return fallback;
      const raw = await fsp.readFile(filePath, "utf8");
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  async function writeJsonSafe(filePath, data) {
    await ensureBridgeDirs();
    await fsp.writeFile(filePath, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
  }

  async function readOauthStates() {
    return readJsonSafe(oauthStatePath, {});
  }

  async function saveOauthState(state, payload) {
    const states = await readOauthStates();
    states[state] = { ...payload, createdAt: Date.now() };
    await writeJsonSafe(oauthStatePath, states);
  }

  async function consumeOauthState(state) {
    const states = await readOauthStates();
    const item = states[state];
    if (!item) return null;
    delete states[state];
    await writeJsonSafe(oauthStatePath, states);
    if (Date.now() - Number(item.createdAt || 0) > 15 * 60 * 1000) return null;
    return item;
  }

  async function getYoutubeAuth() {
    return readJsonSafe(youtubeStorePath, null);
  }

  async function saveYoutubeAuth(payload) {
    await writeJsonSafe(youtubeStorePath, {
      ...payload,
      updatedAt: new Date().toISOString()
    });
  }

  async function clearYoutubeAuth() {
    if (fs.existsSync(youtubeStorePath)) await fsp.unlink(youtubeStorePath);
  }

  async function getTiktokAuth() {
    return readJsonSafe(tiktokStorePath, null);
  }

  async function saveTiktokAuth(payload) {
    const existing = (await getTiktokAuth()) || {};
    await writeJsonSafe(tiktokStorePath, {
      ...existing,
      ...payload,
      updatedAt: new Date().toISOString()
    });
  }

  async function clearTiktokAuth() {
    if (fs.existsSync(tiktokStorePath)) await fsp.unlink(tiktokStorePath);
  }

  function hasYoutubeAuth(auth) {
    return Boolean(auth && (auth.accessToken || auth.refreshToken));
  }

  function hasTiktokAuth(auth) {
    return Boolean(auth && auth.accessToken && auth.openId);
  }

  async function refreshYoutubeAccessToken(auth) {
    if (!auth?.refreshToken) {
      throw new Error("Token YouTube expiré et refresh token manquant. Reconnecte YouTube.");
    }
    if (!googleClientId || !googleClientSecret) {
      throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET manquants sur le serveur.");
    }
    const body = new URLSearchParams({
      client_id: googleClientId,
      client_secret: googleClientSecret,
      refresh_token: auth.refreshToken,
      grant_type: "refresh_token"
    });
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    const json = await response.json();
    if (!response.ok || !json.access_token) {
      throw new Error(json.error_description || json.error || "Impossible de rafraîchir le token YouTube.");
    }
    const next = {
      ...auth,
      accessToken: json.access_token,
      expiresAt: Date.now() + Number(json.expires_in || 3600) * 1000,
      tokenType: json.token_type || "Bearer",
      scope: json.scope || auth.scope || ""
    };
    await saveYoutubeAuth(next);
    return next;
  }

  async function getValidYoutubeAuth() {
    let auth = await getYoutubeAuth();
    if (!hasYoutubeAuth(auth)) {
      throw new Error("Compte YouTube non connecté.");
    }
    const expiresAt = Number(auth.expiresAt || 0);
    if (!auth.accessToken || (expiresAt && Date.now() > expiresAt - 60_000)) {
      auth = await refreshYoutubeAccessToken(auth);
    }
    return auth;
  }

  async function refreshTiktokAccessToken(auth) {
    if (!auth?.refreshToken) {
      throw new Error("Token TikTok expiré. Reconnecte TikTok ou colle un nouvel access token.");
    }
    if (!tiktokClientKey || !tiktokClientSecret) {
      throw new Error("TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET manquants sur le serveur.");
    }
    const body = new URLSearchParams({
      client_key: tiktokClientKey,
      client_secret: tiktokClientSecret,
      grant_type: "refresh_token",
      refresh_token: auth.refreshToken
    });
    const response = await fetch(TIKTOK_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    const json = await response.json();
    const data = json.data || json;
    if (!response.ok || !data.access_token) {
      throw new Error(json.error_description || json.error || data.error || "Impossible de rafraîchir le token TikTok.");
    }
    const next = {
      ...auth,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || auth.refreshToken,
      openId: data.open_id || auth.openId,
      expiresAt: Date.now() + Number(data.expires_in || 86400) * 1000,
      scope: data.scope || auth.scope || ""
    };
    await saveTiktokAuth(next);
    return next;
  }

  async function getValidTiktokAuth() {
    let auth = await getTiktokAuth();
    if (!hasTiktokAuth(auth)) {
      throw new Error("Compte TikTok non connecté.");
    }
    const expiresAt = Number(auth.expiresAt || 0);
    if (expiresAt && Date.now() > expiresAt - 60_000) {
      auth = await refreshTiktokAccessToken(auth);
    }
    return auth;
  }

  function normalizePrivacy(value) {
    const allowed = new Set([
      "PUBLIC_TO_EVERYONE",
      "MUTUAL_FOLLOW_FRIENDS",
      "FOLLOWER_OF_CREATOR",
      "SELF_ONLY"
    ]);
    const normalized = String(value || "PUBLIC_TO_EVERYONE").trim().toUpperCase();
    return allowed.has(normalized) ? normalized : "PUBLIC_TO_EVERYONE";
  }

  function boolFrom(value, fallback = false) {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "boolean") return value;
    const str = String(value).toLowerCase();
    return str === "1" || str === "true" || str === "yes" || str === "on";
  }

  async function downloadDirectUrl(videoUrl, destinationPath) {
    const response = await fetch(videoUrl, {
      headers: { "User-Agent": "ClipForge-ShortVideoBridge/1.0" },
      redirect: "follow"
    });
    if (!response.ok) {
      throw new Error(`Téléchargement vidéo échoué (${response.status}).`);
    }
    const contentType = String(response.headers.get("content-type") || "");
    if (contentType && !contentType.includes("video") && !contentType.includes("octet-stream")) {
      // Allow some CDNs that omit content-type; reject obvious HTML pages.
      if (contentType.includes("text/html")) {
        throw new Error("Le lien ne pointe pas vers un fichier vidéo direct.");
      }
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 1024) {
      throw new Error("Fichier vidéo trop petit ou invalide.");
    }
    await fsp.writeFile(destinationPath, buffer);
    return destinationPath;
  }

  function runYtDlpDownload(videoUrl, destinationPath) {
    return new Promise((resolve, reject) => {
      if (!isYtDlpAvailable()) {
        reject(new Error("yt-dlp indisponible pour ce type de lien. Utilise un fichier ou un lien MP4 direct."));
        return;
      }
      let invocation;
      try {
        invocation = buildYtDlpArgs([
          videoUrl,
          "-o",
          destinationPath,
          "-f",
          "mp4/best/bestaudio",
          "--no-playlist",
          "--newline"
        ]);
      } catch (error) {
        reject(error);
        return;
      }
      const child = spawn(invocation.executable, invocation.args, {
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0 && fs.existsSync(destinationPath)) {
          resolve(destinationPath);
          return;
        }
        reject(new Error(stderr.slice(0, 400) || `yt-dlp a échoué (code ${code}).`));
      });
    });
  }

  function looksLikeDirectVideoUrl(value) {
    try {
      const url = new URL(value);
      return /\.(mp4|mov|webm|mkv|m4v)(\?|$)/i.test(url.pathname);
    } catch {
      return false;
    }
  }

  async function materializeVideoSource({ filePath, videoUrl }) {
    await ensureBridgeDirs();
    if (filePath && fs.existsSync(filePath)) {
      return { localPath: filePath, cleanup: false };
    }
    const url = String(videoUrl || "").trim();
    if (!url) {
      throw new Error("Fournis un fichier vidéo ou un lien vidéo.");
    }
    const localPath = path.join(bridgeDir, `source-${Date.now()}-${uuidv4()}.mp4`);
    if (looksLikeDirectVideoUrl(url)) {
      await downloadDirectUrl(url, localPath);
    } else {
      try {
        await downloadDirectUrl(url, localPath);
      } catch (directError) {
        try {
          await runYtDlpDownload(url, localPath);
        } catch (ytdlpError) {
          const directMsg = directError instanceof Error ? directError.message : "échec direct";
          const ytdlpMsg = ytdlpError instanceof Error ? ytdlpError.message : "échec yt-dlp";
          throw new Error(`Impossible de récupérer la vidéo. Direct: ${directMsg} | yt-dlp: ${ytdlpMsg}`);
        }
      }
    }
    return { localPath, cleanup: true };
  }

  async function uploadToYouTube({ localPath, title, description, tags, madeForKids, privacyStatus }) {
    const auth = await getValidYoutubeAuth();
    const stats = await fsp.stat(localPath);
    const snippet = {
      title: String(title || "Short Video").slice(0, 100),
      description: String(description || "").slice(0, 5000),
      tags: Array.isArray(tags) ? tags.slice(0, 15) : [],
      categoryId: "22"
    };
    const status = {
      privacyStatus: ["public", "unlisted", "private"].includes(privacyStatus) ? privacyStatus : "public",
      selfDeclaredMadeForKids: Boolean(madeForKids),
      short: true
    };

    const initResponse = await fetch(`${YOUTUBE_UPLOAD_URL}?uploadType=resumable&part=snippet,status`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(stats.size),
        "X-Upload-Content-Type": "video/mp4"
      },
      body: JSON.stringify({ snippet, status })
    });
    if (!initResponse.ok) {
      const errText = await initResponse.text();
      throw new Error(`YouTube init upload échoué (${initResponse.status}): ${errText.slice(0, 300)}`);
    }
    const uploadUrl = initResponse.headers.get("location");
    if (!uploadUrl) {
      throw new Error("YouTube n'a pas renvoyé d'URL d'upload résumable.");
    }

    const fileBuffer = await fsp.readFile(localPath);
    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "Content-Type": "video/mp4",
        "Content-Length": String(stats.size)
      },
      body: fileBuffer
    });
    const uploadJson = await uploadResponse.json().catch(() => ({}));
    if (!uploadResponse.ok) {
      throw new Error(
        uploadJson?.error?.message ||
          `Upload YouTube échoué (${uploadResponse.status}).`
      );
    }

    const videoId = String(uploadJson.id || "").trim();
    return {
      platform: "youtube",
      ok: true,
      videoId,
      url: videoId ? `https://youtube.com/shorts/${videoId}` : "",
      title: uploadJson?.snippet?.title || snippet.title
    };
  }

  async function tiktokApiRequest(endpoint, accessToken, bodyPayload) {
    const response = await fetch(`${TIKTOK_API_BASE}${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8"
      },
      body: JSON.stringify(bodyPayload)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.error?.code) {
      const message =
        json?.error?.message ||
        json?.message ||
        `TikTok API error ${response.status}`;
      throw new Error(message);
    }
    return json;
  }

  async function waitForTiktokPublish(accessToken, publishId, timeoutMs = 180000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const statusPayload = await tiktokApiRequest("/post/publish/status/fetch/", accessToken, {
        publish_id: publishId
      });
      const status = String(statusPayload?.data?.status || "").toUpperCase();
      if (status === "PUBLISH_COMPLETE" || status === "SEND_TO_USER_INBOX") {
        return statusPayload.data;
      }
      if (status === "FAILED") {
        throw new Error(statusPayload?.data?.fail_reason || "Publication TikTok échouée.");
      }
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    throw new Error("Timeout en attendant la publication TikTok.");
  }

  async function uploadToTikTok({ localPath, title, privacyLevel, disableComment }) {
    const auth = await getValidTiktokAuth();
    const stats = await fsp.stat(localPath);
    const initPayload = {
      post_info: {
        title: String(title || "Short Video").slice(0, 2200),
        privacy_level: normalizePrivacy(privacyLevel),
        disable_comment: Boolean(disableComment),
        disable_duet: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 1000
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: stats.size,
        chunk_size: stats.size,
        total_chunk_count: 1
      }
    };
    const initRes = await tiktokApiRequest("/post/publish/video/init/", auth.accessToken, initPayload);
    const publishId = String(initRes?.data?.publish_id || "").trim();
    const uploadUrl = String(initRes?.data?.upload_url || "").trim();
    if (!publishId || !uploadUrl) {
      throw new Error("TikTok n'a pas renvoyé publish_id / upload_url.");
    }

    const fileBuffer = await fsp.readFile(localPath);
    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(stats.size),
        "Content-Range": `bytes 0-${stats.size - 1}/${stats.size}`
      },
      body: fileBuffer
    });
    if (!uploadResponse.ok) {
      const text = await uploadResponse.text();
      throw new Error(`Upload fichier TikTok échoué (${uploadResponse.status}): ${text.slice(0, 200)}`);
    }

    const publishState = await waitForTiktokPublish(auth.accessToken, publishId);
    return {
      platform: "tiktok",
      ok: true,
      publishId,
      status: publishState?.status || "PUBLISH_COMPLETE",
      url: ""
    };
  }

  router.get("/status", async (_req, res) => {
    const youtube = await getYoutubeAuth();
    const tiktok = await getTiktokAuth();
    return res.json({
      youtube: {
        connected: hasYoutubeAuth(youtube),
        email: youtube?.email || "",
        channelTitle: youtube?.channelTitle || "",
        oauthReady: Boolean(googleClientId && googleClientSecret),
        expiresAt: youtube?.expiresAt || null
      },
      tiktok: {
        connected: hasTiktokAuth(tiktok),
        openId: tiktok?.openId ? `${String(tiktok.openId).slice(0, 6)}…` : "",
        displayName: tiktok?.displayName || "",
        oauthReady: Boolean(tiktokClientKey && tiktokClientSecret),
        expiresAt: tiktok?.expiresAt || null
      },
      publicBaseUrlConfigured: Boolean(publicBaseUrl)
    });
  });

  router.get("/youtube/connect", async (req, res) => {
    try {
      if (!googleClientId || !googleClientSecret) {
        return res.status(503).json({
          error:
            "Configure GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET (OAuth Google Cloud avec YouTube Data API v3)."
        });
      }
      const baseUrl = getRequestBaseUrl(req);
      if (!baseUrl) {
        return res.status(400).json({ error: "Impossible de déterminer l'URL publique. Définis PUBLIC_BASE_URL." });
      }
      const state = crypto.randomBytes(16).toString("hex");
      await saveOauthState(state, { provider: "youtube" });
      const redirectUri = `${baseUrl}/api/short-video/youtube/callback`;
      const params = new URLSearchParams({
        client_id: googleClientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: YOUTUBE_SCOPES,
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
        state
      });
      return res.redirect(`${GOOGLE_AUTH_BASE}?${params.toString()}`);
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Impossible de démarrer OAuth YouTube."
      });
    }
  });

  router.get("/youtube/callback", async (req, res) => {
    try {
      const code = String(req.query.code || "").trim();
      const state = String(req.query.state || "").trim();
      const oauthError = String(req.query.error || "").trim();
      if (oauthError) {
        return res.redirect(`/short-video?youtube=error&message=${encodeURIComponent(oauthError)}`);
      }
      const statePayload = await consumeOauthState(state);
      if (!code || !statePayload || statePayload.provider !== "youtube") {
        return res.redirect("/short-video?youtube=error&message=state_invalide");
      }
      const baseUrl = getRequestBaseUrl(req);
      const redirectUri = `${baseUrl}/api/short-video/youtube/callback`;
      const body = new URLSearchParams({
        code,
        client_id: googleClientId,
        client_secret: googleClientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      });
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body
      });
      const tokenJson = await tokenRes.json();
      if (!tokenRes.ok || !tokenJson.access_token) {
        throw new Error(tokenJson.error_description || tokenJson.error || "Échange code YouTube échoué.");
      }

      let email = "";
      let channelTitle = "";
      try {
        const userRes = await fetch(GOOGLE_USERINFO_URL, {
          headers: { Authorization: `Bearer ${tokenJson.access_token}` }
        });
        if (userRes.ok) {
          const userJson = await userRes.json();
          email = String(userJson.email || "");
        }
      } catch {
        // optional
      }
      try {
        const channelsRes = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
          headers: { Authorization: `Bearer ${tokenJson.access_token}` }
        });
        if (channelsRes.ok) {
          const channelsJson = await channelsRes.json();
          channelTitle = String(channelsJson?.items?.[0]?.snippet?.title || "");
        }
      } catch {
        // optional
      }

      await saveYoutubeAuth({
        accessToken: tokenJson.access_token,
        refreshToken: tokenJson.refresh_token || (await getYoutubeAuth())?.refreshToken || "",
        expiresAt: Date.now() + Number(tokenJson.expires_in || 3600) * 1000,
        tokenType: tokenJson.token_type || "Bearer",
        scope: tokenJson.scope || YOUTUBE_SCOPES,
        email,
        channelTitle
      });
      return res.redirect("/short-video?youtube=connected");
    } catch (error) {
      const message = error instanceof Error ? error.message : "callback_youtube_echoue";
      return res.redirect(`/short-video?youtube=error&message=${encodeURIComponent(message)}`);
    }
  });

  router.delete("/youtube", async (_req, res) => {
    try {
      await clearYoutubeAuth();
      return res.json({ ok: true, connected: false });
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Impossible de déconnecter YouTube."
      });
    }
  });

  router.get("/tiktok/connect", async (req, res) => {
    try {
      if (!tiktokClientKey || !tiktokClientSecret) {
        return res.status(503).json({
          error:
            "Configure TIKTOK_CLIENT_KEY et TIKTOK_CLIENT_SECRET, ou colle manuellement accessToken + openId."
        });
      }
      const baseUrl = getRequestBaseUrl(req);
      if (!baseUrl) {
        return res.status(400).json({ error: "Impossible de déterminer l'URL publique. Définis PUBLIC_BASE_URL." });
      }
      const state = crypto.randomBytes(16).toString("hex");
      await saveOauthState(state, { provider: "tiktok" });
      const redirectUri = `${baseUrl}/api/short-video/tiktok/callback`;
      const params = new URLSearchParams({
        client_key: tiktokClientKey,
        response_type: "code",
        scope: TIKTOK_SCOPES,
        redirect_uri: redirectUri,
        state
      });
      return res.redirect(`${TIKTOK_AUTH_BASE}?${params.toString()}`);
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Impossible de démarrer OAuth TikTok."
      });
    }
  });

  router.get("/tiktok/callback", async (req, res) => {
    try {
      const code = String(req.query.code || "").trim();
      const state = String(req.query.state || "").trim();
      const oauthError = String(req.query.error || "").trim();
      if (oauthError) {
        return res.redirect(`/short-video?tiktok=error&message=${encodeURIComponent(oauthError)}`);
      }
      const statePayload = await consumeOauthState(state);
      if (!code || !statePayload || statePayload.provider !== "tiktok") {
        return res.redirect("/short-video?tiktok=error&message=state_invalide");
      }
      const baseUrl = getRequestBaseUrl(req);
      const redirectUri = `${baseUrl}/api/short-video/tiktok/callback`;
      const body = new URLSearchParams({
        client_key: tiktokClientKey,
        client_secret: tiktokClientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri
      });
      const tokenRes = await fetch(TIKTOK_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body
      });
      const tokenJson = await tokenRes.json();
      const data = tokenJson.data || tokenJson;
      if (!tokenRes.ok || !data.access_token) {
        throw new Error(
          tokenJson.error_description || tokenJson.error || data.error || "Échange code TikTok échoué."
        );
      }

      let displayName = "";
      try {
        const userRes = await fetch(
          `${TIKTOK_USER_INFO_URL}?fields=display_name,avatar_url,open_id`,
          { headers: { Authorization: `Bearer ${data.access_token}` } }
        );
        if (userRes.ok) {
          const userJson = await userRes.json();
          displayName = String(userJson?.data?.user?.display_name || "");
        }
      } catch {
        // optional
      }

      await saveTiktokAuth({
        accessToken: data.access_token,
        refreshToken: data.refresh_token || "",
        openId: data.open_id || "",
        expiresAt: Date.now() + Number(data.expires_in || 86400) * 1000,
        scope: data.scope || TIKTOK_SCOPES,
        displayName,
        defaultPrivacyLevel: "PUBLIC_TO_EVERYONE",
        publishSource: "file",
        defaultHashtags: ""
      });
      return res.redirect("/short-video?tiktok=connected");
    } catch (error) {
      const message = error instanceof Error ? error.message : "callback_tiktok_echoue";
      return res.redirect(`/short-video?tiktok=error&message=${encodeURIComponent(message)}`);
    }
  });

  router.post("/tiktok/manual", async (req, res) => {
    try {
      const accessToken = String(req.body.accessToken || "").trim();
      const openId = String(req.body.openId || "").trim();
      if (!accessToken || !openId) {
        return res.status(400).json({ error: "accessToken et openId sont requis." });
      }
      await saveTiktokAuth({
        accessToken,
        openId,
        refreshToken: String(req.body.refreshToken || "").trim(),
        expiresAt: req.body.expiresAt ? Number(req.body.expiresAt) : null,
        displayName: String(req.body.displayName || "").trim(),
        defaultPrivacyLevel: normalizePrivacy(req.body.defaultPrivacyLevel || "PUBLIC_TO_EVERYONE"),
        publishSource: "file",
        defaultHashtags: String(req.body.defaultHashtags || "").trim()
      });
      return res.status(201).json({ ok: true, connected: true });
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Impossible d'enregistrer TikTok."
      });
    }
  });

  router.delete("/tiktok", async (_req, res) => {
    try {
      await clearTiktokAuth();
      return res.json({ ok: true, connected: false });
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Impossible de déconnecter TikTok."
      });
    }
  });

  router.post("/publish", upload.single("video"), async (req, res) => {
    let materialized = null;
    try {
      await ensureBridgeDirs();
      const title = String(req.body.title || "").trim() || "Short Video";
      const description = String(req.body.description || "").trim();
      const hashtagsRaw = String(req.body.hashtags || "").trim();
      const tags = hashtagsRaw
        .split(/[\s,#]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const publishYoutube = boolFrom(req.body.publishYoutube, true);
      const publishTiktok = boolFrom(req.body.publishTiktok, true);
      const madeForKids = boolFrom(req.body.madeForKids, true);
      const youtubePrivacy = String(req.body.youtubePrivacy || "public").toLowerCase();
      const tiktokPrivacy = normalizePrivacy(req.body.tiktokPrivacy || "PUBLIC_TO_EVERYONE");
      const disableComment = boolFrom(req.body.disableComment, false);
      const videoUrl = String(req.body.videoUrl || "").trim();

      if (!publishYoutube && !publishTiktok) {
        return res.status(400).json({ error: "Sélectionne au moins YouTube ou TikTok." });
      }
      if (publishYoutube) {
        const yt = await getYoutubeAuth();
        if (!hasYoutubeAuth(yt)) {
          return res.status(400).json({ error: "Connecte d'abord ton compte YouTube." });
        }
      }
      if (publishTiktok) {
        const tt = await getTiktokAuth();
        if (!hasTiktokAuth(tt)) {
          return res.status(400).json({ error: "Connecte d'abord ton compte TikTok." });
        }
      }

      materialized = await materializeVideoSource({
        filePath: req.file?.path || "",
        videoUrl
      });

      const captionWithTags = [title, tags.map((t) => `#${t.replace(/^#/, "")}`).join(" ")]
        .filter(Boolean)
        .join(" ")
        .trim();

      const tasks = [];
      if (publishYoutube) {
        tasks.push(
          uploadToYouTube({
            localPath: materialized.localPath,
            title,
            description: [description, tags.map((t) => `#${t.replace(/^#/, "")}`).join(" ")]
              .filter(Boolean)
              .join("\n\n"),
            tags,
            madeForKids,
            privacyStatus: youtubePrivacy
          }).then((result) => result)
            .catch((error) => ({
              platform: "youtube",
              ok: false,
              error: error instanceof Error ? error.message : "Échec YouTube"
            }))
        );
      }
      if (publishTiktok) {
        tasks.push(
          uploadToTikTok({
            localPath: materialized.localPath,
            title: captionWithTags,
            privacyLevel: tiktokPrivacy,
            disableComment
          }).then((result) => result)
            .catch((error) => ({
              platform: "tiktok",
              ok: false,
              error: error instanceof Error ? error.message : "Échec TikTok"
            }))
        );
      }

      const results = await Promise.all(tasks);
      const allOk = results.every((r) => r.ok);
      return res.status(allOk ? 200 : 207).json({
        ok: allOk,
        title,
        results
      });
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Publication impossible."
      });
    } finally {
      if (materialized?.cleanup && materialized.localPath && fs.existsSync(materialized.localPath)) {
        fsp.unlink(materialized.localPath).catch(() => {});
      }
      if (req.file?.path && fs.existsSync(req.file.path)) {
        // Keep uploaded source briefly for debugging retries? Prefer cleanup.
        fsp.unlink(req.file.path).catch(() => {});
      }
    }
  });

  return router;
}

module.exports = { createShortVideoBridgeRouter };
