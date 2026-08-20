/**
 * Charge .env de façon robuste (Windows / Notepad / guillemets typographiques / # dans les tokens).
 * Solo : baypilot/.env. DFY : d'abord baypilot/.env (clés app), puis clients/<id>/.env (tokens).
 */
const fs = require("fs");
const { envPath, rootEnvPath } = require("./runtime-paths");

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

function applyEnvFile(filePath, { override = true, result }) {
  if (!fs.existsSync(filePath)) {
    result.issues.push(`.env introuvable : ${filePath}`);
    return false;
  }
  result.exists = true;
  result.path = filePath;
  let content = fs.readFileSync(filePath, "utf8");
  content = stripBom(content);

  if (content.includes("\u201C") || content.includes("\u201D")) {
    result.issues.push("Guillemets Word “ ” détectés — OK, on les accepte, mais préfère \" ASCII");
  }

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseLine(lines[i]);
    if (!parsed) continue;
    if (!result.keys.includes(parsed.key)) result.keys.push(parsed.key);
    if (override || process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  }
  return true;
}

function loadEbayEnv({ override = true } = {}) {
  const result = {
    path: envPath(),
    exists: false,
    keys: [],
    issues: [],
  };

  const root = rootEnvPath();
  const client = envPath();
  if (client !== root) {
    applyEnvFile(root, { override: false, result });
  }
  applyEnvFile(client, { override, result });

  // Si USER_TOKEN n'est plus dans .env, efface une éventuelle valeur héritée (Windows / vieux process)
  if (!result.keys.includes("EBAY_USER_TOKEN")) {
    delete process.env.EBAY_USER_TOKEN;
  } else if (cleanEnvToken(process.env.EBAY_USER_TOKEN).length < 80) {
    delete process.env.EBAY_USER_TOKEN;
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
  get ENV_PATH() {
    return envPath();
  },
  loadEbayEnv,
  cleanEnvToken,
  parseLine,
};
