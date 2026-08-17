/**
 * Registre des clients DFY (une instance cockpit isolée par client).
 * Ne touche jamais /var/www/ebx ni le process PM2 « ebx ».
 */
const fs = require("fs");
const path = require("path");
const { ROOT, clientsRoot, registryPath } = require("./runtime-paths");

const FIRST_CLIENT_PORT = 3101;
const MARKETPLACES = ["EBAY_FR", "EBAY_DE", "EBAY_GB", "EBAY_US"];

function slugify(name) {
  const s = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return s || "client";
}

function assertSlug(id) {
  if (!/^[a-z0-9][a-z0-9-]{0,32}$/.test(String(id || ""))) {
    throw new Error("id client invalide (a-z, 0-9, tirets)");
  }
}

function emptyRegistry() {
  return { version: 1, product: "BayPilot", clients: [] };
}

function loadRegistry() {
  const file = registryPath();
  if (!fs.existsSync(file)) return emptyRegistry();
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const clients = Array.isArray(raw.clients) ? raw.clients : [];
    return { ...emptyRegistry(), ...raw, clients };
  } catch (_) {
    return emptyRegistry();
  }
}

function saveRegistry(reg) {
  fs.mkdirSync(clientsRoot(), { recursive: true });
  const next = { ...emptyRegistry(), ...reg, clients: reg.clients || [] };
  fs.writeFileSync(registryPath(), JSON.stringify(next, null, 2));
  writeEcosystem(next);
  return next;
}

function clientHome(id) {
  assertSlug(id);
  return path.join(clientsRoot(), id);
}

function nextPort(clients) {
  const used = new Set(clients.map((c) => Number(c.port)));
  let port = FIRST_CLIENT_PORT;
  while (used.has(port)) port += 1;
  return port;
}

function uniqueId(base, clients) {
  let id = base;
  let n = 2;
  const taken = new Set(clients.map((c) => c.id));
  while (taken.has(id)) {
    id = `${base}-${n}`.slice(0, 32);
    n += 1;
  }
  return id;
}

function seedClientEnv(id, { port, marketplace }) {
  const home = clientHome(id);
  fs.mkdirSync(path.join(home, "data", "images"), { recursive: true });
  const example = path.join(ROOT, ".env.example");
  let body = fs.existsSync(example) ? fs.readFileSync(example, "utf8") : "PORT=3101\n";
  body = body.replace(/^PORT=.*$/m, `PORT=${port}`);
  if (/^EBAY_MARKETPLACE_ID=/m.test(body)) {
    body = body.replace(/^EBAY_MARKETPLACE_ID=.*$/m, `EBAY_MARKETPLACE_ID=${marketplace}`);
  } else {
    body += `\nEBAY_MARKETPLACE_ID=${marketplace}\n`;
  }
  const envFile = path.join(home, ".env");
  if (!fs.existsSync(envFile)) fs.writeFileSync(envFile, body);
  const opsFile = path.join(home, "data", "ops.json");
  if (!fs.existsSync(opsFile)) {
    fs.writeFileSync(
      opsFile,
      JSON.stringify(
        {
          onboarding: {
            contractSigned: false,
            ebayOauth: false,
            policies: false,
            firstListing: false,
            savInbox: false,
            autoPublishArmed: false,
          },
          feeEur: 1800,
          notes: "",
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
  }
}

function createClient({ name, email = "", feeEur = 1800, marketplace = "EBAY_FR", notes = "" } = {}) {
  const display = String(name || "").trim();
  if (!display) throw new Error("nom client requis");
  const market = MARKETPLACES.includes(marketplace) ? marketplace : "EBAY_FR";
  const reg = loadRegistry();
  const id = uniqueId(slugify(display), reg.clients);
  const port = nextPort(reg.clients);
  const client = {
    id,
    name: display,
    email: String(email || "").trim(),
    feeEur: Number(feeEur) || 1800,
    marketplace: market,
    port,
    status: "onboarding",
    notes: String(notes || ""),
    createdAt: new Date().toISOString(),
  };
  seedClientEnv(id, { port, marketplace: market });
  reg.clients.push(client);
  saveRegistry(reg);
  return client;
}

function updateClient(id, patch = {}) {
  assertSlug(id);
  const reg = loadRegistry();
  const idx = reg.clients.findIndex((c) => c.id === id);
  if (idx < 0) throw new Error("client introuvable");
  const prev = reg.clients[idx];
  const next = { ...prev };
  if (patch.name != null) next.name = String(patch.name).trim() || prev.name;
  if (patch.email != null) next.email = String(patch.email).trim();
  if (patch.feeEur != null) next.feeEur = Number(patch.feeEur) || prev.feeEur;
  if (patch.marketplace && MARKETPLACES.includes(patch.marketplace)) next.marketplace = patch.marketplace;
  if (patch.status != null) next.status = String(patch.status);
  if (patch.notes != null) next.notes = String(patch.notes);
  next.updatedAt = new Date().toISOString();
  reg.clients[idx] = next;
  saveRegistry(reg);
  return next;
}

function getClient(id) {
  assertSlug(id);
  return loadRegistry().clients.find((c) => c.id === id) || null;
}

function listClients() {
  return loadRegistry().clients;
}

function writeEcosystem(reg) {
  const apps = [
    {
      name: "baypilot-ops",
      cwd: ROOT,
      script: "operator-server.js",
      env: { PORT: String(process.env.BAYPILOT_OPS_PORT || 3100) },
    },
  ];
  for (const c of reg.clients || []) {
    apps.push({
      name: `baypilot-${c.id}`,
      cwd: ROOT,
      script: "server.js",
      env: {
        PORT: String(c.port),
        BAYPILOT_CLIENT_DIR: clientHome(c.id),
        BAYPILOT_CLIENT_ID: c.id,
        BAYPILOT_CLIENT_NAME: c.name,
      },
    });
  }
  const file = path.join(ROOT, "ecosystem.config.cjs");
  const body = `// Généré par BayPilot — process baypilot-ops / baypilot-<id> uniquement.
module.exports = ${JSON.stringify({ apps }, null, 2)};
`;
  fs.writeFileSync(file, body);
  return file;
}

module.exports = {
  FIRST_CLIENT_PORT,
  MARKETPLACES,
  slugify,
  loadRegistry,
  saveRegistry,
  createClient,
  updateClient,
  getClient,
  listClients,
  clientHome,
  writeEcosystem,
  nextPort,
};
