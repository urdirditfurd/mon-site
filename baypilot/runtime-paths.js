/**
 * Chemins runtime BayPilot.
 * En solo : tout vit dans ce dossier (copie améliorée, port ≠ ebx).
 * En DFY : BAYPILOT_CLIENT_DIR pointe vers clients/<id>/ (db, .env, caches isolés).
 */
const fs = require("fs");
const path = require("path");

const ROOT = process.env.BAYPILOT_ROOT
  ? path.resolve(process.env.BAYPILOT_ROOT)
  : __dirname;
const PRODUCT_NAME = "BayPilot";

function clientDirFromEnv() {
  const raw = String(process.env.BAYPILOT_CLIENT_DIR || "").trim();
  return raw ? path.resolve(raw) : ROOT;
}

function clientDir() {
  return clientDirFromEnv();
}

function envPath() {
  return path.join(clientDir(), ".env");
}

function rootEnvPath() {
  return path.join(ROOT, ".env");
}

function dbPath() {
  return path.join(clientDir(), "baypilot.db");
}

function dataDir() {
  return path.join(clientDir(), "data");
}

function imageDir() {
  return path.join(dataDir(), "images");
}

function trendingCachePath() {
  return path.join(dataDir(), "trending-cache.json");
}

function liveCachePath() {
  return path.join(dataDir(), "live-cache.json");
}

function opsStatePath() {
  return path.join(dataDir(), "ops.json");
}

function clientsRoot() {
  return path.join(ROOT, "clients");
}

function registryPath() {
  return path.join(clientsRoot(), "registry.json");
}

function ensureClientDirs() {
  fs.mkdirSync(path.join(dataDir(), "images"), { recursive: true });
}

function clientMeta() {
  return {
    product: PRODUCT_NAME,
    clientId: String(process.env.BAYPILOT_CLIENT_ID || "").trim() || null,
    clientName: String(process.env.BAYPILOT_CLIENT_NAME || "").trim() || null,
    isolated: Boolean(String(process.env.BAYPILOT_CLIENT_DIR || "").trim()),
    clientDir: clientDir(),
  };
}

module.exports = {
  ROOT,
  PRODUCT_NAME,
  clientDir,
  envPath,
  rootEnvPath,
  dbPath,
  dataDir,
  imageDir,
  trendingCachePath,
  liveCachePath,
  opsStatePath,
  clientsRoot,
  registryPath,
  ensureClientDirs,
  clientMeta,
};
