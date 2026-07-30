require("dotenv").config();
const express = require("express");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { generateListing } = require("./ai-brain");
const { publishToEbay } = require("./ebay-api");

const app = express();
const PORT = process.env.PORT || 3000;

// SQLite natif Node.js (pas de compilation native — compatible Windows ARM)
const db = new DatabaseSync(path.join(__dirname, "ebx.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seo_title TEXT,
    html_description TEXT,
    suggested_price REAL,
    keywords TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const insertListing = db.prepare(
  "INSERT INTO listings (seo_title, html_description, suggested_price, keywords) VALUES (?, ?, ?, ?)"
);
const getRecentListings = db.prepare(
  "SELECT id, seo_title, suggested_price, keywords, created_at FROM listings ORDER BY created_at DESC LIMIT 10"
);
const getListingById = db.prepare("SELECT * FROM listings WHERE id = ?");

app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.post("/api/generate-listing", async (req, res) => {
  const { productName, rawKeywords } = req.body;

  if (!productName) {
    return res.status(400).json({ error: "productName est requis" });
  }

  try {
    const listing = await generateListing(productName, rawKeywords || "");

    const result = insertListing.run(
      listing.seo_title || "",
      listing.html_description || "",
      listing.suggested_price || 0,
      rawKeywords || ""
    );

    return res.json({ success: true, data: { ...listing, id: Number(result.lastInsertRowid) } });
  } catch (err) {
    console.error("[EBX] Erreur LLM :", err.message);

    if (err.code === "ECONNREFUSED") {
      return res.status(503).json({
        success: false,
        error: "LLM local non disponible. Vérifie que LM Studio tourne sur le port 1234.",
      });
    }

    return res.status(500).json({ success: false, error: "Erreur lors de la génération. Réessaie." });
  }
});

app.get("/api/listings", (_req, res) => {
  try {
    const listings = getRecentListings.all();
    return res.json({ success: true, data: listings });
  } catch (err) {
    console.error("[EBX] Erreur DB :", err.message);
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
    if (!listing) {
      return res.status(404).json({ success: false, error: "Listing introuvable." });
    }

    const result = await publishToEbay(listing, listing.id);
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error("[EBX] Erreur eBay :", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", llm_url: process.env.LOCAL_LLM_URL || "http://localhost:1234/v1" });
});

app.listen(PORT, () => {
  console.log(`⚡ EBX Server running on http://localhost:${PORT}`);
  console.log(`🧠 LLM endpoint: ${process.env.LOCAL_LLM_URL || "http://localhost:1234/v1"}`);
});
