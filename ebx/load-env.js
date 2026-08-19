/**
 * Charge ebx/.env de façon robuste (Windows / Notepad / guillemets typographiques / # dans les tokens).
 */
const fs = require("fs");
const path = require("path");

const ENV_PATH = path.join(__dirname, ".env");

/** Guillemets ASCII + typographiques Word/Notion */
const OPEN_QUOTES = ['"', "'", "\u201C", "\u2018", "\u00AB"];
const CLOSE_FOR = {
  '"': '"',
  "'": "'",
  "\u201C": "\u201D",
  "\u2018": "\u2019",
  "\u00AB": "\u00BB",
};

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Enlève guillemets ASCII + Word/Notion même s'ils sont mal appariés (”…” ou ”…”). */
function stripWrappingQuotes(s) {
  let out = String(s || "").trim();
  const quoteChars = new Set(['"', "'", "\u201C", "\u201D", "\u2018", "\u2019", "\u00AB", "\u00BB"]);
  // Jusqu'à 2 passes (ex. ""value"")
  for (let i = 0; i < 2; i++) {
    if (out.length >= 2 && quoteChars.has(out[0]) && quoteChars.has(out[out.length - 1])) {
      out = out.slice(1, -1).trim();
    } else {
      break;
    }
  }
  // Guillemets orphelins collés
  out = out.replace(/^[\u201C\u201D\u2018\u2019"']+|[\u201C\u201D\u2018\u2019"']+$/g, "").trim();
  return out;
}

function cleanEnvToken(v) {
  return stripWrappingQuotes(v);
}

/**
 * Parse une ligne KEY=VALUE en respectant les guillemets ( # autorisé à l'intérieur ).
 */
function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) return null;
  const key = trimmed.slice(0, eq).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  let raw = trimmed.slice(eq + 1).trim();

  if (!raw) return { key, value: "" };

  const open = raw[0];
  if (OPEN_QUOTES.includes(open) && CLOSE_FOR[open]) {
    const close = CLOSE_FOR[open];
    const end = raw.indexOf(close, 1);
    if (end > 0) {
      return { key, value: raw.slice(1, end) };
    }
    return { key, value: stripWrappingQuotes(raw) };
  }

  // Guillemets Word mal appariés : ”value” (même caractère des deux côtés)
  if (/^[\u201C\u201D\u2018\u2019]/.test(raw)) {
    return { key, value: stripWrappingQuotes(raw) };
  }

  const hash = raw.indexOf(" #");
  if (hash >= 0) raw = raw.slice(0, hash).trim();
  return { key, value: stripWrappingQuotes(raw) };
}

function loadEbayEnv({ override = true } = {}) {
  const result = {
    path: ENV_PATH,
    exists: false,
    keys: [],
    issues: [],
  };

  if (!fs.existsSync(ENV_PATH)) {
    result.issues.push(`.env introuvable : ${ENV_PATH}`);
    return result;
  }
  result.exists = true;

  let content = fs.readFileSync(ENV_PATH, "utf8");
  content = stripBom(content);

  if (content.includes("\u201C") || content.includes("\u201D")) {
    result.issues.push("Guillemets Word “ ” détectés — OK, on les accepte, mais préfère \" ASCII");
  }

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseLine(lines[i]);
    if (!parsed) continue;
    result.keys.push(parsed.key);
    if (override || process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  }

  // Si USER_TOKEN n'est plus dans .env, efface une éventuelle valeur héritée (Windows / vieux process)
  if (!result.keys.includes("EBAY_USER_TOKEN")) {
    delete process.env.EBAY_USER_TOKEN;
  } else if (cleanEnvToken(process.env.EBAY_USER_TOKEN).length < 80) {
    delete process.env.EBAY_USER_TOKEN;
  }

  applyProdFallbacks(result);

  const refresh = cleanEnvToken(process.env.EBAY_REFRESH_TOKEN);
  const prodRefresh = cleanEnvToken(process.env.EBAY_REFRESH_TOKEN_PROD);
  const effectiveRefresh =
    String(process.env.EBAY_ENV || "").toLowerCase() === "production"
      ? prodRefresh || refresh
      : refresh || prodRefresh;
  const user = cleanEnvToken(process.env.EBAY_USER_TOKEN);
  const hasRefreshLine =
    result.keys.includes("EBAY_REFRESH_TOKEN") || result.keys.includes("EBAY_REFRESH_TOKEN_PROD");
  if (!hasRefreshLine) {
    result.issues.push("Aucune ligne EBAY_REFRESH_TOKEN= ni EBAY_REFRESH_TOKEN_PROD= dans .env");
  } else if (effectiveRefresh.length < 40) {
    result.issues.push(
      `Refresh token trop court (${effectiveRefresh.length} car.) après parse — mets-le entre guillemets droits ASCII`
    );
  }
  if (result.keys.includes("EBAY_USER_TOKEN") && user.length > 0 && user.length < 80) {
    result.issues.push(
      `EBAY_USER_TOKEN=${user.length} car. — commente la ligne (# EBAY_USER_TOKEN=...) pour éviter les confusions`
    );
  }

  return result;
}

