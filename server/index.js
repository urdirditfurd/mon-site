const cors = require("cors");
const express = require("express");
const archiver = require("archiver");
const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");
const fs = require("fs");
const fsp = require("fs/promises");
const multer = require("multer");
const path = require("path");
const { spawn, spawnSync, execSync } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const ROOT_DIR = path.resolve(__dirname, "..");
const STORAGE_DIR = path.join(ROOT_DIR, "storage");
const UPLOADS_DIR = path.join(STORAGE_DIR, "uploads");
const JOBS_DIR = path.join(STORAGE_DIR, "jobs");
const SECRETS_DIR = path.join(STORAGE_DIR, "secrets");
const JOBS_DB_FILE = path.join(STORAGE_DIR, "jobs-db.json");
const YOUTUBE_COOKIES_STORE_PATH = path.join(SECRETS_DIR, "youtube-cookies.txt");
const PORT = Number(process.env.PORT) || 3000;
const WORKER_CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 2);
const QUEUE_MODE = (process.env.QUEUE_MODE || "auto").toLowerCase();
const REDIS_URL = process.env.REDIS_URL || "";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase() || ".mp4";
      cb(null, `${Date.now()}-${uuidv4()}${ext}`);
    }
  }),
  limits: { fileSize: 900 * 1024 * 1024 }
});

const jobs = new Map();
const pendingJobIds = [];
let activeMemoryJobs = 0;
let queueModeRuntime = "memory";
let redisConnection = null;
let bullQueue = null;
let bullWorker = null;
let ffmpegReady = true;
let whisperAvailable = false;
let ytDlpAvailable = false;
let edgeTtsAvailable = false;

const DEFAULTS = {
  clipDuration: 30,
  clipsCount: 4,
  minGap: 3,
  aspectRatio: "9:16",
  languageMode: "translate-to-french",
  subtitleTheme: "classic",
  highlightMode: "balanced",
  includeAutoTranscript: false,
  dubFrenchAudio: true,
  autoDubVoiceBySpeaker: true,
  includeSrtInZip: true,
  burnSubtitles: false
};

function normalizeYouTubeErrorMessage(rawMessage) {
  const message = String(rawMessage || "");
  if (message.includes("Sign in to confirm you") && message.includes("not a bot")) {
    return "YouTube a demandé une vérification anti-bot. Ajoute les cookies YouTube dans le champ dédié (format Netscape) puis relance.";
  }
  if (message.includes("Video unavailable")) {
    return "La vidéo YouTube est indisponible (privée, supprimée, géo-restreinte, ou inaccessible anonymement).";
  }
  return message;
}

async function ensureDirs() {
  await fsp.mkdir(UPLOADS_DIR, { recursive: true });
  await fsp.mkdir(JOBS_DIR, { recursive: true });
  await fsp.mkdir(SECRETS_DIR, { recursive: true });
}

function boolFrom(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const str = String(value).toLowerCase();
  return str === "1" || str === "true" || str === "yes" || str === "on";
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getJobDir(jobId) {
  return path.join(JOBS_DIR, jobId);
}

function getJobPlanPath(jobId) {
  return path.join(getJobDir(jobId), "plan.json");
}

function getJobSrtPath(jobId, clipId) {
  return path.join(getJobDir(jobId), `${clipId}.srt`);
}

function getJobCaptionsBurnPath(jobId, clipId) {
  return path.join(getJobDir(jobId), `${clipId}-captions.mp4`);
}

function asPublicJobSnapshot(job) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    originalFilename: job.originalFilename,
    sourceType: job.sourceType || "upload",
    sourceUrl: job.sourceUrl || "",
    youtubeCookiesFilePath: job.youtubeCookiesFilePath || "",
    inputPath: job.inputPath,
    duration: job.duration || 0,
    params: job.params || {},
    error: job.error || null,
    autoTranscriptUsed: !!job.autoTranscriptUsed,
    clips: (job.clips || []).map((clip) => ({
      id: clip.id,
      title: clip.title,
      start: clip.start,
      end: clip.end,
      duration: clip.duration,
      score: clip.score,
      filePath: clip.filePath,
      dubbedAudioPath: clip.dubbedAudioPath || null,
      dubVoice: clip.dubVoice || null,
      burnedFilePath: clip.burnedFilePath || null,
      aspectRatio: clip.aspectRatio || null,
      captions: clip.captions || []
    }))
  };
}

async function persistJobsDb() {
  const list = Array.from(jobs.values()).map(asPublicJobSnapshot);
  await fsp.writeFile(JOBS_DB_FILE, JSON.stringify(list, null, 2), "utf8");
}

async function restoreJobsDb() {
  if (!fs.existsSync(JOBS_DB_FILE)) return;
  try {
    const raw = await fsp.readFile(JOBS_DB_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    parsed.forEach((job) => {
      if (!job || !job.id) return;
      const normalized = {
        ...job,
        status: ["queued", "processing", "completed", "failed"].includes(job.status) ? job.status : "failed",
        progress: Number.isFinite(job.progress) ? job.progress : 0,
        clips: Array.isArray(job.clips) ? job.clips : [],
        params: job.params || {},
        duration: Number.isFinite(job.duration) ? job.duration : 0
      };
      if (normalized.status === "processing" || normalized.status === "queued") {
        normalized.status = "failed";
        normalized.error = normalized.error || "Interruption serveur pendant traitement";
        normalized.progress = 100;
      }
      jobs.set(normalized.id, normalized);
    });
  } catch (_error) {
    // ignore invalid persisted file
  }
}

function checkBinary(binaryName, testArg = "-version") {
  const result = spawnSync(binaryName, [testArg], { stdio: "ignore" });
  return result.status === 0;
}

function resolveYtDlpBinary() {
  if (checkBinary("yt-dlp", "--version")) return "yt-dlp";
  try {
    const candidate = execSync("python3 -m site --user-base", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (candidate) {
      const localBin = path.join(candidate, "bin", "yt-dlp");
      if (fs.existsSync(localBin)) return localBin;
    }
  } catch (_error) {
    // ignore
  }
  const fallback = path.join(process.env.HOME || "", ".local", "bin", "yt-dlp");
  if (fallback && fs.existsSync(fallback)) return fallback;
  return "yt-dlp";
}

function checkPythonModule(moduleName, testArgs = ["--version"]) {
  const result = spawnSync("python3", ["-m", moduleName, ...testArgs], { stdio: "ignore" });
  return result.status === 0;
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

function isLikelyYouTubeUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.includes("youtube.com") || host.includes("youtu.be");
  } catch (_error) {
    return false;
  }
}

function normalizeCookieBoolean(value, fallback = "FALSE") {
  const upper = String(value || "").trim().toUpperCase();
  if (upper === "TRUE" || upper === "1" || upper === "YES") return "TRUE";
  if (upper === "FALSE" || upper === "0" || upper === "NO") return "FALSE";
  return fallback;
}

function normalizeCookieExpiry(value) {
  const num = Number(value);
  if (Number.isFinite(num) && num >= 0) return String(Math.floor(num));
  return "2147483647";
}

function toNetscapeCookieLineFromObject(cookie) {
  const name = String(cookie?.name || "").trim();
  if (!name) return "";
  const value = cookie?.value == null ? "" : String(cookie.value);
  const rawDomain = String(cookie?.domain || ".youtube.com").trim();
  const domain = rawDomain
    ? rawDomain.startsWith(".")
      ? rawDomain
      : `.${rawDomain}`
    : ".youtube.com";
  const includeSubdomains = cookie?.hostOnly === true ? "FALSE" : "TRUE";
  const pathValue = String(cookie?.path || "/").trim() || "/";
  const secure = cookie?.secure ? "TRUE" : "FALSE";
  const expiry = normalizeCookieExpiry(
    cookie?.expirationDate ?? cookie?.expires ?? cookie?.expiry ?? cookie?.expire ?? 2147483647
  );
  return `${domain}\t${includeSubdomains}\t${pathValue}\t${secure}\t${expiry}\t${name}\t${value}`;
}

function parseCookiesJson(rawText) {
  const trimmed = String(rawText || "").trim();
  if (!trimmed) return "";
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return "";

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (_error) {
    return "";
  }

  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.cookies)
      ? parsed.cookies
      : Array.isArray(parsed?.data)
        ? parsed.data
        : null;

  if (!Array.isArray(list)) {
    return "";
  }

  const lines = list
    .map((cookie) => toNetscapeCookieLineFromObject(cookie))
    .filter(Boolean);

  if (!lines.length) {
    throw new Error("Le JSON de cookies est valide, mais aucun cookie exploitable n'a été trouvé.");
  }

  return `# Netscape HTTP Cookie File\n${lines.join("\n")}\n`;
}

