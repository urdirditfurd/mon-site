/**
 * Console opérateur BayPilot (port 3100).
 * Process PM2 : baypilot-ops — jamais « ebx ».
 */
const path = require("path");
const fs = require("fs");
const express = require("express");
const { DatabaseSync } = require("node:sqlite");
const {
  listClients,
  createClient,
  updateClient,
  getClient,
  clientHome,
  loadRegistry,
} = require("./client-registry");
const { buildWeeklyReport, reportToHtml, loadOpsState, saveOpsState, mergeOnboarding } = require("./ops-engine");
const { PRODUCT_NAME } = require("./runtime-paths");

const app = express();
const PORT = Number(process.env.PORT || process.env.BAYPILOT_OPS_PORT || 3100);

app.use(express.json({ limit: "1mb" }));

function readClientSnapshot(id) {
  const home = clientHome(id);
  const dbFile = path.join(home, "baypilot.db");
  const opsFile = path.join(home, "data", "ops.json");
  const snapshot = {
    listings: [],
    orders: [],
    sav: [],
    publishLog: [],
    live: { ebayOauth: false, policies: false, publishedCount: 0, savCount: 0 },
    opsState: loadOpsState(opsFile),
  };
  if (!fs.existsSync(dbFile)) return snapshot;
  let db;
  try {
    db = new DatabaseSync(dbFile, { readOnly: true });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
    if (tables.includes("listings")) {
      snapshot.listings = db.prepare("SELECT * FROM listings ORDER BY created_at DESC LIMIT 500").all();
    }
    if (tables.includes("auto_orders")) {
      snapshot.orders = db.prepare("SELECT * FROM auto_orders ORDER BY created_at DESC LIMIT 200").all();
    }
    if (tables.includes("sav_messages")) {
      snapshot.sav = db.prepare("SELECT * FROM sav_messages ORDER BY updated_at DESC LIMIT 200").all();
    }
    if (tables.includes("auto_publish_log")) {
      snapshot.publishLog = db.prepare("SELECT * FROM auto_publish_log ORDER BY published_at DESC LIMIT 200").all();
    }
    snapshot.live.publishedCount = snapshot.listings.filter((l) => String(l.ebay_listing_id || "").trim()).length;
    snapshot.live.savCount = snapshot.sav.length;
    snapshot.live.ebayOauth = snapshot.listings.some((l) => String(l.publish_env || "") === "production") ||
      snapshot.live.publishedCount > 0;
  } catch (err) {
    snapshot.error = err.message;
  } finally {
    try {
      db?.close();
    } catch (_) {}
  }
  return snapshot;
}

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    product: PRODUCT_NAME,
    role: "operator",
    clients: listClients().length,
    note: "Ne pas confondre avec le process PM2 ebx (clone VPS d'origine).",
  });
});

app.get("/api/clients", (_req, res) => {
  res.json({ success: true, data: listClients() });
});

app.post("/api/clients", (req, res) => {
  try {
    const client = createClient(req.body || {});
    res.status(201).json({ success: true, data: client });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get("/api/clients/:id", (req, res) => {
  const client = getClient(req.params.id);
  if (!client) return res.status(404).json({ success: false, error: "client introuvable" });
  const snap = readClientSnapshot(client.id);
  res.json({
    success: true,
    data: {
      ...client,
      onboarding: mergeOnboarding(snap.opsState.onboarding, snap.live),
      cockpitUrl: `http://127.0.0.1:${client.port}`,
    },
  });
});

app.patch("/api/clients/:id", (req, res) => {
  try {
    const client = updateClient(req.params.id, req.body || {});
    res.json({ success: true, data: client });
  } catch (err) {
    const code = /introuvable/.test(err.message) ? 404 : 400;
    res.status(code).json({ success: false, error: err.message });
  }
});

app.get("/api/clients/:id/report", (req, res) => {
  const client = getClient(req.params.id);
  if (!client) return res.status(404).json({ success: false, error: "client introuvable" });
  const snap = readClientSnapshot(client.id);
  const report = buildWeeklyReport({
    client,
    listings: snap.listings,
    orders: snap.orders,
    sav: snap.sav,
    publishLog: snap.publishLog,
    opsState: snap.opsState,
    live: snap.live,
  });
  if (String(req.query.format || "") === "html") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(reportToHtml(report));
  }
  res.json({ success: true, data: report });
});

app.post("/api/clients/:id/onboarding", (req, res) => {
  const client = getClient(req.params.id);
  if (!client) return res.status(404).json({ success: false, error: "client introuvable" });
  const opsFile = path.join(clientHome(client.id), "data", "ops.json");
  const prev = loadOpsState(opsFile);
  const patch = req.body || {};
  const onboarding = { ...prev.onboarding };
  for (const key of Object.keys(onboarding)) {
    if (typeof patch[key] === "boolean") onboarding[key] = patch[key];
  }
  if (patch.onboarding && typeof patch.onboarding === "object") {
    for (const key of Object.keys(onboarding)) {
      if (typeof patch.onboarding[key] === "boolean") onboarding[key] = patch.onboarding[key];
    }
  }
  const feeEur = patch.feeEur != null ? Number(patch.feeEur) : prev.feeEur;
  const next = saveOpsState(opsFile, { ...prev, onboarding, feeEur, notes: patch.notes != null ? patch.notes : prev.notes });
  res.json({ success: true, data: next });
});

app.get("/api/playbook", (_req, res) => {
  const file = path.join(__dirname, "PLAYBOOK.md");
  res.type("text/markdown").send(fs.readFileSync(file, "utf8"));
});

app.use(express.static(__dirname));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "operator.html"));
});

if (require.main === module) {
  loadRegistry();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`BayPilot opérateur http://0.0.0.0:${PORT}`);
    console.log("Process attendu : pm2 start ecosystem.config.cjs  (baypilot-ops)");
    console.log("Ne pas toucher au PM2 ebx ni à /var/www/ebx");
  });
}

module.exports = { app, readClientSnapshot };