function isPlaceholderEnvValue(v) {
  const s = cleanEnvToken(v);
  return !s || /your_sandbox|your_|changeme|placeholder|xxx+/i.test(s);
}

/**
 * Si les clés *_PROD sont remplies, on publie en production
 * (évite sandbox + token 0 car. alors que EBAY_REFRESH_TOKEN_PROD est là).
 */
function applyProdFallbacks(result = { issues: [] }) {
  const prodId = cleanEnvToken(process.env.EBAY_PROD_CLIENT_ID);
  const prodSecret = cleanEnvToken(process.env.EBAY_PROD_CLIENT_SECRET);
  let prodRefresh = cleanEnvToken(process.env.EBAY_REFRESH_TOKEN_PROD);
  const sandboxId = cleanEnvToken(process.env.EBAY_CLIENT_ID);
  const sandboxSecret = cleanEnvToken(process.env.EBAY_CLIENT_SECRET);
  let sandboxRefresh = cleanEnvToken(process.env.EBAY_REFRESH_TOKEN);
  const sandboxRefreshOnly = cleanEnvToken(process.env.EBAY_REFRESH_TOKEN_SANDBOX);

  if (prodId && isPlaceholderEnvValue(sandboxId)) {
    process.env.EBAY_CLIENT_ID = prodId;
  }
  if (prodSecret && isPlaceholderEnvValue(sandboxSecret)) {
    process.env.EBAY_CLIENT_SECRET = prodSecret;
  }

  const ruProd = cleanEnvToken(process.env.EBAY_RU_NAME_PROD);
  if (ruProd && isPlaceholderEnvValue(process.env.EBAY_RU_NAME)) {
    process.env.EBAY_RU_NAME = ruProd;
  }

  const hasProdKeys = !isPlaceholderEnvValue(prodId) && !isPlaceholderEnvValue(prodSecret);
  const hasProdRefresh = prodRefresh.length >= 40;
  const hasGenericRefresh = sandboxRefresh.length >= 40;
  const envNow = String(process.env.EBAY_ENV || "sandbox").toLowerCase();
  const staySandbox = envNow === "sandbox" && sandboxRefreshOnly.length >= 40 && !hasProdRefresh && !hasProdKeys;

  if (!staySandbox && (hasProdKeys || hasProdRefresh) && envNow !== "production") {
    process.env.EBAY_ENV = "production";
    result.issues.push("EBAY_ENV forcé à production (clés / refresh *_PROD détectés)");
  }

  if (String(process.env.EBAY_ENV || "").toLowerCase() === "production") {
    process.env.EBAY_API_BASE = "https://api.ebay.com";
    process.env.EBAY_AUTH_URL = "https://api.ebay.com/identity/v1/oauth2/token";
    if (hasProdRefresh && sandboxRefresh.length < 40) {
      process.env.EBAY_REFRESH_TOKEN = prodRefresh;
      sandboxRefresh = prodRefresh;
    }
    if (hasGenericRefresh && prodRefresh.length < 40) {
      process.env.EBAY_REFRESH_TOKEN_PROD = sandboxRefresh;
      prodRefresh = sandboxRefresh;
    }
    for (const [prodKey, genericKey] of [
      ["EBAY_FULFILLMENT_POLICY_ID_PROD", "EBAY_FULFILLMENT_POLICY_ID"],
      ["EBAY_PAYMENT_POLICY_ID_PROD", "EBAY_PAYMENT_POLICY_ID"],
      ["EBAY_RETURN_POLICY_ID_PROD", "EBAY_RETURN_POLICY_ID"],
    ]) {
      const prodVal = cleanEnvToken(process.env[prodKey]);
      if (prodVal && isPlaceholderEnvValue(process.env[genericKey])) {
        process.env[genericKey] = prodVal;
      }
    }
    if (prodRefresh.length < 40 && sandboxRefresh.length < 40) {
      result.issues.push(
        `Aucun refresh token prod ≥ 40 car. — colle EBAY_REFRESH_TOKEN_PROD="v^1.1#..." entre guillemets`
      );
    }
  }
}

module.exports = {
  ENV_PATH,
  loadEbayEnv,
  cleanEnvToken,
  parseLine,
  applyProdFallbacks,
  isPlaceholderEnvValue,
};
