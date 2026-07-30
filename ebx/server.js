require("dotenv").config();
const express = require("express");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { generateListing } = require("./ai-brain");
const { publishToEbay } = require("./ebay-api");
const {
  getRankings,
  analyzeTitleKeywords,
  analyzeCompetitor,
  runAutoSnipe,
  buildDescriptionFromUrl,
  getDashboardStats,
  getAutoOrders,
} = require("./mock-data");

const app = express();
const PORT = process.env.PORT || 3000;

const db = new DatabaseSync(path.join(__dirname, "ebx.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seo_title TEXT,
    html_description TEXT,
    suggested_price REAL,
    keywords TEXT,
    source_url TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS competitor_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_name TEXT,
    payload TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const listingCols = db.prepare("PRAGMA table_info(listings)").all().map((c) => c.name);
if (!listingCols.includes("source_url")) {
  db.exec("ALTER TABLE listings ADD COLUMN source_url TEXT DEFAULT ''");
}

const insertListing = db.prepare(
  "INSERT INTO listings (seo_title, html_description, suggested_price, keywords, source_url) VALUES (?, ?, ?, ?, ?)"
);
const getRecentListings = db.prepare(
  "SELECT id, seo_title, suggested_price, keywords, source_url, created_at FROM listings ORDER BY created_at DESC LIMIT 50"
);
const getListingById = db.prepare("SELECT * FROM listings WHERE id = ?");
const insertCompetitor = db.prepare(
  "INSERT INTO competitor_history (seller_name, payload) VALUES (?, ?)"
);
const getCompetitorHistory = db.prepare(
  "SELECT id, seller_name, created_at FROM competitor_history ORDER BY created_at DESC LIMIT 10"
);

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname)));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", llm_url: process.env.LOCAL_LLM_URL || "http://localhost:1234/v1" });
});

app.get("/api/dashboard", (_req, res) => {
  try {
    const listings = getRecentListings.all();
    res.json({ success: true, data: getDashboardStats(listings.length) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/rankings", (req, res) => {
  res.json({ success: true, data: getRankings(req.query.marketplace || "FR") });
});

app.post("/api/title-builder", (req, res) => {
  const { query } = req.body || {};
  if (!query) return res.status(400).json({ success: false, error: "query requis" });
  res.json({ success: true, data: analyzeTitleKeywords(query) });
});

app.post("/api/competitors", (req, res) => {
  try {
    const { seller } = req.body || {};
    if (!seller) return res.status(400).json({ success: false, error: "seller requis" });
    const data = analyzeCompetitor(seller);
    insertCompetitor.run(seller, JSON.stringify(data));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/competitors/history", (_req, res) => {
  try {
    res.json({ success: true, data: getCompetitorHistory.all() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/auto-orders", (_req, res) => {
  res.json({ success: true, data: getAutoOrders() });
});

app.post("/api/auto-snipe", async (req, res) => {
  const { count = 1, margin = 20, marketplace = "France", ticket = "all", testMode = true } = req.body || {};
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  try {
    for await (const event of runAutoSnipe({
      count: Math.min(Number(count) || 1, 5),
      margin: Number(margin) || 20,
      marketplace,
      ticket,
      testMode: testMode !== false,
    })) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: "log", message: `[ERROR] ${err.message}` })}\n\n`);
  }
  res.end();
});

app.post("/api/generate-listing", async (req, res) => {
  const { productName, rawKeywords, productUrl, themeColor } = req.body || {};

  try {
    let listing;

    if (productUrl) {
      listing = buildDescriptionFromUrl(productUrl, themeColor || "#667eea");
      try {
        const aiPromise = generateListing(
          listing.product_name,
          `url:${productUrl}, theme:${themeColor || "#667eea"}`
        );
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("LLM timeout")), 2500)
        );
        const ai = await Promise.race([aiPromise, timeout]);
        if (ai?.html_description && !ai._parse_error) {
          listing = {
            ...listing,
            seo_title: ai.seo_title || listing.seo_title,
            html_description: ai.html_description,
            suggested_price: ai.suggested_price || listing.suggested_price,
          };
        }
      } catch (llmErr) {
        console.warn("[EBX] LLM skip (URL template utilisé):", llmErr.message);
      }
    } else {
      if (!productName) return res.status(400).json({ error: "productName ou productUrl requis" });
      listing = await generateListing(productName, rawKeywords || "");
    }

    const insert = db.prepare(
      "INSERT INTO listings (seo_title, html_description, suggested_price, keywords, source_url) VALUES (?, ?, ?, ?, ?)"
    );
    const result = insert.run(
      listing.seo_title || "",
      listing.html_description || "",
      listing.suggested_price || 0,
      rawKeywords || "",
      productUrl || ""
    );

    return res.json({ success: true, data: { ...listing, id: Number(result.lastInsertRowid) } });
  } catch (err) {
    console.error("[EBX] Erreur génération :", err);
    if (err.code === "ECONNREFUSED") {
      return res.status(503).json({
        success: false,
        error: "LLM local non disponible. Vérifie que LM Studio tourne sur le port 1234.",
      });
    }
    return res.status(500).json({ success: false, error: err.message || "Erreur lors de la génération." });
  }
});

app.get("/api/listings", (_req, res) => {
  try {
    return res.json({ success: true, data: getRecentListings.all() });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Erreur base de données." });
  }
});

app.get("/api/listings/:id", (req, res) => {
  try {
    const listing = getListingById.get(req.params.id);
    if (!listing) return res.status(404).json({ success: false, error: "Listing introuvable." });
    return res.json({ success: true, data: listing });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Erreur base de données." });
  }
});

app.post("/api/publish-to-ebay/:id", async (req, res) => {
  try {
    const listing = getListingById.get(req.params.id);
    if (!listing) return res.status(404).json({ success: false, error: "Listing introuvable." });
    const result = await publishToEbay(listing, listing.id);
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error("[EBX] Erreur eBay :", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`⚡ EBX Server running on http://localhost:${PORT}`);
  console.log(`🧠 LLM endpoint: ${process.env.LOCAL_LLM_URL || "http://localhost:1234/v1"}`);
});
