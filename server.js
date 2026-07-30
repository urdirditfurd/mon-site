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
  buildDescriptionFromUrl,
  getDashboardStats,
  getAutoOrders,
} = require("./mock-data");
const {
  scrapeProduct,
  scrapeEbaySearch,
  scrapeEbaySeller,
  scrapeRankings,
  scrapeAmazonSearch,
  buildKeywordAnalysisFromItems,
  buildHtmlFromProduct,
} = require("./scraper");
const { browseSearch, browseSellerItems } = require("./ebay-browse");

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
db.exec(`
  CREATE TABLE IF NOT EXISTS auto_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_ref TEXT,
    product TEXT,
    buyer TEXT,
    status TEXT,
    supplier TEXT,
    amount REAL,
    source_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const listingCols = db.prepare("PRAGMA table_info(listings)").all().map((c) => c.name);
if (!listingCols.includes("source_url")) {
  db.exec("ALTER TABLE listings ADD COLUMN source_url TEXT DEFAULT ''");
}

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
const insertOrder = db.prepare(
  "INSERT INTO auto_orders (order_ref, product, buyer, status, supplier, amount, source_url) VALUES (?, ?, ?, ?, ?, ?, ?)"
);
const getOrders = db.prepare("SELECT * FROM auto_orders ORDER BY created_at DESC LIMIT 50");

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname)));

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    llm_url: process.env.LOCAL_LLM_URL || "http://localhost:1234/v1",
    mode: "live+fallback",
  });
});

app.get("/api/dashboard", (_req, res) => {
  try {
    const listings = getRecentListings.all();
    const orders = getOrders.all();
    const base = getDashboardStats(listings.length);
    res.json({
      success: true,
      data: {
        ...base,
        listings: listings.length,
        pendingOrders: orders.filter((o) => o.status === "pending").length,
        orders: orders.length || base.orders,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/rankings", async (req, res) => {
  const marketplace = req.query.marketplace || "FR";
  try {
    const seeds = ["coque iphone", "verre trempe", "colle b7000", "bande led", "chargeur usb c"];
    const all = [];
    for (const q of seeds) {
      try {
        const r = await browseSearch(q, { marketplace, limit: 3 });
        r.items.forEach((it) => all.push({ ...it, seed: q }));
      } catch (_) {}
    }
    if (all.length) {
      const data = all.slice(0, 12).map((p, i) => ({
        rank: i + 1,
        title: p.title,
        category: p.seed || "eBay",
        price: p.price || 0,
        sold: p.sold || Math.round(20 + Math.random() * 200),
        marketplace,
        trend: i % 3 === 0 ? "up" : i % 3 === 1 ? "stable" : "down",
        url: p.url,
        live: true,
      }));
      return res.json({ success: true, data, live: true, source: "ebay-browse-api" });
    }
  } catch (err) {
    console.warn("[EBX] rankings browse fail:", err.message);
  }
  try {
    const live = await scrapeRankings({ marketplace });
    if (live.length) return res.json({ success: true, data: live, live: true, source: "scrape" });
  } catch (err) {
    console.warn("[EBX] rankings scrape fail:", err.message);
  }
  res.json({ success: true, data: getRankings(marketplace), live: false, source: "mock" });
});

app.post("/api/title-builder", async (req, res) => {
  const { query, marketplace = "FR" } = req.body || {};
  if (!query) return res.status(400).json({ success: false, error: "query requis" });

  try {
    const r = await browseSearch(query, { marketplace, limit: 40 });
    if (r.items.length >= 3) {
      return res.json({
        success: true,
        data: { ...buildKeywordAnalysisFromItems(query, r.items), api: r.api },
      });
    }
  } catch (err) {
    console.warn("[EBX] title browse fail:", err.message);
  }

  try {
    const { items } = await scrapeEbaySearch(query, { marketplace, limit: 30 });
    if (items.length >= 3) {
      return res.json({ success: true, data: buildKeywordAnalysisFromItems(query, items) });
    }
  } catch (err) {
    console.warn("[EBX] title scrape fail:", err.message);
  }

  res.json({ success: true, data: { ...analyzeTitleKeywords(query), live: false, source: "mock" } });
});

app.post("/api/competitors", async (req, res) => {
  try {
    const { seller, marketplace = "FR" } = req.body || {};
    if (!seller) return res.status(400).json({ success: false, error: "seller requis" });

    let data;
    try {
      data = await browseSellerItems(seller, { marketplace });
    } catch (err) {
      console.warn("[EBX] competitor browse fail:", err.message);
      try {
        data = await scrapeEbaySeller(seller, { marketplace });
      } catch (err2) {
        console.warn("[EBX] competitor scrape fail:", err2.message);
        data = { ...analyzeCompetitor(seller), live: false, source: "mock" };
      }
    }

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
  try {
    const rows = getOrders.all();
    if (rows.length) {
      return res.json({
        success: true,
        data: rows.map((o) => ({
          id: o.order_ref,
          product: o.product,
          buyer: o.buyer,
          status: o.status,
          supplier: o.supplier,
          amount: o.amount,
          created_at: o.created_at,
        })),
        live: true,
      });
    }
  } catch (_) {}
  res.json({ success: true, data: getAutoOrders(), live: false });
});

app.post("/api/auto-orders", (req, res) => {
  try {
    const { product, supplier = "AliExpress", amount = 0, source_url = "" } = req.body || {};
    if (!product) return res.status(400).json({ success: false, error: "product requis" });
    const orderRef = `AO-${Date.now().toString().slice(-6)}`;
    insertOrder.run(orderRef, product, "ebay_buyer", "pending", supplier, amount, source_url);
    res.json({ success: true, data: { id: orderRef, status: "pending" } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/auto-snipe", async (req, res) => {
  const {
    count = 1,
    margin = 20,
    marketplace = "France",
    ticket = "all",
    testMode = true,
    query = "gadgets",
  } = req.body || {};

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const max = Math.min(Number(count) || 1, 5);
  let scanned = 0;
  let imported = 0;
  let listed = 0;
  let errors = 0;

  try {
    send({ type: "log", message: `[INIT] Auto-Snipe LIVE — Mode ${testMode !== false ? "TEST" : "REEL"}` });
    send({ type: "log", message: `[CONFIG] Market=${marketplace} | Marge=${margin}% | Ticket=${ticket} | Qty=${max}` });
    await sleep(300);

    send({ type: "log", message: `[SCAN] Recherche Amazon FR pour "${query}"...` });
    let products = [];
    try {
      products = await scrapeAmazonSearch(query, { limit: max + 2 });
      scanned = Math.max(products.length * 8, products.length);
      send({ type: "log", message: `[SCAN] ${products.length} produits Amazon trouvés` });
    } catch (err) {
      send({ type: "log", message: `[WARN] Amazon: ${err.message}` });
    }

    if (!products.length) {
      send({ type: "log", message: `[SCAN] Fallback eBay Browse API...` });
      try {
        const r = await browseSearch(query, {
          marketplace: marketplace === "United States" ? "US" : "FR",
          limit: max + 2,
        });
        products = r.items.map((i) => ({
          title: i.title,
          url: i.url,
          price: i.price,
          image: i.image,
          source: "ebay-browse",
        }));
        scanned = products.length * 5;
        send({ type: "log", message: `[SCAN] ${products.length} produits eBay API (${r.api})` });
      } catch (err) {
        send({ type: "log", message: `[WARN] eBay API: ${err.message}` });
        try {
          const ebay = await scrapeEbaySearch(query, {
            marketplace: marketplace === "United States" ? "US" : "FR",
            limit: max,
          });
          products = ebay.items.map((i) => ({
            title: i.title,
            url: i.url,
            price: i.price,
            image: i.image,
            source: "ebay-scrape",
          }));
          scanned = products.length * 5;
        } catch (err2) {
          send({ type: "log", message: `[ERROR] Aucune source disponible: ${err2.message}` });
        }
      }
    }
    send({ type: "stats", scanned, imported, listed, errors });

    for (let i = 0; i < Math.min(max, products.length || max); i++) {
      let p = products[i];
      try {
        if (!p) {
          p = { title: `Produit Snipe ${i + 1}`, price: 12.5, url: "", source: "fallback" };
        }

        send({ type: "log", message: `[IMPORT] ${p.title.slice(0, 70)} — coût ~${(p.price || 10).toFixed?.(2) || p.price}€` });
        await sleep(400);

        // Enrichir via scrape produit si URL Amazon
        let detail = null;
        if (p.url && String(p.source).includes("amazon")) {
          try {
            detail = await scrapeProduct(p.url);
            send({ type: "log", message: `[IMPORT] Détails récupérés (${detail.images.length} images)` });
          } catch (e) {
            send({ type: "log", message: `[WARN] Détail produit: ${e.message}` });
          }
        }

        const cost = detail?.price || p.price || 10;
        const sellPrice = Number((cost * (1 + Number(margin) / 100) * 1.35).toFixed(2));
        const html = detail
          ? buildHtmlFromProduct(detail, "#667eea")
          : buildDescriptionFromUrl(p.url || `https://www.amazon.fr/s?k=${encodeURIComponent(p.title)}`).html_description;

        const insert = db.prepare(
          "INSERT INTO listings (seo_title, html_description, suggested_price, keywords, source_url) VALUES (?, ?, ?, ?, ?)"
        );
        const title = (detail?.title || p.title || "Produit EBX").slice(0, 80);
        const result = insert.run(title, html, sellPrice, query, p.url || "");
        imported += 1;
        send({ type: "stats", scanned, imported, listed, errors });

        if (testMode !== false) {
          send({
            type: "log",
            message: `[SIMULATION] Listé sur eBay à ${sellPrice} EUR — "${title.slice(0, 50)}" (id local ${result.lastInsertRowid})`,
          });
          listed += 1;
        } else {
          send({ type: "log", message: `[LISTING] Publication eBay Sandbox...` });
          try {
            const listing = getListingById.get(Number(result.lastInsertRowid));
            const pub = await publishToEbay(listing, listing.id);
            send({ type: "log", message: `[OK] Publié — listingId=${pub.listingId || "n/a"}` });
            listed += 1;
          } catch (e) {
            errors += 1;
            send({ type: "log", message: `[ERROR] Publish: ${e.message}` });
          }
        }

        // Crée aussi un auto-order fournisseur
        insertOrder.run(
          `AO-${Date.now().toString().slice(-6)}`,
          title.slice(0, 80),
          "ebay_buyer",
          "pending",
          p.source === "amazon" ? "Amazon" : "AliExpress",
          cost,
          p.url || ""
        );

        send({ type: "stats", scanned, imported, listed, errors });
        await sleep(300);
      } catch (err) {
        errors += 1;
        send({ type: "log", message: `[ERROR] ${err.message}` });
        send({ type: "stats", scanned, imported, listed, errors });
      }
    }

    if (!products.length) {
      send({ type: "log", message: `[WARN] Aucun produit source — rien à lister` });
    }

    send({ type: "log", message: `[DONE] Auto-Snipe terminé — ${listed} listé(s), ${imported} importé(s)` });
    send({ type: "done", scanned, imported, listed, errors });
  } catch (err) {
    send({ type: "log", message: `[ERROR] ${err.message}` });
  }
  res.end();
});

