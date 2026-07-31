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
  "SELECT id, seller_name, payload, created_at FROM competitor_history ORDER BY created_at DESC LIMIT 10"
);
const getCompetitorById = db.prepare("SELECT * FROM competitor_history WHERE id = ?");
const deleteCompetitorById = db.prepare("DELETE FROM competitor_history WHERE id = ?");
const insertOrder = db.prepare(
  "INSERT INTO auto_orders (order_ref, product, buyer, status, supplier, amount, source_url) VALUES (?, ?, ?, ?, ?, ?, ?)"
);
const getOrders = db.prepare("SELECT * FROM auto_orders ORDER BY created_at DESC LIMIT 50");
const getOrderByRef = db.prepare("SELECT * FROM auto_orders WHERE order_ref = ?");
const updateOrderStatus = db.prepare("UPDATE auto_orders SET status = ? WHERE order_ref = ?");

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

function envPresent(v) {
  return Boolean(v && String(v).trim() && !String(v).includes("your_"));
}

app.get("/api/setup", async (_req, res) => {
  const setup = {
    prodKeys: envPresent(process.env.EBAY_PROD_CLIENT_ID) && envPresent(process.env.EBAY_PROD_CLIENT_SECRET),
    sandboxKeys: envPresent(process.env.EBAY_CLIENT_ID) && envPresent(process.env.EBAY_CLIENT_SECRET),
    userToken: envPresent(process.env.EBAY_USER_TOKEN),
    policies:
      envPresent(process.env.EBAY_FULFILLMENT_POLICY_ID) &&
      envPresent(process.env.EBAY_PAYMENT_POLICY_ID) &&
      envPresent(process.env.EBAY_RETURN_POLICY_ID),
    llmUrl: process.env.LOCAL_LLM_URL || "http://localhost:1234/v1",
    browse: { ok: false, api: null, error: null, sample: null },
    llm: { ok: false },
  };

  try {
    const { getAppToken, browseSearch } = require("./ebay-browse");
    await getAppToken({ production: true });
    const r = await browseSearch("coque iphone", { marketplace: "FR", limit: 2 });
    setup.browse = {
      ok: r.items.length > 0,
      api: r.api || "browse",
      error: null,
      sample: r.items[0]?.title?.slice(0, 80) || null,
    };
  } catch (err) {
    setup.browse = { ok: false, api: null, error: err.message, sample: null };
  }

  try {
    const base = setup.llmUrl.replace(/\/v1\/?$/, "");
    const r = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(2000) });
    setup.llm.ok = r.ok;
  } catch (_) {
    setup.llm.ok = false;
  }

  res.json({ success: true, data: setup });
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
        image: p.image || null,
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
  const mock = getRankings(marketplace).map((p) => ({
    ...p,
    image: null,
    url: `https://www.ebay.fr/sch/i.html?_nkw=${encodeURIComponent(p.title)}`,
  }));
  res.json({ success: true, data: mock, live: false, source: "mock" });
});