function parseCookiesHeaderString(rawText) {
  const trimmed = String(rawText || "").trim();
  if (!trimmed || trimmed.includes("\n")) return "";
  if (!trimmed.includes("=") || trimmed.includes("\t")) return "";

  const parts = trimmed
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) return "";

  const lines = [];
  for (const part of parts) {
    const eqIndex = part.indexOf("=");
    if (eqIndex <= 0) continue;
    const name = part.slice(0, eqIndex).trim();
    const value = part.slice(eqIndex + 1).trim();
    if (!name) continue;
    lines.push(`.youtube.com\tTRUE\t/\tTRUE\t2147483647\t${name}\t${value}`);
  }

  if (!lines.length) {
    throw new Error("Format de cookies invalide.");
  }

  return `# Netscape HTTP Cookie File\n${lines.join("\n")}\n`;
}

function parseNetscapeCookies(rawText) {
  const input = String(rawText || "").trim();
  if (!input) {
    throw new Error("Cookies YouTube vides.");
  }

  const outLines = ["# Netscape HTTP Cookie File"];
  const lines = input.split(/\r?\n/);
  let hasCookieLine = false;

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#HttpOnly_")) {
      line = line.replace(/^#HttpOnly_/, "");
    } else if (line.startsWith("#")) {
      continue;
    }

    let parts = line.split("\t").filter((p) => p !== "");
    if (parts.length < 7) {
      parts = line.split(/\s+/).filter(Boolean);
    }

    if (parts.length < 7) {
      // Fallback tolérant: accepte une ligne "name=value" ou "name=value; other=x"
      // pour aider quand l'export n'est pas strictement au format Netscape.
      const cookiePairs = line
        .split(";")
        .map((chunk) => chunk.trim())
        .filter(Boolean);

      let foundLoosePair = false;
      for (const pair of cookiePairs) {
        const eqIndex = pair.indexOf("=");
        if (eqIndex <= 0) continue;
        const name = pair.slice(0, eqIndex).trim();
        const value = pair.slice(eqIndex + 1).trim();
        if (!name) continue;
        outLines.push(`.youtube.com\tTRUE\t/\tTRUE\t2147483647\t${name}\t${value}`);
        hasCookieLine = true;
        foundLoosePair = true;
      }

      if (foundLoosePair) {
        continue;
      }
      // Ignore les lignes non interprétables (au lieu d'échouer tout le fichier).
      continue;
    }

    const [domainRaw, includeRaw, pathRaw, secureRaw, expiryRaw, nameRaw, ...valueParts] = parts;
    const domain = String(domainRaw || "").trim();
    const name = String(nameRaw || "").trim();
    if (!domain || !name) {
      throw new Error("Une ligne de cookie est incomplète (domain ou name manquant).");
    }
    const value = valueParts.join(" ");
    const include = normalizeCookieBoolean(includeRaw, domain.startsWith(".") ? "TRUE" : "FALSE");
    const pathValue = String(pathRaw || "/").trim() || "/";
    const secure = normalizeCookieBoolean(secureRaw, "FALSE");
    const expiry = normalizeCookieExpiry(expiryRaw);
    outLines.push(`${domain}\t${include}\t${pathValue}\t${secure}\t${expiry}\t${name}\t${value}`);
    hasCookieLine = true;
  }

  if (!hasCookieLine) {
    throw new Error(
      "Aucune ligne de cookie valide détectée. Utilise de préférence un export Netscape (cookies.txt) ou une chaîne du type NAME=VALUE; NAME2=VALUE2."
    );
  }

  return `${outLines.join("\n")}\n`;
}

function normalizeYouTubeCookies(rawCookies) {
  const rawText = String(rawCookies || "").trim();
  if (!rawText) {
    throw new Error("Cookies YouTube vides.");
  }
  const asJson = parseCookiesJson(rawText);
  if (asJson) return asJson;
  const asHeader = parseCookiesHeaderString(rawText);
  if (asHeader) return asHeader;
  return parseNetscapeCookies(rawText);
}

function getStoredYoutubeCookiesMeta() {
  if (!fs.existsSync(YOUTUBE_COOKIES_STORE_PATH)) {
    return {
      configured: false,
      sizeBytes: 0,
      updatedAt: null
    };
  }
  const stats = fs.statSync(YOUTUBE_COOKIES_STORE_PATH);
  return {
    configured: true,
    sizeBytes: stats.size,
    updatedAt: stats.mtime.toISOString()
  };
}

function hasStoredYoutubeCookies() {
  return fs.existsSync(YOUTUBE_COOKIES_STORE_PATH);
}

function parseSubtitleTimestamp(raw) {
  const cleaned = String(raw || "").trim().replace(",", ".");
  const parts = cleaned.split(":").map((part) => part.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  const [hoursRaw, minutesRaw, secondsRaw] =
    parts.length === 3 ? parts : ["0", parts[0], parts[1]];
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  const seconds = Number(secondsRaw);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function stripSubtitleMarkup(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\{\\[^}]+\}/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSrtCaptions(content) {
  const blocks = String(content || "")
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const out = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) continue;
    const timeLine = lines.find((line) => line.includes("-->"));
    if (!timeLine) continue;
    const [startRaw, endRaw] = timeLine.split("-->").map((x) => x.trim());
    const start = parseSubtitleTimestamp(startRaw);
    const end = parseSubtitleTimestamp(endRaw);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const textLines = lines.slice(lines.indexOf(timeLine) + 1);
    const text = stripSubtitleMarkup(textLines.join(" "));
    if (!text) continue;
    out.push({ start, end, text });
  }
  return out;
}

function parseVttCaptions(content) {
  const lines = String(content || "").replace(/\r/g, "").split("\n");
  const out = [];
  let idx = 0;
  while (idx < lines.length) {
    const line = lines[idx].trim();
    if (!line || line.startsWith("WEBVTT") || line.startsWith("NOTE")) {
      idx += 1;
      continue;
    }
    if (!line.includes("-->")) {
      idx += 1;
      continue;
    }
    const [startRaw, endRaw] = line.split("-->").map((part) => part.trim().split(" ")[0]);
    const start = parseSubtitleTimestamp(startRaw);
    const end = parseSubtitleTimestamp(endRaw);
    idx += 1;
    const textLines = [];
    while (idx < lines.length && lines[idx].trim()) {
      textLines.push(lines[idx].trim());
      idx += 1;
    }
    const text = stripSubtitleMarkup(textLines.join(" "));
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && text) {
      out.push({ start, end, text });
    }
  }
  return out;
}

async function parseSubtitleFileToTimedCaptions(subtitlePath) {
  if (!subtitlePath || !fs.existsSync(subtitlePath)) return [];
  const raw = await fsp.readFile(subtitlePath, "utf8");
  const ext = path.extname(subtitlePath).toLowerCase();
  if (ext === ".srt") return parseSrtCaptions(raw);
  if (ext === ".vtt") return parseVttCaptions(raw);
  return parseSrtCaptions(raw);
}

function buildCaptionsFromSourceTimedCaptions(clipStart, clipEnd, timedCaptions) {
  const localCaptions = [];
  for (const cue of timedCaptions || []) {
    const overlapStart = Math.max(clipStart, cue.start);
    const overlapEnd = Math.min(clipEnd, cue.end);
    if (overlapEnd <= overlapStart) continue;
    const text = stripSubtitleMarkup(cue.text);
    if (!text) continue;
    localCaptions.push({
      start: Number((overlapStart - clipStart).toFixed(3)),
      end: Number((overlapEnd - clipStart).toFixed(3)),
      text
    });
  }
  return localCaptions;
}