app.post("/api/generate-listing", async (req, res) => {
  const { productName, rawKeywords, productUrl, themeColor } = req.body || {};

  try {
    let listing;
    let scraped = null;

    if (productUrl) {
      try {
        scraped = await scrapeProduct(productUrl);
        listing = {
          product_name: scraped.title,
          seo_title: `${scraped.title}`.slice(0, 80),
          suggested_price: scraped.price ? Number((scraped.price * 1.8).toFixed(2)) : 29.99,
          html_description: buildHtmlFromProduct(scraped, themeColor || "#667eea"),
          images: scraped.images,
          source: scraped.source,
          live: true,
        };
      } catch (scrapeErr) {
        console.warn("[EBX] scrape produit fail:", scrapeErr.message);
        listing = buildDescriptionFromUrl(productUrl, themeColor || "#667eea");
        listing.live = false;
        listing.scrape_error = scrapeErr.message;
      }

      // Enrichissement LLM optionnel
      try {
        const aiPromise = generateListing(
          listing.product_name || listing.seo_title,
          `url:${productUrl}, bullets:${(scraped?.bullets || []).join(" | ")}, theme:${themeColor || "#667eea"}`
        );
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("LLM timeout")), 3000));
        const ai = await Promise.race([aiPromise, timeout]);
        if (ai?.html_description && !ai._parse_error) {
          listing = {
            ...listing,
            seo_title: ai.seo_title || listing.seo_title,
            html_description: ai.html_description,
            suggested_price: ai.suggested_price || listing.suggested_price,
            ai_enriched: true,
          };
        }
      } catch (llmErr) {
        console.warn("[EBX] LLM skip:", llmErr.message);
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
  console.log(`🌐 Mode: live scrapers + fallbacks`);
});