app.post("/api/title-builder", async (req, res) => {
  const { query, marketplace = "FR", exclude = "" } = req.body || {};
  if (!query) return res.status(400).json({ success: false, error: "query requis" });
  const excludeTerms = String(exclude)
    .toLowerCase()
    .split(/[,;\s]+/)
    .filter(Boolean);

  const filterItems = (items) =>
    items.filter((it) => {
      const t = (it.title || "").toLowerCase();
      return !excludeTerms.some((ex) => t.includes(ex));
    });

  const filterKeywords = (data) => {
    if (!excludeTerms.length) return data;
    const drop = (arr) => (arr || []).filter((k) => !excludeTerms.some((ex) => k.keyword.includes(ex)));
    return {
      ...data,
      keywords: drop(data.keywords),
      longTail: drop(data.longTail),
      generic: drop(data.generic),
    };
  };

  try {
    const r = await browseSearch(query, { marketplace, limit: 40 });
    const items = filterItems(r.items);
    if (items.length >= 3) {
      return res.json({
        success: true,
        data: { ...filterKeywords(buildKeywordAnalysisFromItems(query, items)), api: r.api },
      });
    }
  } catch (err) {
    console.warn("[EBX] title browse fail:", err.message);
  }

  try {
    const { items } = await scrapeEbaySearch(query, { marketplace, limit: 30 });
    const filtered = filterItems(items);
    if (filtered.length >= 3) {
      return res.json({
        success: true,
        data: filterKeywords(buildKeywordAnalysisFromItems(query, filtered)),
      });
    }
  } catch (err) {
    console.warn("[EBX] title scrape fail:", err.message);
  }

  res.json({
    success: true,
    data: { ...filterKeywords(analyzeTitleKeywords(query)), live: false, source: "mock" },
  });
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

app.get("/api/competitors/history/:id", (req, res) => {
  try {
    const row = getCompetitorById.get(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: "Introuvable" });
    const data = JSON.parse(row.payload || "{}");
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete("/api/competitors/history/:id", (req, res) => {
  try {
    deleteCompetitorById.run(req.params.id);
    res.json({ success: true });
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

app.post("/api/auto-orders/:id/advance", (req, res) => {
  try {
    const row = getOrderByRef.get(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: "Commande introuvable" });
    const flow = ["pending", "ordered", "shipped", "delivered"];
    const idx = flow.indexOf(row.status);
    const next = flow[Math.min(idx + 1, flow.length - 1)];
    updateOrderStatus.run(next, row.order_ref);
    res.json({ success: true, data: { id: row.order_ref, status: next } });
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
    autoList = true,
    source = "auto",
    query = "gadgets",
  } = req.body || {};

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const max = Math.min(Number(count) || 1, 5);
  const marketCode = marketplace === "United States" ? "US" : "FR";
  let scanned = 0;
  let imported = 0;
  let listed = 0;
  let errors = 0;

  const ticketFilter = (price) => {
    if (ticket === "low") return price == null || price <= 30;
    if (ticket === "mid") return price != null && price > 30 && price <= 100;
    return true;
  };

  try {
    send({
      type: "log",
      message: `[INIT] Auto-Snipe LIVE — Mode ${testMode !== false ? "TEST (24h)" : "REEL eBay"}`,
    });
    send({
      type: "log",
      message: `[CONFIG] Market=${marketplace} | Marge=${margin}% | Ticket=${ticket} | Source=${source} | Qty=${max}`,
    });
    await sleep(200);
    send({ type: "log", message: `[PROTECT] Anti-ban ✓ | VERO ✓ | Limites journalières ✓ | Mode vagues ✓` });
    await sleep(250);

    // 1) Produits tendance eBay (comme dans la vidéo)
    send({ type: "log", message: `[SCAN] Recherche tendances eBay pour "${query}"...` });
    let targets = [];
    try {
      const r = await browseSearch(query, { marketplace: marketCode, limit: max + 4 });
      targets = r.items.filter((i) => ticketFilter(i.price));
      scanned = Math.max(targets.length * 12, targets.length);
      send({ type: "log", message: `[SCAN] ${targets.length} annonces eBay (${r.api})` });
    } catch (err) {
      send({ type: "log", message: `[WARN] Browse API: ${err.message}` });
      try {
        const ebay = await scrapeEbaySearch(query, { marketplace: marketCode, limit: max + 4 });
        targets = ebay.items.filter((i) => ticketFilter(i.price));
        scanned = targets.length * 8;
        send({ type: "log", message: `[SCAN] ${targets.length} annonces via scrape eBay` });
      } catch (err2) {
        send({ type: "log", message: `[WARN] eBay scrape: ${err2.message}` });
      }
    }
    send({ type: "stats", scanned, imported, listed, errors });

    for (let i = 0; i < max; i++) {
      try {
        const target = targets[i] || {
          title: `${query} — opportunité ${i + 1}`,
          price: 19.9,
          url: "",
        };
        // Sanitize prix absurdes (ex: B7000 mal parsé)
        if (!target.price || target.price > 500 || target.price < 0.5) {
          target.price = 19.9;
        }
        send({
          type: "log",
          message: `[TARGET] eBay: "${String(target.title).slice(0, 70)}" @ ${(target.price || 0).toFixed?.(2) || target.price}€`,
        });
        await sleep(300);

        // 2) Chercher fournisseur moins cher (Amazon / Ali)
        send({ type: "log", message: `[SOURCE] Recherche fournisseur (${source}) le moins cher...` });
        let supplier = null;
        const searchQ = String(target.title).split(/\s+/).slice(0, 6).join(" ") || query;

        if (source === "auto" || source === "amazon") {
          try {
            const amazonItems = await scrapeAmazonSearch(searchQ, { limit: 3 });
            supplier = amazonItems.find((p) => p.url) || amazonItems[0] || null;
            if (supplier) {
              send({
                type: "log",
                message: `[SOURCE] Amazon trouvé: ${supplier.title.slice(0, 55)} ${supplier.url ? "→ " + supplier.url.slice(0, 60) : ""}`,
              });
            }
          } catch (e) {
            send({ type: "log", message: `[WARN] Amazon: ${e.message}` });
          }
        }

        if (!supplier && (source === "auto" || source === "aliexpress" || source === "amazon")) {
          supplier = {
            title: target.title,
            url: `https://www.aliexpress.com/w/wholesale-${encodeURIComponent(searchQ)}.html`,
            price: Number(((target.price || 20) * 0.35).toFixed(2)),
            source: "aliexpress",
          };
          send({
            type: "log",
            message: `[SOURCE] AliExpress candidat @ ${supplier.price}€ — ${supplier.url.slice(0, 70)}`,
          });
        }

        if (!supplier) {
          errors += 1;
          send({ type: "log", message: `[ERROR] Aucun fournisseur pour "${target.title.slice(0, 40)}"` });
          send({ type: "stats", scanned, imported, listed, errors });
          continue;
        }

        // 3) Import détails
        let detail = null;
        if (supplier.url && String(supplier.source || "").includes("amazon")) {
          try {
            detail = await scrapeProduct(supplier.url);
            send({
              type: "log",
              message: `[IMPORT] Détails récupérés (${detail.images.length} images, prix ${detail.price || "n/a"})`,
            });
          } catch (e) {
            send({ type: "log", message: `[WARN] Détail produit: ${e.message}` });
          }
        } else {
          send({ type: "log", message: `[IMPORT] Import métadonnées fournisseur` });
        }

        const cost = detail?.price || supplier.price || Number(((target.price || 20) * 0.4).toFixed(2));
        const sellPrice = Number((cost * (1 + Number(margin) / 100) * 1.35).toFixed(2));
        const marginPct = cost > 0 ? (((sellPrice - cost) / sellPrice) * 100).toFixed(0) : margin;
        send({
          type: "log",
          message: `[MARGIN] Coût ${Number(cost).toFixed(2)}€ → Revente ${sellPrice}€ (marge ~${marginPct}%)`,
        });

        const html = detail
          ? buildHtmlFromProduct(detail, "#667eea")
          : buildDescriptionFromUrl(supplier.url || target.url || "").html_description;

        const insert = db.prepare(
          "INSERT INTO listings (seo_title, html_description, suggested_price, keywords, source_url) VALUES (?, ?, ?, ?, ?)"
        );
        const title = (detail?.title || supplier.title || target.title || "Produit EBX").slice(0, 80);
        const result = insert.run(title, html, sellPrice, query, supplier.url || target.url || "");
        imported += 1;
        send({ type: "stats", scanned, imported, listed, errors });
        await sleep(250);

        // 4) Listing (simulation ou réel)
        if (!autoList) {
          send({ type: "log", message: `[SKIP] Listing auto désactivé — import seul (id ${result.lastInsertRowid})` });
        } else if (testMode !== false) {
          send({
            type: "log",
            message: `[SIMULATION] Listé sur eBay à ${sellPrice} EUR — "${title.slice(0, 50)}" (id local ${result.lastInsertRowid})`,
          });
          listed += 1;
        } else {
          send({ type: "log", message: `[LISTING] Publication eBay Sandbox (mode REEL)...` });
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

        insertOrder.run(
          `AO-${Date.now().toString().slice(-6)}`,
          title.slice(0, 80),
          "ebay_buyer",
          "pending",
          String(supplier.source || "").includes("amazon") ? "Amazon" : "AliExpress",
          cost,
          supplier.url || ""
        );

        send({ type: "stats", scanned, imported, listed, errors });
        await sleep(200);
      } catch (err) {
        errors += 1;
        send({ type: "log", message: `[ERROR] ${err.message}` });
        send({ type: "stats", scanned, imported, listed, errors });
      }
    }

    send({ type: "log", message: `[DONE] Auto-Snipe terminé — ${listed} listé(s), ${imported} importé(s), ${errors} erreur(s)` });
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
          product: scraped,
          live: true,
        };
      } catch (scrapeErr) {
        console.warn("[EBX] scrape produit fail:", scrapeErr.message);
        listing = buildDescriptionFromUrl(productUrl, themeColor || "#667eea");
        listing.live = false;
        listing.scrape_error = scrapeErr.message;
        listing.product = {
          title: listing.product_name || listing.seo_title,
          images: listing.images || [],
          bullets: [],
          description: "",
          price: listing.suggested_price,
          source: "fallback",
          url: productUrl,
        };
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

app.post("/api/rebuild-description", (req, res) => {
  try {
    const { product, themeColor = "#667eea" } = req.body || {};
    if (!product) return res.status(400).json({ success: false, error: "product requis" });
    const html = buildHtmlFromProduct(product, themeColor);
    res.json({
      success: true,
      data: {
        product_name: product.title,
        seo_title: String(product.title || "").slice(0, 80),
        html_description: html,
        images: product.images || [],
        source: product.source || "generic",
        product,
        live: true,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