function buildDubTextFromCaptions(captions) {
  return (captions || [])
    .map((cue) => stripSubtitleMarkup(cue.text))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function detectLikelyFrenchVoiceForClip(inputClipPath) {
  const maleVoice = process.env.EDGE_TTS_DEFAULT_MALE_VOICE || "fr-FR-HenriNeural";
  const femaleVoice = process.env.EDGE_TTS_DEFAULT_FEMALE_VOICE || "fr-FR-DeniseNeural";
  const threshold = Number(process.env.EDGE_TTS_GENDER_ZCR_THRESHOLD) || 0.095;
  if (!inputClipPath || !fs.existsSync(inputClipPath)) return maleVoice;

  try {
    const { stderr } = await runCommandCapture("ffmpeg", [
      "-hide_banner",
      "-i",
      inputClipPath,
      "-af",
      "astats=metadata=1:reset=1",
      "-f",
      "null",
      "-"
    ]);

    const matches = Array.from(String(stderr || "").matchAll(/Zero crossings rate:\s*([0-9.]+)/gi));
    const values = matches
      .map((match) => Number(match[1]))
      .filter((value) => Number.isFinite(value) && value > 0);

    if (!values.length) return maleVoice;
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    return avg >= threshold ? femaleVoice : maleVoice;
  } catch (_error) {
    return maleVoice;
  }
}

async function synthesizeFrenchSpeech(text, outputAudioPath, preferredVoice = "") {
  const spokenText = String(text || "").replace(/\s+/g, " ").trim();
  if (!spokenText) return false;
  const trimmed = spokenText.length > 1500 ? spokenText.slice(0, 1500) : spokenText;
  const selectedVoice =
    preferredVoice || process.env.EDGE_TTS_VOICE || process.env.EDGE_TTS_DEFAULT_MALE_VOICE || "fr-FR-HenriNeural";
  await runCommand("python3", [
    "-m",
    "edge_tts",
    "--voice",
    selectedVoice,
    "--text",
    trimmed,
    "--write-media",
    outputAudioPath
  ]);
  return fs.existsSync(outputAudioPath);
}

async function replaceClipAudioWithFrenchDub(inputClipPath, dubAudioPath, outputClipPath) {
  await runCommand("ffmpeg", [
    "-y",
    "-i",
    inputClipPath,
    "-stream_loop",
    "-1",
    "-i",
    dubAudioPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-shortest",
    outputClipPath
  ]);
}

function tokenizeTranscript(transcript) {
  return String(transcript || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => w.trim())
    .filter(Boolean);
}

const VIRAL_KEYWORDS = new Set([
  "choc",
  "incroyable",
  "secret",
  "erreur",
  "danger",
  "risque",
  "urgent",
  "revele",
  "explose",
  "cash",
  "million",
  "milliard",
  "guerre",
  "attaque",
  "strategie",
  "preuve",
  "comment",
  "pourquoi",
  "top",
  "viral",
  "buzz",
  "impact",
  "grave",
  "impossible"
]);

const INTRO_OUTRO_PROMO_KEYWORDS = new Set([
  "subscribe",
  "sub",
  "abonne",
  "abonnezvous",
  "abonnement",
  "follow",
  "suivez",
  "like",
  "partage",
  "partagez",
  "creator",
  "createur",
  "createurs",
  "credits",
  "credit",
  "sponsor",
  "sponsoris",
  "sponsored",
  "instagram",
  "insta",
  "tiktok",
  "youtube",
  "snapchat"
]);

function normalizeScoringToken(rawToken) {
  return String(rawToken || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function tokenizeForScoring(text) {
  return String(text || "")
    .split(/\s+/)
    .map((token) => normalizeScoringToken(token))
    .filter(Boolean);
}

function jaccardSetSimilarity(setA, setB) {
  if (!setA.size && !setB.size) return 0;
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  for (const token of setA) {
    if (setB.has(token)) inter += 1;
  }
  const union = setA.size + setB.size - inter;
  return union > 0 ? inter / union : 0;
}

function buildClipTitleFromText(text, index) {
  const clean = stripSubtitleMarkup(text);
  if (!clean) return `Clip ${index + 1}`;
  const words = clean.split(/\s+/).filter(Boolean).slice(0, 11);
  const short = words.join(" ");
  if (!short) return `Clip ${index + 1}`;
  return short.length > 80 ? `${short.slice(0, 77)}...` : short;
}

function scoreWindowFromTimedCaptions(windowStart, windowEnd, timedCaptions, clipDuration, mode, duration) {
  const texts = [];
  let coveredSeconds = 0;
  for (const cue of timedCaptions || []) {
    const overlapStart = Math.max(windowStart, cue.start);
    const overlapEnd = Math.min(windowEnd, cue.end);
    if (overlapEnd <= overlapStart) continue;
    coveredSeconds += overlapEnd - overlapStart;
    const text = stripSubtitleMarkup(cue.text);
    if (text) texts.push(text);
  }

  const mergedText = texts.join(" ").replace(/\s+/g, " ").trim();
  const tokens = tokenizeForScoring(mergedText);
  const tokenSet = new Set(tokens);
  const hookHits = tokens.reduce((sum, token) => sum + (VIRAL_KEYWORDS.has(token) ? 1 : 0), 0);
  const promoHits = tokens.reduce((sum, token) => sum + (INTRO_OUTRO_PROMO_KEYWORDS.has(token) ? 1 : 0), 0);
  const punctuationHits = (mergedText.match(/[!?]/g) || []).length;
  const numericHits = (mergedText.match(/\d+/g) || []).length;
  const socialTagHits = (mergedText.match(/[@#][\w.-]+/g) || []).length;
  const density = Math.min(1, tokens.length / Math.max(8, clipDuration * 2.6));
  const information = Math.min(1, tokenSet.size / Math.max(1, tokens.length || 1));
  const hook = Math.min(1, (hookHits * 0.22 + punctuationHits * 0.12 + numericHits * 0.1) / 1.2);
  const coverage = Math.min(1, coveredSeconds / Math.max(1, clipDuration));
  const centerTime = (windowStart + windowEnd) / 2;
  const energy = highlightScore(centerTime, duration, mode);
  const promoPenalty = Math.min(0.34, promoHits * 0.045 + socialTagHits * 0.07);

  let score = density * 0.22 + information * 0.16 + hook * 0.28 + coverage * 0.14 + energy * 0.2 - promoPenalty;
  const earlyBias = 1 - centerTime / Math.max(duration, 1);
  if (mode === "hook-first") score += earlyBias * 0.12;
  if (mode === "viral") score += hook * 0.08 + Math.min(1, density * 1.2) * 0.06;
  if (mode === "balanced") score += information * 0.06;

  return {
    score: Number(score.toFixed(4)),
    tokenSet,
    text: mergedText
  };
}

function mockEnergyAtTime(time, duration) {
  const x = time / Math.max(duration, 1);
  const base = 0.45 + 0.2 * Math.sin(x * Math.PI * 8);
  const randomSpike = (Math.sin(x * 62.3) + Math.sin(x * 22.1)) * 0.08;
  return Math.max(0, Math.min(1, base + randomSpike));
}

function highlightScore(momentTime, duration, mode) {
  const energy = mockEnergyAtTime(momentTime, duration);
  const earlyBias = 1 - momentTime / Math.max(duration, 1);
  const lateBias = 1 - earlyBias;
  if (mode === "hook-first") return energy * 0.7 + earlyBias * 0.3;
  if (mode === "viral") return energy * 0.85 + Math.abs(0.5 - lateBias) * 0.15;
  return energy;
}

function generateCandidateMoments(duration, step, mode) {
  const out = [];
  for (let t = 0; t < duration; t += step) {
    out.push({ t, score: highlightScore(t, duration, mode) });
  }
  return out.sort((a, b) => b.score - a.score);
}

function computeBoundaryGuards(duration, clipDuration) {
  const maxStart = Math.max(0, duration - clipDuration);
  if (maxStart <= 0) return { maxStart, introGuardSec: 0, outroGuardSec: 0, preferredMinStart: 0, preferredMaxStart: 0 };

  // Keep clips away from generic intros/outros while preserving room for long clips.
  const introGuardSec = Math.min(maxStart, Math.max(0, Math.min(60, duration * 0.12, clipDuration * 0.8)));
  const outroGuardSec = Math.min(maxStart, Math.max(0, Math.min(45, duration * 0.08, clipDuration * 0.65)));
  const preferredMinStart = introGuardSec;
  const preferredMaxStart = Math.max(preferredMinStart, maxStart - outroGuardSec);
  return { maxStart, introGuardSec, outroGuardSec, preferredMinStart, preferredMaxStart };
}

function selectBestClips(duration, clipDuration, clipsCount, minGapSec, mode, timedCaptions = []) {
  const { maxStart, preferredMinStart, preferredMaxStart } = computeBoundaryGuards(duration, clipDuration);
  const step = Math.max(2, Math.min(7, clipDuration * 0.4));
  const moments = generateCandidateMoments(duration, step, mode);
  const candidates = moments.map((moment) => {
    let start = Math.max(0, moment.t - clipDuration * 0.18);
    start = Math.min(start, maxStart);
    const end = Math.min(duration, start + clipDuration);
    const timed = scoreWindowFromTimedCaptions(start, end, timedCaptions, clipDuration, mode, duration);
    const fallbackText = "";
    const title = buildClipTitleFromText(timed.text || fallbackText, 0);
    const baseScore = timed.tokenSet.size > 0 ? timed.score : Number(moment.score.toFixed(4));
    const beforePreferred = Math.max(0, preferredMinStart - start);
    const afterPreferred = Math.max(0, start - preferredMaxStart);
    const boundaryPenalty = Math.min(0.45, beforePreferred / Math.max(1, clipDuration) * 0.42 + afterPreferred / Math.max(1, clipDuration) * 0.28);
    const combinedScore = Number(Math.max(0, baseScore - boundaryPenalty).toFixed(4));
    return {
      start,
      end,
      duration: end - start,
      score: combinedScore,
      title,
      tokenSet: timed.tokenSet
    };
  });

  candidates.sort((a, b) => b.score - a.score);
  const chosen = [];

  const hasConflict = (candidate) =>
    chosen.some((clip) => {
      const inter = Math.max(0, Math.min(clip.end, candidate.end) - Math.max(clip.start, candidate.start));
      if (inter > clipDuration * 0.28) return true;
      const distance = Math.min(
        Math.abs(clip.start - candidate.start),
        Math.abs(clip.end - candidate.end),
        Math.abs(clip.start - candidate.end),
        Math.abs(clip.end - candidate.start)
      );
      if (distance < minGapSec) return true;
      const similarity = jaccardSetSimilarity(clip.tokenSet || new Set(), candidate.tokenSet || new Set());
      if ((clip.tokenSet || new Set()).size === 0 || (candidate.tokenSet || new Set()).size === 0) return false;
      return similarity > 0.62;
    });

  for (const candidate of candidates) {
    if (!hasConflict(candidate)) {
      chosen.push(candidate);
      if (chosen.length >= clipsCount) break;
    }
  }

  if (chosen.length < clipsCount) {
    for (let i = 0; i < clipsCount; i += 1) {
      const ratio = clipsCount === 1 ? 0 : i / (clipsCount - 1);
      const fallbackSpan = Math.max(0, preferredMaxStart - preferredMinStart);
      const start = Number((preferredMinStart + fallbackSpan * ratio).toFixed(3));
      const end = Math.min(duration, start + clipDuration);
      const fallback = {
        start,
        end,
        duration: end - start,
        score: Number(highlightScore(start, duration, mode).toFixed(3)),
        title: buildClipTitleFromText("", i),
        tokenSet: new Set()
      };
      if (!hasConflict(fallback)) {
        chosen.push(fallback);
      }
      if (chosen.length >= clipsCount) break;
    }
  }

  if (!chosen.length) {
    const safeStart = Math.min(Math.max(0, preferredMinStart), maxStart);
    chosen.push({
      start: safeStart,
      end: Math.min(duration, safeStart + clipDuration),
      duration: Math.min(duration, clipDuration),
      score: 0.5,
      title: "Clip 1",
      tokenSet: new Set()
    });
  }

  return chosen
    .sort((a, b) => a.start - b.start)
    .slice(0, clipsCount)
    .map((clip, idx) => ({
      id: `clip-${idx + 1}`,
      title: clip.title || `Clip ${idx + 1}`,
      start: clip.start,
      end: clip.end,
      duration: clip.duration,
      score: Number(clip.score.toFixed(3))
    }));
}

function splitIntoSubtitleChunks(words, minWords = 4, maxWords = 10) {
  const chunks = [];
  let cursor = 0;
  while (cursor < words.length) {
    const size = minWords + Math.floor(Math.random() * (maxWords - minWords + 1));
    const part = words.slice(cursor, cursor + size);
    if (!part.length) break;
    chunks.push(part.join(" "));
    cursor += size;
  }
  return chunks;
}

function segmentTranscriptForClips(transcript, clips) {
  const words = tokenizeTranscript(transcript);
  if (!words.length) return clips.map(() => "");
  const durationTotal = clips.reduce((acc, clip) => acc + clip.duration, 0) || 1;
  const segments = [];
  let assigned = 0;
  clips.forEach((clip, idx) => {
    const ratio = clip.duration / durationTotal;
    let count = Math.round(words.length * ratio);
    if (idx === clips.length - 1) count = words.length - assigned;
    count = Math.max(0, count);
    segments.push(words.slice(assigned, assigned + count).join(" "));
    assigned += count;
  });
  return segments;
}

function buildCaptionsForClip(clipDuration, clipText) {
  const words = tokenizeTranscript(clipText);
  if (!words.length) return [];
  const chunks = splitIntoSubtitleChunks(words);
  const perChunk = clipDuration / chunks.length;
  return chunks.map((text, idx) => {
    const start = perChunk * idx;
    const end = idx === chunks.length - 1 ? clipDuration : perChunk * (idx + 1);
    return { start: Number(start.toFixed(3)), end: Number(end.toFixed(3)), text };
  });
}

function resolveOutputDimensions(aspectRatio) {
  if (aspectRatio === "1:1") return { width: 1080, height: 1080 };
  if (aspectRatio === "16:9") return { width: 1280, height: 720 };
  return { width: 1080, height: 1920 };
}

function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (buf) => {
      stderr += String(buf);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve();
      return reject(new Error(stderr || `${cmd} exited with code ${code}`));
    });
  });
}

function runCommandCapture(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (buf) => {
      stdout += String(buf);
    });
    child.stderr.on("data", (buf) => {
      stderr += String(buf);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      return reject(new Error(stderr || `${cmd} exited with code ${code}`));
    });
  });
}

