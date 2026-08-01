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

function cleanEnvToken(v) {
  let s = String(v || "").trim();
  const open = s[0];
  if (OPEN_QUOTES.includes(open) && CLOSE_FOR[open] && s.endsWith(CLOSE_FOR[open])) {
    s = s.slice(1, -1);
  } else if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1);
  }
  return s.trim();
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
    // guillemet ouvrant sans fermeture → prend tout (évite coupe sur #)
    return { key, value: raw.slice(1) };
  }

  // non quoté : coupe au commentaire #
  const hash = raw.indexOf(" #");
  if (hash >= 0) raw = raw.slice(0, hash).trim();
  // token eBay non quoté avec # → on garde tout (sinon casse le refresh)
  return { key, value: raw };
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

  const refresh = cleanEnvToken(process.env.EBAY_REFRESH_TOKEN);
  const user = cleanEnvToken(process.env.EBAY_USER_TOKEN);
  if (!result.keys.includes("EBAY_REFRESH_TOKEN")) {
    result.issues.push("Aucune ligne EBAY_REFRESH_TOKEN= dans le fichier .env");
  } else if (refresh.length < 40) {
    result.issues.push(
      `EBAY_REFRESH_TOKEN trop court (${refresh.length} car.) après parse — vérifie guillemets et copie complète`
    );
  }
  if (result.keys.includes("EBAY_USER_TOKEN") && user.length > 0 && user.length < 80) {
    result.issues.push(
      `EBAY_USER_TOKEN=${user.length} car. — commente la ligne (# EBAY_USER_TOKEN=...) pour éviter les confusions`
    );
  }

  return result;
}

module.exports = {
  ENV_PATH,
  loadEbayEnv,
  cleanEnvToken,
  parseLine,
};