async function isPlayableVideoFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  try {
    await ffprobeDuration(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function resolveDownloadedVideoByPrefix(prefixPath) {
  const dir = path.dirname(prefixPath);
  const base = path.basename(prefixPath);
  const entries = await fsp.readdir(dir);
  const matches = entries
    .filter((name) => name === base || name.startsWith(`${base}.`))
    .map((name) => path.join(dir, name));

  if (!matches.length) {
    throw new Error("Téléchargement terminé mais fichier introuvable");
  }

  const ranked = matches.sort((a, b) => {
    const extA = path.extname(a).toLowerCase();
    const extB = path.extname(b).toLowerCase();
    if (extA === ".mp4" && extB !== ".mp4") return -1;
    if (extB === ".mp4" && extA !== ".mp4") return 1;
    return 0;
  });

  return ranked[0];
}

async function cleanupDownloadedArtifactsByPrefix(prefixPath) {
  const dir = path.dirname(prefixPath);
  const base = path.basename(prefixPath);
  if (!fs.existsSync(dir)) return;
  const entries = await fsp.readdir(dir);
  const matches = entries.filter((name) => name === base || name.startsWith(`${base}.`));
  await Promise.all(
    matches.map(async (name) => {
      try {
        await fsp.unlink(path.join(dir, name));
      } catch (_error) {
        // ignore cleanup failures
      }
    })
  );
}

async function resolveDownloadedSubtitleByPrefix(prefixPath) {
  const dir = path.dirname(prefixPath);
  const base = path.basename(prefixPath);
  if (!fs.existsSync(dir)) return null;
  const entries = await fsp.readdir(dir);
  const candidates = entries
    .filter((name) => name.startsWith(`${base}.`) && (name.endsWith(".srt") || name.endsWith(".vtt")))
    .map((name) => path.join(dir, name));
  if (!candidates.length) return null;

  const scoreCandidate = (candidatePath) => {
    const file = path.basename(candidatePath).toLowerCase();
    let score = 0;
    if (file.includes(".fr")) score += 100;
    if (file.includes(".fr-fr")) score += 10;
    if (file.endsWith(".srt")) score += 5;
    if (file.includes(".en")) score += 1;
    return score;
  };

  const ordered = candidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  return ordered[0];
}

async function downloadVideoFromUrl(sourceUrl, outputPrefix) {
  const downloadOptions = arguments[2] || {};
  const ytCookiesFile = downloadOptions.ytCookiesFile || "";
  const subtitlesPrefix = downloadOptions.subtitlesPrefix || `${outputPrefix}-subs`;
  const ytExtractorArgs =
    process.env.YTDLP_EXTRACTOR_ARGS ||
    (ytCookiesFile
      ? "youtube:player_client=web,web_embedded,tv,ios"
      : "youtube:player_client=web,web_embedded,tv,ios,android");
  const ytUserAgent =
    process.env.YTDLP_USER_AGENT ||
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

  const runYtDlpDownloadProfiles = async () => {
    if (!ytDlpAvailable) return null;
    const template = `${outputPrefix}.%(ext)s`;
    const commonArgs = [
      "-m",
      "yt_dlp",
      "--no-playlist",
      "--no-progress",
      "--restrict-filenames",
      "--extractor-retries",
      "3",
      "--retries",
      "3",
      "--fragment-retries",
      "3",
      "--extractor-args",
      ytExtractorArgs,
      "--user-agent",
      ytUserAgent,
      "--js-runtimes",
      "node",
      "--remote-components",
      "ejs:github",
      "--merge-output-format",
      "mp4",
      "-o",
      template
    ];
    if (ytCookiesFile) commonArgs.push("--cookies", ytCookiesFile);

    const profiles = [
      // Preferred: explicit mp4-compatible muxing.
      ["-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best"],
      // Wider fallback for difficult videos.
      ["-f", "bestvideo*+bestaudio/best"],
      // Last resort without format constraints.
      []
    ];

    let lastError = null;
    for (const profileArgs of profiles) {
      try {
        await cleanupDownloadedArtifactsByPrefix(outputPrefix);
        const args = [...commonArgs, ...profileArgs, sourceUrl];
        await runCommand("python3", args);
        const downloaded = await resolveDownloadedVideoByPrefix(outputPrefix);
        if (await isPlayableVideoFile(downloaded)) return downloaded;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Impossible de télécharger la vidéo via yt-dlp");
  };

  const tryYtDlpSubtitleDownload = async () => {
    if (!ytDlpAvailable || !isLikelyYouTubeUrl(sourceUrl)) return null;
    const template = `${subtitlesPrefix}.%(ext)s`;
    await cleanupDownloadedArtifactsByPrefix(subtitlesPrefix);
    const args = [
      "-m",
      "yt_dlp",
      "--skip-download",
      "--no-playlist",
      "--no-progress",
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs",
      process.env.YTDLP_SUB_LANGS || "fr.*,fr,en.*,en",
      "--sub-format",
      "srt/vtt/best",
      "--convert-subs",
      "srt",
      "--extractor-args",
      ytExtractorArgs,
      "--js-runtimes",
      "node",
      "--remote-components",
      "ejs:github",
      "--user-agent",
      ytUserAgent,
      "-o",
      template
    ];
    if (ytCookiesFile) args.push("--cookies", ytCookiesFile);
    try {
      await runCommand("python3", args.concat([sourceUrl]));
    } catch (_error) {
      return null;
    }
    return resolveDownloadedSubtitleByPrefix(subtitlesPrefix);
  };

  if (isLikelyYouTubeUrl(sourceUrl)) {
    if (!ytDlpAvailable) {
      throw new Error("Lien YouTube détecté mais yt-dlp est indisponible sur le serveur");
    }
    const ytFile = await runYtDlpDownloadProfiles();
    if (await isPlayableVideoFile(ytFile)) {
      const subtitlePath = await tryYtDlpSubtitleDownload();
      return { videoPath: ytFile, subtitlePath: subtitlePath || "" };
    }
    throw new Error("Impossible de télécharger une vidéo YouTube exploitable");
  }

  // For generic URLs, attempt yt-dlp first when available.
  if (ytDlpAvailable) {
    try {
      const ytFile = await runYtDlpDownloadProfiles();
      if (await isPlayableVideoFile(ytFile)) return { videoPath: ytFile, subtitlePath: "" };
    } catch (_ytError) {
      // Fallback below.
    }
  }

  const outputPath = `${outputPrefix}.mp4`;

  try {
    await runCommand("ffmpeg", [
      "-y",
      "-rw_timeout",
      "15000000",
      "-reconnect",
      "1",
      "-reconnect_streamed",
      "1",
      "-reconnect_delay_max",
      "2",
      "-i",
      sourceUrl,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputPath
    ]);
    if (await isPlayableVideoFile(outputPath)) return { videoPath: outputPath, subtitlePath: "" };
  } catch (_copyErr) {
    // Fallback below.
  }

  await runCommand("ffmpeg", [
    "-y",
    "-rw_timeout",
    "15000000",
    "-reconnect",
    "1",
    "-reconnect_streamed",
    "1",
    "-reconnect_delay_max",
    "2",
    "-i",
    sourceUrl,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "22",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outputPath
  ]);
  if (await isPlayableVideoFile(outputPath)) return { videoPath: outputPath, subtitlePath: "" };
  throw new Error("Téléchargement URL réussi mais fichier vidéo invalide");
}

function isManagedDownloadedInput(inputPath) {
  if (!inputPath) return false;
  const normalized = path.resolve(inputPath);
  return normalized.startsWith(path.resolve(UPLOADS_DIR));
}

function ffprobeDuration(inputPath) {
  return new Promise((resolve, reject) => {
    const args = ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", inputPath];
    const child = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let stderr = "";
    child.stdout.on("data", (buf) => {
      output += String(buf);
    });
    child.stderr.on("data", (buf) => {
      stderr += String(buf);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr || "ffprobe failed"));
      const duration = Number.parseFloat(output.trim());
      if (!Number.isFinite(duration) || duration <= 0) return reject(new Error("Unable to detect video duration"));
      return resolve(duration);
    });
  });
}

async function renderClipFile(inputPath, outputPath, clipStart, clipDuration, aspectRatio) {
  const { width, height } = resolveOutputDimensions(aspectRatio);
  const vf = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
    "format=yuv420p"
  ].join(",");
  const args = [
    "-y",
    "-ss",
    String(clipStart),
    "-t",
    String(clipDuration),
    "-i",
    inputPath,
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "22",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    outputPath
  ];
  await runCommand("ffmpeg", args);
}

function formatSrtTimestamp(seconds) {
  const ms = Math.max(0, Math.floor(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(milli).padStart(3, "0")}`;
}

function captionsToSrt(captions) {
  return captions
    .map((cue, idx) => `${idx + 1}\n${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(cue.end)}\n${cue.text}\n`)
    .join("\n");
}

function subtitleForceStyle(theme) {
  if (theme === "bold") return "Fontname=Arial,Fontsize=22,PrimaryColour=&H00FFFFFF&,BackColour=&H90000000&,Bold=1";
  if (theme === "cinema") return "Fontname=Georgia,Fontsize=24,PrimaryColour=&H00F0F0F0&,BackColour=&H70000000&,Outline=2";
  if (theme === "neon") return "Fontname=Arial,Fontsize=22,PrimaryColour=&H00FFFF00&,OutlineColour=&H00000000&,Outline=3";
  return "Fontname=Arial,Fontsize=20,PrimaryColour=&H00FFFFFF&,BackColour=&H80000000&";
}

async function burnCaptionsIntoClip(inputClipPath, srtPath, outputPath, theme) {
  const escapedSrt = srtPath.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
  const args = [
    "-y",
    "-i",
    inputClipPath,
    "-vf",
    `subtitles='${escapedSrt}':force_style='${subtitleForceStyle(theme)}'`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "22",
    "-c:a",
    "copy",
    outputPath
  ];
  await runCommand("ffmpeg", args);
}

async function transcribeVideoMaybe(inputPath, duration, includeAutoTranscript) {
  if (!includeAutoTranscript) return { transcript: "", autoTranscriptUsed: false };
  if (whisperAvailable) {
    const outDir = path.join(STORAGE_DIR, "uploads");
    const model = process.env.WHISPER_MODEL || "base";
    const language = process.env.WHISPER_LANGUAGE || "fr";
    const whisperArgs = [
      inputPath,
      "--model",
      model,
      "--language",
      language,
      "--output_format",
      "txt",
      "--output_dir",
      outDir,
      "--fp16",
      "False",
      "--verbose",
      "False"
    ];

    try {
      await runCommand("whisper", whisperArgs);
      const transcriptPath = path.join(outDir, `${path.parse(inputPath).name}.txt`);
      if (fs.existsSync(transcriptPath)) {
        const raw = await fsp.readFile(transcriptPath, "utf8");
        const cleaned = raw.replace(/\s+/g, " ").trim();
        if (cleaned.length > 20) {
          return { transcript: cleaned, autoTranscriptUsed: true };
        }
      }
    } catch (_error) {
      // fallback below
    }
  }
  // Avoid fake transcripts that can create nonsensical captions.
  return { transcript: "", autoTranscriptUsed: false };
}

function sanitizeJobForClient(job) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    autoTranscriptUsed: !!job.autoTranscriptUsed,
    source: {
      filename: job.originalFilename,
      duration: job.duration,
      type: job.sourceType || "upload",
      url: job.sourceUrl || ""
    },
    params: job.params,
    clips: (job.clips || []).map((clip) => ({
      id: clip.id,
      title: clip.title,
      start: clip.start,
      end: clip.end,
      duration: clip.duration,
      score: clip.score,
      aspectRatio: clip.aspectRatio || job.params?.aspectRatio || DEFAULTS.aspectRatio,
      hasBurnedSubtitles: Boolean(clip.burnedFilePath),
      hasDubbedAudio: Boolean(clip.dubbedAudioPath),
      dubVoice: clip.dubVoice || "",
      streamUrl: `/api/jobs/${job.id}/clips/${clip.id}/stream`,
      downloadUrl: `/api/jobs/${job.id}/clips/${clip.id}/download`,
      srtUrl: `/api/jobs/${job.id}/clips/${clip.id}/srt`,
      captions: clip.captions
    }))
  };
}

async function failJob(job, err) {
  job.status = "failed";
  job.progress = 100;
  job.error = err instanceof Error ? err.message : String(err);
  job.updatedAt = new Date().toISOString();
  await persistJobsDb();
}

async function processJobById(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  try {
    await processJob(job);
  } catch (err) {
    await failJob(job, err);
  }
}

function pumpMemoryQueue() {
  while (activeMemoryJobs < WORKER_CONCURRENCY && pendingJobIds.length > 0) {
    const nextJobId = pendingJobIds.shift();
    activeMemoryJobs += 1;
    void processJobById(nextJobId).finally(() => {
      activeMemoryJobs = Math.max(0, activeMemoryJobs - 1);
      pumpMemoryQueue();
    });
  }
}

function enqueueMemoryJob(jobId) {
  pendingJobIds.push(jobId);
  pumpMemoryQueue();
}

async function initBullQueue() {
  const shouldUseBullmq =
    (QUEUE_MODE === "bullmq" || QUEUE_MODE === "auto") &&
    Boolean(REDIS_URL);

  if (!shouldUseBullmq) {
    queueModeRuntime = "memory";
    return;
  }

  try {
    redisConnection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true
    });
    bullQueue = new Queue("clipforge-jobs", { connection: redisConnection });
    bullWorker = new Worker(
      "clipforge-jobs",
      async (job) => {
        await processJobById(String(job.data.jobId || ""));
      },
      {
        connection: redisConnection,
        concurrency: WORKER_CONCURRENCY
      }
    );
    bullWorker.on("failed", async (job, err) => {
      const candidateId = String(job?.data?.jobId || "");
      const model = jobs.get(candidateId);
      if (model && model.status !== "completed") {
        await failJob(model, err);
      }
    });
    queueModeRuntime = "bullmq";
  } catch (_error) {
    queueModeRuntime = "memory";
    bullQueue = null;
    bullWorker = null;
    if (redisConnection) {
      try {
        redisConnection.disconnect();
      } catch (_e) {
        // ignore
      }
      redisConnection = null;
    }
  }
}

async function enqueueJob(jobId) {
  if (queueModeRuntime === "bullmq" && bullQueue) {
    await bullQueue.add("process", { jobId }, { removeOnComplete: 200, removeOnFail: 200 });
    return;
  }
  enqueueMemoryJob(jobId);
}

async function readQueueStats() {
  if (queueModeRuntime === "bullmq" && bullQueue) {
    const [waiting, active, delayed] = await Promise.all([
      bullQueue.getWaitingCount(),
      bullQueue.getActiveCount(),
      bullQueue.getDelayedCount()
    ]);
    return { waiting, active, delayed };
  }
  return { waiting: pendingJobIds.length, active: activeMemoryJobs, delayed: 0 };
}

async function processJob(job) {
  job.status = "processing";
  job.progress = 5;
  job.updatedAt = new Date().toISOString();
  if (job.params?.dubFrenchAudio && !edgeTtsAvailable) {
    job.params.dubFrenchAudio = false;
  }
  await persistJobsDb();
  const jobDir = getJobDir(job.id);
  await fsp.mkdir(jobDir, { recursive: true });

  if (!job.inputPath && job.sourceUrl) {
    if (!isValidHttpUrl(job.sourceUrl)) {
      throw new Error("URL vidéo invalide");
    }
    job.progress = 10;
    job.updatedAt = new Date().toISOString();
    await persistJobsDb();

    const outputPrefix = path.join(UPLOADS_DIR, `${job.id}-source`);
    const ytCookiesFile =
      job.youtubeCookiesFilePath && fs.existsSync(job.youtubeCookiesFilePath)
        ? job.youtubeCookiesFilePath
        : "";
    let downloaded;
    try {
      downloaded = await downloadVideoFromUrl(job.sourceUrl, outputPrefix, {
        ytCookiesFile,
        subtitlesPrefix: path.join(jobDir, "source-subs")
      });
    } catch (downloadErr) {
      throw new Error(normalizeYouTubeErrorMessage(downloadErr instanceof Error ? downloadErr.message : String(downloadErr)));
    }
    job.inputPath = downloaded.videoPath;
    job.sourceSubtitlePath = downloaded.subtitlePath || "";
    if (!job.originalFilename) {
      job.originalFilename = path.basename(downloaded.videoPath);
    }
    job.progress = 14;
    job.updatedAt = new Date().toISOString();
    await persistJobsDb();
  }

  if (!job.inputPath) {
    throw new Error("Aucune source vidéo disponible pour ce job");
  }

  const duration = await ffprobeDuration(job.inputPath);
  job.duration = Number(duration.toFixed(3));
  job.progress = 15;
  job.updatedAt = new Date().toISOString();

  let sourceTimedCaptions = [];
  if (job.sourceSubtitlePath) {
    try {
      sourceTimedCaptions = await parseSubtitleFileToTimedCaptions(job.sourceSubtitlePath);
    } catch (_error) {
      sourceTimedCaptions = [];
    }
  }

  if (!job.params.transcript && job.params.includeAutoTranscript) {
    const generated = await transcribeVideoMaybe(job.inputPath, duration, true);
    job.params.transcript = generated.transcript;
    job.autoTranscriptUsed = generated.autoTranscriptUsed;
  }

  let effectiveClipDuration = job.params.clipDuration;
  const uniquenessBudget = duration / Math.max(1, job.params.clipsCount);
  const isLongClipRequest = job.params.clipDuration >= 120;
  if (!isLongClipRequest && uniquenessBudget < job.params.clipDuration * 0.9) {
    effectiveClipDuration = Math.max(8, Math.floor(uniquenessBudget * 0.92));
  }
  job.params.effectiveClipDuration = effectiveClipDuration;

  const clips = selectBestClips(
    duration,
    effectiveClipDuration,
    job.params.clipsCount,
    job.params.minGapSecBetweenClips,
    job.params.highlightMode,
    sourceTimedCaptions
  );
  const transcriptParts = segmentTranscriptForClips(job.params.transcript, clips);
  if (!job.params.transcript && sourceTimedCaptions.length) {
    job.params.transcript = sourceTimedCaptions.map((cue) => cue.text).join(" ");
  }
  job.progress = 25;
  job.updatedAt = new Date().toISOString();
  await persistJobsDb();

  const total = clips.length || 1;
  const rendered = [];
  for (let i = 0; i < clips.length; i += 1) {
    const clip = clips[i];
    const outputPath = path.join(jobDir, `${clip.id}.mp4`);
    const timedCaptionsForClip = sourceTimedCaptions.length
      ? buildCaptionsFromSourceTimedCaptions(clip.start, clip.end, sourceTimedCaptions)
      : [];
    const captions =
      timedCaptionsForClip.length > 0 ? timedCaptionsForClip : buildCaptionsForClip(clip.duration, transcriptParts[i] || "");
    const srtPath = getJobSrtPath(job.id, clip.id);
    await renderClipFile(job.inputPath, outputPath, clip.start, clip.duration, job.params.aspectRatio);
    await fsp.writeFile(srtPath, captionsToSrt(captions), "utf8");

    let finalClipPath = outputPath;
    let dubbedAudioPath = "";
    if (job.params.dubFrenchAudio && edgeTtsAvailable) {
      const dubText = buildDubTextFromCaptions(captions);
      if (dubText) {
        const ttsPath = path.join(jobDir, `${clip.id}-fr-tts.mp3`);
        const dubbedPath = path.join(jobDir, `${clip.id}-fr-dub.mp4`);
        try {
          const detectedVoice = boolFrom(job.params.autoDubVoiceBySpeaker, DEFAULTS.autoDubVoiceBySpeaker)
            ? await detectLikelyFrenchVoiceForClip(outputPath)
            : process.env.EDGE_TTS_VOICE || process.env.EDGE_TTS_DEFAULT_MALE_VOICE || "fr-FR-HenriNeural";
          const hasTtsAudio = await synthesizeFrenchSpeech(dubText, ttsPath, detectedVoice);
          if (hasTtsAudio) {
            await replaceClipAudioWithFrenchDub(outputPath, ttsPath, dubbedPath);
            finalClipPath = dubbedPath;
            dubbedAudioPath = ttsPath;
            clip.dubVoice = detectedVoice;
          }
        } catch (_error) {
          finalClipPath = outputPath;
          dubbedAudioPath = "";
        }
      }
    }

    let burnedFilePath = null;
    if (job.params.burnSubtitles) {
      const burnPath = getJobCaptionsBurnPath(job.id, clip.id);
      try {
        await burnCaptionsIntoClip(finalClipPath, srtPath, burnPath, job.params.subtitleTheme);
        burnedFilePath = burnPath;
      } catch (_error) {
        burnedFilePath = null;
      }
    }

    rendered.push({
      ...clip,
      filePath: finalClipPath,
      dubbedAudioPath,
      dubVoice: clip.dubVoice || "",
      burnedFilePath,
      srtPath,
      captions,
      aspectRatio: job.params.aspectRatio
    });
    job.progress = Math.round(25 + ((i + 1) / total) * 70);
    job.updatedAt = new Date().toISOString();
    await persistJobsDb();
  }

  job.clips = rendered;
  const plan = {
    id: job.id,
    createdAt: job.createdAt,
    source: { filename: job.originalFilename, duration: job.duration },
    params: job.params,
    autoTranscriptUsed: !!job.autoTranscriptUsed,
    clips: rendered.map((clip) => ({
      id: clip.id,
      title: clip.title,
      start: clip.start,
      end: clip.end,
      duration: clip.duration,
      score: clip.score,
      captions: clip.captions
    }))
  };
  await fsp.writeFile(getJobPlanPath(job.id), JSON.stringify(plan, null, 2), "utf8");

  job.status = "completed";
  job.progress = 100;
  job.updatedAt = new Date().toISOString();
  await persistJobsDb();
}

app.get("/api/health", async (_req, res) => {
  const q = await readQueueStats();
  const cookiesMeta = getStoredYoutubeCookiesMeta();
  res.json({
    ok: true,
    ffmpeg: ffmpegReady,
    whisperAvailable,
    ytDlpAvailable,
    edgeTtsAvailable,
    youtubeCookiesConfigured: cookiesMeta.configured,
    queueMode: queueModeRuntime,
    workerConcurrency: WORKER_CONCURRENCY,
    queueSize: q.waiting,
    processing: q.active > 0,
    queue: q
  });
});

app.get("/api/config", (_req, res) => {
  const cookiesMeta = getStoredYoutubeCookiesMeta();
  res.json({
    defaults: DEFAULTS,
    queue: {
      mode: queueModeRuntime,
      workerConcurrency: WORKER_CONCURRENCY
    },
    capabilities: {
      ffmpeg: ffmpegReady,
      whisperAvailable,
      ytDlpAvailable,
      edgeTtsAvailable,
      urlIngestion: true,
      youtubeIngestion: ytDlpAvailable,
      youtubeCookiesPersistence: true,
      dubFrenchAudio: edgeTtsAvailable,
      srt: true,
      zip: true,
      burnSubtitles: true
    },
    youtubeCookies: cookiesMeta
  });
});

app.get("/api/youtube-cookies/status", (_req, res) => {
  const meta = getStoredYoutubeCookiesMeta();
  return res.json(meta);
});

app.post("/api/youtube-cookies", async (req, res) => {
  const rawCookies = String(req.body.youtubeCookies || "");
  if (!rawCookies.trim()) {
    return res.status(400).json({ error: "Le champ youtubeCookies est requis." });
  }

  try {
    const normalizedCookies = normalizeYouTubeCookies(rawCookies);
    await fsp.mkdir(SECRETS_DIR, { recursive: true });
    await fsp.writeFile(YOUTUBE_COOKIES_STORE_PATH, normalizedCookies, { encoding: "utf8", mode: 0o600 });
    const meta = getStoredYoutubeCookiesMeta();
    return res.status(201).json({
      ok: true,
      message: "Cookies YouTube enregistrés sur le serveur.",
      ...meta
    });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Format de cookies invalide."
    });
  }
});

app.delete("/api/youtube-cookies", async (_req, res) => {
  try {
    if (hasStoredYoutubeCookies()) {
      await fsp.unlink(YOUTUBE_COOKIES_STORE_PATH);
    }
    const meta = getStoredYoutubeCookiesMeta();
    return res.json({ ok: true, message: "Cookies YouTube supprimés.", ...meta });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Impossible de supprimer les cookies YouTube."
    });
  }
});

app.post("/api/jobs", upload.single("video"), async (req, res) => {
  const rawVideoUrl = String(req.body.videoUrl || "").trim();
  const hasUpload = Boolean(req.file);
  const hasVideoUrl = rawVideoUrl.length > 0;

  if (!hasUpload && !hasVideoUrl) {
    return res.status(400).json({ error: "Fichier vidéo ou lien vidéo requis" });
  }
  if (hasVideoUrl && !isValidHttpUrl(rawVideoUrl)) {
    return res.status(400).json({ error: "Le lien vidéo doit être une URL http(s) valide" });
  }
  if (hasVideoUrl && isLikelyYouTubeUrl(rawVideoUrl) && !ytDlpAvailable) {
    return res.status(400).json({
      error: "Le serveur ne peut pas traiter les liens YouTube (yt-dlp indisponible)"
    });
  }

  try {
    const clipDuration = Math.min(600, Math.max(8, toNumber(req.body.clipDuration, DEFAULTS.clipDuration)));
    const clipsCount = Math.min(12, Math.max(1, Math.floor(toNumber(req.body.clipsCount, DEFAULTS.clipsCount))));
    const aspectRatio = ["9:16", "1:1", "16:9"].includes(req.body.aspectRatio) ? req.body.aspectRatio : DEFAULTS.aspectRatio;
    const transcript = String(req.body.transcript || "");
    const minGapSecBetweenClips = Math.max(0, toNumber(req.body.minGapSecBetweenClips, DEFAULTS.minGap));
    const subtitleTheme = ["classic", "bold", "cinema", "neon"].includes(req.body.subtitleTheme)
      ? req.body.subtitleTheme
      : DEFAULTS.subtitleTheme;
    const highlightMode = ["balanced", "hook-first", "viral"].includes(req.body.highlightMode)
      ? req.body.highlightMode
      : DEFAULTS.highlightMode;
    const languageMode = ["translate-to-french", "already-french"].includes(req.body.languageMode)
      ? req.body.languageMode
      : DEFAULTS.languageMode;
    const includeAutoTranscript = boolFrom(req.body.includeAutoTranscript, DEFAULTS.includeAutoTranscript);
    const dubFrenchAudio = boolFrom(req.body.dubFrenchAudio, DEFAULTS.dubFrenchAudio);
    const autoDubVoiceBySpeaker = boolFrom(req.body.autoDubVoiceBySpeaker, DEFAULTS.autoDubVoiceBySpeaker);
    const includeSrtInZip = boolFrom(req.body.includeSrtInZip, DEFAULTS.includeSrtInZip);
    const burnSubtitles = boolFrom(req.body.burnSubtitles, DEFAULTS.burnSubtitles);
    const youtubeCookies = String(req.body.youtubeCookies || "");

    const id = uuidv4();
    const useUrlSource = hasVideoUrl;
    const jobDir = getJobDir(id);
    let youtubeCookiesFilePath = "";
    if (useUrlSource && isLikelyYouTubeUrl(rawVideoUrl) && youtubeCookies.trim()) {
      let normalizedCookies = "";
      try {
        normalizedCookies = normalizeYouTubeCookies(youtubeCookies);
      } catch (error) {
        return res.status(400).json({
          error: error instanceof Error ? error.message : "Format de cookies invalide."
        });
      }
      await fsp.mkdir(jobDir, { recursive: true });
      youtubeCookiesFilePath = path.join(jobDir, "youtube-cookies.txt");
      await fsp.writeFile(youtubeCookiesFilePath, normalizedCookies, { encoding: "utf8", mode: 0o600 });
      await fsp.mkdir(SECRETS_DIR, { recursive: true });
      await fsp.writeFile(YOUTUBE_COOKIES_STORE_PATH, normalizedCookies, { encoding: "utf8", mode: 0o600 });
    } else if (useUrlSource && isLikelyYouTubeUrl(rawVideoUrl) && hasStoredYoutubeCookies()) {
      youtubeCookiesFilePath = YOUTUBE_COOKIES_STORE_PATH;
    }
    const job = {
      id,
      status: "queued",
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceType: useUrlSource ? "url" : "upload",
      sourceUrl: useUrlSource ? rawVideoUrl : "",
      youtubeCookiesFilePath,
      inputPath: useUrlSource ? "" : req.file.path,
      originalFilename: useUrlSource ? "" : req.file.originalname,
      duration: 0,
      autoTranscriptUsed: false,
      params: {
        clipDuration,
        clipsCount,
        aspectRatio,
        transcript,
        minGapSecBetweenClips,
        subtitleTheme,
        highlightMode,
        languageMode,
        includeAutoTranscript,
        dubFrenchAudio: languageMode === "already-french" ? false : dubFrenchAudio,
        autoDubVoiceBySpeaker: languageMode === "already-french" ? false : autoDubVoiceBySpeaker,
        includeSrtInZip,
        burnSubtitles,
        hasYoutubeCookies: Boolean(youtubeCookiesFilePath)
      },
      clips: [],
      error: null
    };

    jobs.set(id, job);
    await persistJobsDb();
    await enqueueJob(id);
    return res.status(202).json({ id, status: job.status, progress: job.progress });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Erreur interne" });
  }
});

app.get("/api/jobs/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job introuvable" });
  return res.json(sanitizeJobForClient(job));
});

app.get("/api/jobs/:jobId/plan", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job introuvable" });
  const planPath = getJobPlanPath(job.id);
  if (!fs.existsSync(planPath)) return res.status(409).json({ error: "Plan indisponible, job non terminé" });
  return res.download(planPath, `clipforge-plan-${job.id}.json`);
});

app.get("/api/jobs/:jobId/clips/:clipId/stream", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job introuvable" });
  const clip = (job.clips || []).find((c) => c.id === req.params.clipId);
  if (!clip) return res.status(404).json({ error: "Clip introuvable" });
  const selectedPath = clip.burnedFilePath || clip.filePath;
  if (!selectedPath || !fs.existsSync(selectedPath)) return res.status(404).json({ error: "Fichier clip indisponible" });
  return res.sendFile(selectedPath);
});

app.get("/api/jobs/:jobId/clips/:clipId/download", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job introuvable" });
  const clip = (job.clips || []).find((c) => c.id === req.params.clipId);
  if (!clip) return res.status(404).json({ error: "Clip introuvable" });
  const selectedPath = clip.burnedFilePath || clip.filePath;
  if (!selectedPath || !fs.existsSync(selectedPath)) return res.status(404).json({ error: "Fichier clip indisponible" });
  return res.download(selectedPath, `${clip.id}.mp4`);
});

app.get("/api/jobs/:jobId/clips/:clipId/srt", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job introuvable" });
  const clip = (job.clips || []).find((c) => c.id === req.params.clipId);
  if (!clip || !clip.srtPath || !fs.existsSync(clip.srtPath)) {
    return res.status(404).json({ error: "Sous-titres introuvables" });
  }
  return res.download(clip.srtPath, `${clip.id}.srt`);
});

app.get("/api/jobs/:jobId/bundle", async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job introuvable" });
  if (job.status !== "completed") return res.status(409).json({ error: "Job non terminé" });

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename=\"clipforge-bundle-${job.id}.zip\"`);

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => {
    res.status(500).end(err.message);
  });
  archive.pipe(res);

  const planPath = getJobPlanPath(job.id);
  if (fs.existsSync(planPath)) archive.file(planPath, { name: "plan.json" });

  for (const clip of job.clips || []) {
    const selectedPath = clip.burnedFilePath || clip.filePath;
    if (selectedPath && fs.existsSync(selectedPath)) {
      archive.file(selectedPath, { name: `clips/${clip.id}.mp4` });
    }
    if (job.params.includeSrtInZip && clip.srtPath && fs.existsSync(clip.srtPath)) {
      archive.file(clip.srtPath, { name: `subtitles/${clip.id}.srt` });
    }
  }

  await archive.finalize();
});

app.use(express.static(ROOT_DIR, { index: false }));
app.get("/", (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, "index.html"));
});

ensureDirs()
  .then(async () => {
    ffmpegReady = checkBinary("ffmpeg", "-version") && checkBinary("ffprobe", "-version");
    whisperAvailable = checkBinary("whisper", "--help");
    ytDlpAvailable = checkPythonModule("yt_dlp", ["--version"]);
    edgeTtsAvailable = checkPythonModule("edge_tts", ["--help"]);
    await restoreJobsDb();
    await initBullQueue();
    app.listen(PORT, () => {
      console.log(`ClipForge API en écoute sur http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Impossible d'initialiser le serveur:", error);
    process.exit(1);
  });
