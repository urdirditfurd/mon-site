const { loadEbayEnv } = require("./load-env");
loadEbayEnv();
// Ne pas rappeler dotenv après : il coupe les valeurs contenant # si mal quotées
const express = require("express");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const {
  scrapeProduct,
  scrapeEbaySearch,
  scrapeEbaySeller,
  scrapeRankings,
  scrapeAmazonSearch,
  scrapeAliExpressSearch,
  scrapeCdiscountSearch,
  findCheapestSupplier,
  buildKeywordAnalysisFromItems,
  buildHtmlFromProduct,
  injectProductImagesIntoHtml,
  countRealImagesInHtml,
  isRealProductImage,
} = require("./scraper");
const { browseSearch, browseSellerItems } = require("./ebay-browse");
const {
  antiBanDelay,
  scanVero,
  scoreSeoTitle,
  buildAiTitle,
  estimateMargin,
  buildPilotageFeed,
} = require("./business-engine");
const {
  getRankings,
  analyzeTitleKeywords,
  analyzeCompetitor,
  buildDescriptionFromUrl,
  getDashboardStats,
  getAutoOrders,
} = require("./mock-data");
const { generateListing } = require("./ai-brain");
const { publishToEbay } = require("./ebay-api");

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
if (!listingCols.includes("ebay_listing_id")) {
  db.exec("ALTER TABLE listings ADD COLUMN ebay_listing_id TEXT DEFAULT ''");
}
if (!listingCols.includes("ebay_offer_id")) {
  db.exec("ALTER TABLE listings ADD COLUMN ebay_offer_id TEXT DEFAULT ''");
}
if (!listingCols.includes("publish_env")) {
  db.exec("ALTER TABLE listings ADD COLUMN publish_env TEXT DEFAULT ''");
}
if (!listingCols.includes("published_at")) {
  db.exec("ALTER TABLE listings ADD COLUMN published_at DATETIME");
}

const getRecentListings = db.prepare(
  `SELECT id, seo_title, suggested_price, keywords, source_url, created_at,
          ebay_listing_id, ebay_offer_id, publish_env, published_at,
          CASE
            WHEN html_description LIKE '%<img%'
             AND html_description NOT LIKE '%picsum.photos%'
            THEN 1 ELSE 0
          END AS has_images
   FROM listings ORDER BY created_at DESC LIMIT 500`
);
const getListingById = db.prepare("SELECT * FROM listings WHERE id = ?");
const deleteListingById = db.prepare("DELETE FROM listings WHERE id = ?");
const updateListingPublish = db.prepare(
  `UPDATE listings
   SET ebay_listing_id = ?, ebay_offer_id = ?, publish_env = ?, published_at = CURRENT_TIMESTAMP
   WHERE id = ?`
);
const insertListingStmt = db.prepare(
  "INSERT INTO listings (seo_title, html_description, suggested_price, keywords, source_url) VALUES (?, ?, ?, ?, ?)"
);
const findRecentDuplicate = db.prepare(
  `SELECT id FROM listings
   WHERE seo_title = ?
     AND ABS(suggested_price - ?) < 0.01
     AND datetime(created_at) >= datetime('now', '-30 seconds')
   ORDER BY id DESC LIMIT 1`
);

/** Insert listing; si même titre+prix dans les 30s → réutilise l'id (anti double-clic / double sniper). */
function insertListingSafe({ seoTitle, html, price, keywords = "", sourceUrl = "" }) {
  const title = String(seoTitle || "").slice(0, 80);
  const suggested = Number(price) || 0;
  const recent = findRecentDuplicate.get(title, suggested);
  if (recent) {
    return { id: Number(recent.id), duplicate: true };
  }
  const result = insertListingStmt.run(title, String(html || ""), suggested, String(keywords || ""), String(sourceUrl || ""));
  return { id: Number(result.lastInsertRowid), duplicate: false };
}

const insertCompetitor = db.prepare(
  "INSERT INTO competitor_history (seller_name, payload) VALUES (?, ?)"
);
const getCompetitorHistory = db.prepare(
  "SELECT id, seller_name, payload, created_at FROM competitor_history ORDER BY created_at DESC LIMIT 100"
);

db.exec(`
  CREATE TABLE IF NOT EXISTS ebay_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT,
    user_id TEXT,
    refresh_token TEXT,
    env TEXT DEFAULT 'production',
    marketplace TEXT DEFAULT 'EBAY_US',
    is_active INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
const listEbayAccounts = db.prepare(
  "SELECT id, label, user_id, env, marketplace, is_active, created_at FROM ebay_accounts ORDER BY is_active DESC, id DESC"
);
const insertEbayAccount = db.prepare(
  `INSERT INTO ebay_accounts (label, user_id, refresh_token, env, marketplace, is_active)
   VALUES (?, ?, ?, ?, ?, 0)`
);
const clearActiveAccounts = db.prepare("UPDATE ebay_accounts SET is_active = 0");
const activateEbayAccount = db.prepare("UPDATE ebay_accounts SET is_active = 1 WHERE id = ?");
const getEbayAccountById = db.prepare("SELECT * FROM ebay_accounts WHERE id = ?");
const deleteEbayAccount = db.prepare("DELETE FROM ebay_accounts WHERE id = ?");
const getActiveEbayAccount = db.prepare(
  "SELECT * FROM ebay_accounts WHERE is_active = 1 ORDER BY id DESC LIMIT 1"
);
const getCompetitorById = db.prepare("SELECT * FROM competitor_history WHERE id = ?");
const deleteCompetitorById = db.prepare("DELETE FROM competitor_history WHERE id = ?");
const insertOrder = db.prepare(
  "INSERT INTO auto_orders (order_ref, product, buyer, status, supplier, amount, source_url) VALUES (?, ?, ?, ?, ?, ?, ?)"
);
const getOrders = db.prepare("SELECT * FROM auto_orders ORDER BY created_at DESC LIMIT 100");
const getOrderByRef = db.prepare("SELECT * FROM auto_orders WHERE order_ref = ?");
const updateOrderStatus = db.prepare("UPDATE auto_orders SET status = ? WHERE order_ref = ?");

const orderCols = db.prepare("PRAGMA table_info(auto_orders)").all().map((c) => c.name);
if (!orderCols.includes("ship_json")) {
  db.exec("ALTER TABLE auto_orders ADD COLUMN ship_json TEXT DEFAULT ''");
}
if (!orderCols.includes("notes")) {
  db.exec("ALTER TABLE auto_orders ADD COLUMN notes TEXT DEFAULT ''");
}
if (!orderCols.includes("qty")) {
  db.exec("ALTER TABLE auto_orders ADD COLUMN qty INTEGER DEFAULT 1");
}
const updateOrderExtras = db.prepare(
  "UPDATE auto_orders SET ship_json = ?, notes = ?, source_url = ?, supplier = ?, qty = ? WHERE order_ref = ?"
);
const updateOrderSource = db.prepare(
  "UPDATE auto_orders SET source_url = ?, supplier = ? WHERE order_ref = ?"
);

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
  const { isProduction, getSellerIdentity } = require("./ebay-api");
  const setup = {
    prodKeys: envPresent(process.env.EBAY_PROD_CLIENT_ID) && envPresent(process.env.EBAY_PROD_CLIENT_SECRET),
    sandboxKeys: envPresent(process.env.EBAY_CLIENT_ID) && envPresent(process.env.EBAY_CLIENT_SECRET),
    refreshToken: envPresent(process.env.EBAY_REFRESH_TOKEN),
    refreshTokenProd: envPresent(process.env.EBAY_REFRESH_TOKEN_PROD),
    userToken: envPresent(process.env.EBAY_USER_TOKEN),
    ruName: envPresent(process.env.EBAY_RU_NAME),
    ebayEnv: isProduction() ? "production" : "sandbox",
    policies:
      envPresent(process.env.EBAY_FULFILLMENT_POLICY_ID) &&
      envPresent(process.env.EBAY_PAYMENT_POLICY_ID) &&
      envPresent(process.env.EBAY_RETURN_POLICY_ID),
    policiesProd:
      envPresent(process.env.EBAY_FULFILLMENT_POLICY_ID_PROD) &&
      envPresent(process.env.EBAY_PAYMENT_POLICY_ID_PROD) &&
      envPresent(process.env.EBAY_RETURN_POLICY_ID_PROD),
    llmUrl: process.env.LOCAL_LLM_URL || "http://localhost:1234/v1",
    browse: { ok: false, api: null, error: null, sample: null },
    llm: { ok: false },
    seller: { ok: false, userId: null, email: null, error: null },
  };

  try {
    const seller = await getSellerIdentity();
    setup.seller = {
      ok: true,
      userId: seller.userId,
      email: seller.email || null,
      error: null,
    };
  } catch (err) {
    setup.seller = { ok: false, userId: null, email: null, error: err.message };
  }

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

app.get("/api/dashboard", async (_req, res) => {
  try {
    const listings = getRecentListings.all();
    const orders = getOrders.all();
    const base = getDashboardStats(listings.length);
    let seller = null;
    let ebayEnv = "sandbox";
    try {
      const { isProduction, getSellerIdentity } = require("./ebay-api");
      ebayEnv = isProduction() ? "production" : "sandbox";
      seller = await getSellerIdentity();
    } catch (_) {}
    const publishedToday = listings.filter((l) => l.published_at).length;
    const pilotage = buildPilotageFeed({
      listings,
      orders,
      seller,
      ebayEnv,
      publishedToday,
    });
    const published = listings.filter((l) => l.ebay_listing_id).length;

    // CA / commandes depuis auto_orders (sync eBay = données réelles)
    const realRevenue = orders.reduce((s, o) => s + (Number(o.amount) || 0), 0);
    const ebaySynced = orders.filter((o) => String(o.order_ref || "").length > 10).length;
    const pendingOrders = orders.filter((o) => o.status === "pending").length;
    const delivered = orders.filter((o) => o.status === "delivered").length;
    const avgTicket = orders.length ? realRevenue / orders.length : 0;
    const estCost = realRevenue * 0.55;
    const estFees = realRevenue * 0.13;
    const estMarginPct =
      realRevenue > 0 ? Number((((realRevenue - estCost - estFees) / realRevenue) * 100).toFixed(1)) : base.margin;

    if (pendingOrders > 0) {
      pilotage.unshift({
        level: "warn",
        title: `${pendingOrders} commande(s) à traiter`,
        detail: "Auto-Order → Sync eBay → copie l'adresse → ouvre le fournisseur → Avancer.",
      });
    }

    res.json({
      success: true,
      data: {
        ...base,
        revenue: Number(realRevenue.toFixed(2)),
        revenueSource: ebaySynced ? "ebay_orders" : orders.length ? "local_orders" : "estimate",
        margin: estMarginPct,
        avgTicket: Number(avgTicket.toFixed(2)),
        listings: listings.length,
        published,
        pendingOrders,
        delivered,
        orders: orders.length,
        ebaySynced,
        ebayEnv,
        sellerUserId: seller?.userId || null,
        pilotage,
        plan: "Business",
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function findSupplierForTitle(title) {
  const t = String(title || "").toLowerCase();
  const words = t.split(/\s+/).filter((w) => w.length > 3).slice(0, 5);
  if (!words.length) return { source_url: "", supplier: "Fournisseur" };
  const rows = getRecentListings.all();
  let best = null;
  let bestScore = 0;
  for (const row of rows) {
    const lt = String(row.seo_title || "").toLowerCase();
    let score = 0;
    for (const w of words) if (lt.includes(w)) score += 1;
    if (row.source_url && score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  if (best && bestScore >= 2) {
    const src = best.source_url || "";
    const supplier = /amazon/i.test(src)
      ? "Amazon"
      : /cdiscount/i.test(src)
        ? "Cdiscount"
        : /aliexpress/i.test(src)
          ? "AliExpress"
          : "Fournisseur";
    return { source_url: src, supplier, listingId: best.id };
  }
  return { source_url: "", supplier: "eBay→fournisseur" };
}

function formatShipAddress(order) {
  const addr =
    order?.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo ||
    order?.buyer?.buyerRegistrationAddress ||
    null;
  if (!addr) return { text: "", json: "" };
  const name = [addr.fullName, addr.companyName].filter(Boolean).join(" — ");
  const lines = [
    name,
    addr.contactAddress?.addressLine1,
    addr.contactAddress?.addressLine2,
    [addr.contactAddress?.postalCode, addr.contactAddress?.city].filter(Boolean).join(" "),
    addr.contactAddress?.stateOrProvince,
    addr.contactAddress?.countryCode,
    addr.primaryPhone?.phoneNumber ? `Tél: ${addr.primaryPhone.phoneNumber}` : "",
  ].filter(Boolean);
  return { text: lines.join("\n"), json: JSON.stringify(addr) };
}

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
      const data = filterKeywords(buildKeywordAnalysisFromItems(query, items));
      const suggested = buildAiTitle(
        query,
        (data.keywords || []).slice(0, 6).map((k) => k.keyword)
      );
      return res.json({
        success: true,
        data: {
          ...data,
          api: r.api,
          suggestedTitle: suggested,
          seo: scoreSeoTitle(
            suggested,
            (data.keywords || []).slice(0, 8).map((k) => k.keyword)
          ),
        },
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

    let data = null;
    const attempts = [];

    try {
      data = await browseSellerItems(seller, { marketplace });
      attempts.push("browse");
    } catch (err) {
      console.warn("[EBX] competitor browse fail:", err.message);
    }

    if (!data || !data.activeListings) {
      try {
        data = await scrapeEbaySeller(seller, { marketplace });
        attempts.push("scrape");
      } catch (err2) {
        console.warn("[EBX] competitor scrape fail:", err2.message);
      }
    }

    if (!data || !data.activeListings) {
      data = { ...analyzeCompetitor(seller), live: false, source: "mock" };
      attempts.push("mock");
    }

    data._pipeline = attempts.join("→");
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
        data: rows.map((o) => {
          let ship = null;
          try {
            ship = o.ship_json ? JSON.parse(o.ship_json) : null;
          } catch (_) {}
          return {
            id: o.order_ref,
            product: o.product,
            buyer: o.buyer,
            status: o.status,
            supplier: o.supplier,
            amount: o.amount,
            source_url: o.source_url || "",
            notes: o.notes || "",
            qty: o.qty || 1,
            shipText: o.notes || "",
            ship,
            created_at: o.created_at,
            fromEbay: String(o.order_ref || "").length > 12,
          };
        }),
        live: true,
      });
    }
  } catch (_) {}
  res.json({ success: true, data: getAutoOrders(), live: false });
});

app.get("/api/auto-orders/:id", (req, res) => {
  const row = getOrderByRef.get(req.params.id);
  if (!row) return res.status(404).json({ success: false, error: "Commande introuvable" });
  let ship = null;
  try {
    ship = row.ship_json ? JSON.parse(row.ship_json) : null;
  } catch (_) {}
  res.json({
    success: true,
    data: {
      ...row,
      id: row.order_ref,
      ship,
      shipText: row.notes || "",
    },
  });
});

app.post("/api/auto-orders/:id/open-supplier", (req, res) => {
  try {
    const row = getOrderByRef.get(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: "Commande introuvable" });
    let url = row.source_url;
    if (!url) {
      const found = findSupplierForTitle(row.product);
      url = found.source_url;
      if (url) updateOrderSource.run(url, found.supplier, row.order_ref);
    }
    if (!url) {
      const q = encodeURIComponent(String(row.product || "").split(/\s+/).slice(0, 6).join(" "));
      url = `https://www.aliexpress.com/w/wholesale-${q}.html`;
    }
    if (row.status === "pending") updateOrderStatus.run("ordered", row.order_ref);
    res.json({
      success: true,
      data: {
        id: row.order_ref,
        url,
        shipText: row.notes || "",
        status: row.status === "pending" ? "ordered" : row.status,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
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
  const max = Math.min(Math.max(Number(count) || 1, 1), 100);
  const marketCode =
    /united states|ebay_us|\bus\b/i.test(String(marketplace))
      ? "US"
      : /germany|ebay_de|\bde\b/i.test(String(marketplace))
        ? "DE"
        : /united kingdom|ebay_gb|\bgb\b/i.test(String(marketplace))
          ? "GB"
          : "FR";
  let scanned = 0;
  let imported = 0;
  let listed = 0;
  let errors = 0;
  let veroBlocked = 0;

  const ticketFilter = (price) => {
    if (ticket === "low") return price == null || price <= 30;
    if (ticket === "mid") return price != null && price > 30 && price <= 100;
    return true;
  };

  try {
    send({
      type: "log",
      message: `[INIT] Auto-Snipe BUSINESS — Mode ${testMode !== false ? "TEST (délais courts)" : "REEL (anti-ban humain)"}`,
    });
    send({
      type: "log",
      message: `[CONFIG] Market=${marketplace} (${marketCode}) | Marge=${margin}% | Ticket=${ticket} | Source=${source} | Qty=${max}`,
    });
    const d0 = await antiBanDelay({ testMode: testMode !== false, label: "init" });
    send({
      type: "log",
      message: `[PROTECT] Anti-ban ${testMode !== false ? "souple" : "humain"} ✓ (${d0.waitedMs}ms${d0.deferred ? ", hors horaires" : ""}) | VeRO scan ✓ | Sans quota abonnement ✓`,
    });
    await antiBanDelay({ testMode: testMode !== false, label: "scan" });

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
        const vero = scanVero(target.title);
        if (vero.level === "block") {
          veroBlocked += 1;
          send({ type: "log", message: `[VERO] BLOQUÉ — ${vero.message}` });
          errors += 1;
          send({ type: "stats", scanned, imported, listed, errors });
          continue;
        }
        if (!vero.ok) {
          send({ type: "log", message: `[VERO] Attention — ${vero.message}` });
        }
        await antiBanDelay({ testMode: testMode !== false, label: "target" });

        // 2) Comparer fournisseurs Amazon / Ali / Cdiscount (prix réels si dispo)
        send({ type: "log", message: `[SOURCE] Comparaison live fournisseurs (${source})...` });
        let supplier = null;
        const searchQ = String(target.title).split(/\s+/).slice(0, 6).join(" ") || query;

        const sourceList =
          source === "amazon"
            ? ["amazon"]
            : source === "aliexpress"
              ? ["aliexpress"]
              : source === "cdiscount"
                ? ["cdiscount"]
                : ["amazon", "aliexpress", "cdiscount"];

        try {
          const cmp = await findCheapestSupplier(searchQ, { sources: sourceList, limit: 3 });
          if (cmp.best) {
            supplier = cmp.best;
            send({
              type: "log",
              message: `[SOURCE] ${cmp.compared} prix réels comparés → meilleur: ${String(supplier.source).split("+")[0]} @ ${
                supplier.price != null ? Number(supplier.price).toFixed(2) + "€" : "prix n/a"
              } — ${String(supplier.title || "").slice(0, 50)}`,
            });
            if (cmp.candidates.length > 1) {
              const preview = cmp.candidates
                .slice(0, 3)
                .map((c) => `${String(c.source).split("+")[0]}:${c.price != null ? c.price.toFixed(2) : "?"}`)
                .join(" | ");
              send({ type: "log", message: `[SOURCE] Top: ${preview}` });
            }
          }
        } catch (e) {
          send({ type: "log", message: `[WARN] Comparaison fournisseurs: ${e.message}` });
        }

        // Fallback historique si aucun résultat scrape
        if (!supplier) {
          supplier = {
            title: target.title,
            url: `https://www.aliexpress.com/w/wholesale-${encodeURIComponent(searchQ)}.html`,
            price: Number(((target.price || 20) * 0.4).toFixed(2)),
            source: "aliexpress-estimate",
          };
          send({
            type: "log",
            message: `[SOURCE] Fallback estimé AliExpress @ ${supplier.price}€ (scrapes vides)`,
          });
        }

        // 3) Import détails — fiche produit si URL item (pas page recherche)
        let detail = null;
        const isProductUrl =
          supplier.url &&
          !/wholesale-|\/search\/|SearchText=/i.test(supplier.url) &&
          (/amazon\.|\/item\/|cdiscount\.com\/.+\.html/i.test(supplier.url));
        if (isProductUrl) {
          try {
            detail = await scrapeProduct(supplier.url);
            if (detail.price && (!supplier.price || detail.price < supplier.price)) {
              supplier.price = detail.price;
            }
            send({
              type: "log",
              message: `[IMPORT] Détails récupérés (${(detail.images || []).length} images, prix ${detail.price || "n/a"})`,
            });
          } catch (e) {
            send({ type: "log", message: `[WARN] Détail produit: ${e.message}` });
          }
        } else {
          send({ type: "log", message: `[IMPORT] Métadonnées eBay + fournisseur` });
        }

        const cost = detail?.price || supplier.price || Number(((target.price || 20) * 0.4).toFixed(2));
        const sellPrice = Number((cost * (1 + Number(margin) / 100) * 1.35).toFixed(2));
        const marginPct = cost > 0 ? (((sellPrice - cost) / sellPrice) * 100).toFixed(0) : margin;
        send({
          type: "log",
          message: `[MARGIN] Coût ${Number(cost).toFixed(2)}€ → Revente ${sellPrice}€ (marge ~${marginPct}%)`,
        });

        const title = (detail?.title || supplier.title || target.title || "Produit EBX").slice(0, 80);
        const images = [
          ...(detail?.images || []),
          target.image,
          supplier.image,
        ].filter(isRealProductImage);

        const html = buildHtmlFromProduct(
          {
            title,
            images,
            bullets: detail?.bullets?.length
              ? detail.bullets
              : [
                  "Produit sélectionné via Auto-Snipe",
                  `Source: ${supplier.source || "fournisseur"}`,
                  "Description à enrichir avant publication",
                ],
            description:
              detail?.description ||
              `Opportunité eBay : ${target.title || title}. Fournisseur estimé à ${Number(cost).toFixed(2)}€.`,
            price: cost,
            source: detail?.source || supplier.source || "snipe",
          },
          "#667eea"
        );

        const result = insertListingSafe({
          seoTitle: title,
          html,
          price: sellPrice,
          keywords: query,
          sourceUrl: supplier.url || target.url || "",
        });
        if (result.duplicate) {
          send({ type: "log", message: `[SKIP] Doublon récent ignoré — "${title.slice(0, 40)}" (id ${result.id})` });
          send({ type: "stats", scanned, imported, listed, errors });
          continue;
        }
        imported += 1;
        send({ type: "stats", scanned, imported, listed, errors });
        await antiBanDelay({ testMode: testMode !== false, label: "import" });

        // 4) Listing (simulation ou réel)
        if (!autoList) {
          send({ type: "log", message: `[SKIP] Listing auto désactivé — import seul (id ${result.id})` });
        } else if (testMode !== false) {
          send({
            type: "log",
            message: `[SIMULATION] Listé sur eBay à ${sellPrice} EUR — "${title.slice(0, 50)}" (id local ${result.id})`,
          });
          listed += 1;
        } else {
          send({ type: "log", message: `[LISTING] Publication eBay (mode REEL)...` });
          try {
            const listing = getListingById.get(Number(result.id));
            const pub = await publishToEbay(listing, listing.id);
            if (pub?.listingId) {
              updateListingPublish.run(
                String(pub.listingId),
                String(pub.offerId || ""),
                String(pub.env || ""),
                listing.id
              );
            }
            send({ type: "log", message: `[OK] Publié — listingId=${pub.listingId || "n/a"}` });
            listed += 1;
          } catch (e) {
            errors += 1;
            send({ type: "log", message: `[ERROR] Publish: ${e.message}` });
          }
        }

        const supplierLabel = /amazon/i.test(supplier.source || "")
          ? "Amazon"
          : /cdiscount/i.test(supplier.source || "")
            ? "Cdiscount"
            : "AliExpress";
        insertOrder.run(
          `AO-${Date.now().toString().slice(-6)}`,
          title.slice(0, 80),
          "ebay_buyer",
          "pending",
          supplierLabel,
          cost,
          supplier.url || ""
        );

        send({ type: "stats", scanned, imported, listed, errors });
        await antiBanDelay({ testMode: testMode !== false, label: "loop" });
      } catch (err) {
        errors += 1;
        send({ type: "log", message: `[ERROR] ${err.message}` });
        send({ type: "stats", scanned, imported, listed, errors });
      }
    }

    send({
      type: "log",
      message: `[DONE] Auto-Snipe terminé — ${listed} listé(s), ${imported} importé(s), ${errors} erreur(s), VeRO bloqués=${veroBlocked}`,
    });
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
        scraped.images = (scraped.images || []).filter(isRealProductImage);
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
          const aiHtml = injectProductImagesIntoHtml(
            ai.html_description,
            scraped?.images || listing.images || []
          );
          listing = {
            ...listing,
            seo_title: ai.seo_title || listing.seo_title,
            html_description: aiHtml,
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

    const result = insertListingSafe({
      seoTitle: listing.seo_title || "",
      html: listing.html_description || "",
      price: listing.suggested_price || 0,
      keywords: rawKeywords || "",
      sourceUrl: productUrl || "",
    });

    return res.json({
      success: true,
      data: { ...listing, id: result.id, duplicate: result.duplicate || false },
    });
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

app.delete("/api/listings/:id", (req, res) => {
  try {
    deleteListingById.run(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/listings/dedupe", (_req, res) => {
  try {
    // Garde le plus récent par titre SEO normalisé
    const rows = db.prepare("SELECT id, seo_title, created_at FROM listings ORDER BY created_at DESC").all();
    const seen = new Set();
    let removed = 0;
    for (const row of rows) {
      const key = String(row.seo_title || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60);
      if (!key) continue;
      if (seen.has(key)) {
        deleteListingById.run(row.id);
        removed += 1;
      } else {
        seen.add(key);
      }
    }
    return res.json({ success: true, removed, remaining: getRecentListings.all().length });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

const updateListingHtml = db.prepare("UPDATE listings SET html_description = ? WHERE id = ?");

/**
 * Si le HTML n'a plus d'images (scrub picsum / IA), re-scrape source_url et réinjecte.
 */
async function ensureListingImages(listing) {
  if (countRealImagesInHtml(listing.html_description) > 0) {
    return listing;
  }

  const sourceUrl = String(listing.source_url || "").trim();
  if (!sourceUrl) {
    throw new Error(
      "Aucune image produit dans le listing HTML et pas de source_url. " +
        "Régénère via Description Builder (URL Amazon/eBay) ou Auto-Snipe, puis republie."
    );
  }

  console.log(`[EBX] Listing #${listing.id} sans image — re-scrape ${sourceUrl.slice(0, 70)}…`);
  const scraped = await scrapeProduct(sourceUrl);
  const images = (scraped.images || []).filter(isRealProductImage);
  if (!images.length) {
    throw new Error(
      "Impossible de récupérer des images depuis la source. " +
        "Ouvre Description Builder avec une URL produit qui a des photos, sauvegarde, puis publie."
    );
  }

  const html = injectProductImagesIntoHtml(listing.html_description, images);
  if (countRealImagesInHtml(html) === 0) {
    // Fallback : reconstruit un HTML propre avec images
    const rebuilt = buildHtmlFromProduct(
      {
        title: listing.seo_title || scraped.title,
        images,
        bullets: scraped.bullets || [],
        description: scraped.description || listing.seo_title,
        price: listing.suggested_price,
        source: scraped.source || "repair",
      },
      "#667eea"
    );
    updateListingHtml.run(rebuilt, listing.id);
    return { ...listing, html_description: rebuilt };
  }

  updateListingHtml.run(html, listing.id);
  console.log(`[EBX] Listing #${listing.id} : ${images.length} image(s) réinjectée(s)`);
  return { ...listing, html_description: html };
}

/** Remplace les images picsum (aléatoires) dans le HTML des listings existants. */
app.post("/api/listings/scrub-images", (_req, res) => {
  try {
    const rows = db.prepare("SELECT id, html_description FROM listings").all();
    const update = db.prepare("UPDATE listings SET html_description = ? WHERE id = ?");
    const placeholder =
      '<div style="background:#f4f4f5;border-radius:14px;padding:40px 16px;text-align:center;color:#71717a;font-size:13px;">Image produit à ajouter (ancienne image aléatoire retirée)</div>';
    let fixed = 0;
    for (const row of rows) {
      const html = String(row.html_description || "");
      if (!/picsum\.photos/i.test(html)) continue;
      const cleaned = html.replace(
        /<img[^>]+src=["'][^"']*picsum\.photos[^"']*["'][^>]*>/gi,
        placeholder
      );
      if (cleaned !== html) {
        update.run(cleaned, row.id);
        fixed += 1;
      }
    }
    return res.json({ success: true, fixed });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/** Répare les images d'un listing (re-scrape source_url). */
app.post("/api/listings/:id/repair-images", async (req, res) => {
  try {
    const listing = getListingById.get(req.params.id);
    if (!listing) return res.status(404).json({ success: false, error: "Listing introuvable." });
    const updated = await ensureListingImages(listing);
    const n = countRealImagesInHtml(updated.html_description);
    return res.json({ success: true, images: n, id: listing.id });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/publish-to-ebay/:id", async (req, res) => {
  try {
    let listing = getListingById.get(req.params.id);
    if (!listing) return res.status(404).json({ success: false, error: "Listing introuvable." });
    const vero = scanVero(`${listing.seo_title} ${listing.html_description || ""}`);
    if (vero.level === "block" && !req.body?.force) {
      return res.status(400).json({
        success: false,
        error: `VeRO: ${vero.message}. Corrige le titre ou force=true si tu assumes le risque.`,
        vero,
      });
    }
    listing = await ensureListingImages(listing);
    const { isProduction, getSellerIdentity } = require("./ebay-api");
    let sellerUserId = null;
    try {
      const seller = await getSellerIdentity();
      sellerUserId = seller.userId;
      console.log(
        `[EBX] Publish pour compte ${seller.userId} (${isProduction() ? "PRODUCTION" : "sandbox"})` +
          (vero.ok ? "" : ` | ${vero.message}`)
      );
    } catch (err) {
      console.warn("[EBX] GetUser avant publish:", err.message);
    }
    await antiBanDelay({ testMode: false, label: "publish" });
    const result = await publishToEbay(listing, listing.id);
    if (result?.listingId) {
      updateListingPublish.run(
        String(result.listingId),
        String(result.offerId || ""),
        String(result.env || (isProduction() ? "production" : "sandbox")),
        listing.id
      );
      const saved = getListingById.get(listing.id);
      console.log(
        `[EBX] Listing #${listing.id} mémorisé → ebay_listing_id=${saved?.ebay_listing_id} env=${saved?.publish_env}`
      );
    }
    return res.json({
      success: true,
      data: { ...result, sellerUserId, vero },
    });
  } catch (err) {
    console.error("[EBX] Erreur eBay :", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/ai-title", (req, res) => {
  try {
    const { productName, keywords = [] } = req.body || {};
    if (!productName) return res.status(400).json({ success: false, error: "productName requis" });
    const title = buildAiTitle(productName, keywords);
    const seo = scoreSeoTitle(title, keywords);
    const vero = scanVero(title);
    res.json({ success: true, data: { title, seo, vero } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/vero-scan", (req, res) => {
  const text = req.body?.text || req.body?.title || "";
  res.json({ success: true, data: scanVero(text) });
});

app.post("/api/listings/:id/sync", async (req, res) => {
  try {
    let listing = getListingById.get(req.params.id);
    if (!listing) return res.status(404).json({ success: false, error: "Listing introuvable" });
    listing = await ensureListingImages(listing);
    const sourceUrl = String(listing.source_url || "").trim();
    let cost = null;
    if (sourceUrl && !/aliexpress\.com\/w\/wholesale|cdiscount\.com\/search/i.test(sourceUrl)) {
      try {
        const scraped = await scrapeProduct(sourceUrl);
        cost = scraped.price || null;
      } catch (e) {
        console.warn("[EBX] sync scrape:", e.message);
      }
    }
    const margin = Number(req.body?.margin) || 35;
    let newPrice = listing.suggested_price;
    if (cost && cost > 0) {
      newPrice = Number((cost * (1 + margin / 100) * 1.35).toFixed(2));
      db.prepare("UPDATE listings SET suggested_price = ? WHERE id = ?").run(newPrice, listing.id);
    }
    let offerUpdate = null;
    if (listing.ebay_offer_id) {
      const { updateOfferPriceQuantity } = require("./ebay-api");
      offerUpdate = await updateOfferPriceQuantity(listing.ebay_offer_id, {
        price: newPrice,
        quantity: Number(req.body?.quantity) || 10,
      });
    }
    const marginInfo = estimateMargin({ cost: cost || newPrice * 0.4, sellPrice: newPrice });
    res.json({
      success: true,
      data: { id: listing.id, price: newPrice, cost, margin: marginInfo, offerUpdate },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/listings/:id/end", async (req, res) => {
  try {
    const listing = getListingById.get(req.params.id);
    if (!listing) return res.status(404).json({ success: false, error: "Listing introuvable" });
    if (!listing.ebay_offer_id) {
      return res.status(400).json({
        success: false,
        error: "Pas d'offer_id eBay mémorisé — mets fin à l'annonce depuis Mes ventes eBay.",
      });
    }
    const { endEbayOffer } = require("./ebay-api");
    await endEbayOffer(listing.ebay_offer_id);
    updateListingPublish.run("", "", "", listing.id);
    res.json({ success: true, data: { id: listing.id, status: "ended" } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/auto-orders/sync-ebay", async (_req, res) => {
  try {
    const { getRecentOrders } = require("./ebay-api");
    const { orders } = await getRecentOrders({ limit: 40 });
    let created = 0;
    let updated = 0;
    for (const o of orders) {
      const ref = String(o.orderId || "").slice(0, 40);
      if (!ref) continue;
      const line = o.lineItems?.[0];
      const title = line?.title || "Commande eBay";
      const amount = Number(o.pricingSummary?.total?.value || line?.total?.value || 0);
      const qty = Number(line?.quantity || 1);
      const ship = formatShipAddress(o);
      const match = findSupplierForTitle(title);
      const exists = getOrderByRef.get(ref);
      if (!exists) {
        insertOrder.run(
          ref,
          title.slice(0, 120),
          o.buyer?.username || "buyer",
          "pending",
          match.supplier,
          amount,
          match.source_url || ""
        );
        updateOrderExtras.run(ship.json || "", ship.text || "", match.source_url || "", match.supplier, qty, ref);
        created += 1;
      } else {
        updateOrderExtras.run(
          ship.json || exists.ship_json || "",
          ship.text || exists.notes || "",
          exists.source_url || match.source_url || "",
          exists.supplier || match.supplier,
          qty,
          ref
        );
        updated += 1;
      }
    }
    res.json({ success: true, fetched: orders.length, created, updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/accounts", (_req, res) => {
  res.json({ success: true, data: listEbayAccounts.all() });
});

app.post("/api/accounts", async (req, res) => {
  try {
    const { label, refreshToken, env: accEnv = "production", marketplace = "EBAY_US" } = req.body || {};
    const token = String(refreshToken || "").trim();
    if (token.length < 40) {
      return res.status(400).json({ success: false, error: "refreshToken trop court" });
    }
    // Probe user id with temporary env override
    const prev = process.env.EBAY_REFRESH_TOKEN_PROD;
    const prevEnv = process.env.EBAY_ENV;
    process.env.EBAY_ENV = accEnv === "sandbox" ? "sandbox" : "production";
    if (accEnv === "sandbox") process.env.EBAY_REFRESH_TOKEN = token;
    else process.env.EBAY_REFRESH_TOKEN_PROD = token;
    let userId = "";
    try {
      const { getSellerIdentity, clearTokenCache } = require("./ebay-api");
      clearTokenCache();
      const identity = await getSellerIdentity();
      userId = identity.userId;
    } catch (e) {
      if (prev !== undefined) process.env.EBAY_REFRESH_TOKEN_PROD = prev;
      if (prevEnv !== undefined) process.env.EBAY_ENV = prevEnv;
      return res.status(400).json({ success: false, error: "Token invalide: " + e.message });
    }
    if (prev !== undefined) process.env.EBAY_REFRESH_TOKEN_PROD = prev;
    if (prevEnv !== undefined) process.env.EBAY_ENV = prevEnv;

    insertEbayAccount.run(label || userId || "Compte", userId, token, accEnv, marketplace);
    res.json({ success: true, data: { userId } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/accounts/:id/activate", (req, res) => {
  try {
    const row = getEbayAccountById.get(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: "Compte introuvable" });
    clearActiveAccounts.run();
    activateEbayAccount.run(row.id);
    if (row.env === "sandbox") {
      process.env.EBAY_ENV = "sandbox";
      process.env.EBAY_REFRESH_TOKEN = row.refresh_token;
    } else {
      process.env.EBAY_ENV = "production";
      process.env.EBAY_REFRESH_TOKEN_PROD = row.refresh_token;
    }
    if (row.marketplace) process.env.EBAY_MARKETPLACE_ID = row.marketplace;
    try {
      const { clearTokenCache } = require("./ebay-api");
      clearTokenCache();
    } catch (_) {}
    res.json({
      success: true,
      data: { id: row.id, userId: row.user_id, env: row.env, marketplace: row.marketplace },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete("/api/accounts/:id", (req, res) => {
  deleteEbayAccount.run(req.params.id);
  res.json({ success: true });
});

app.listen(PORT, () => {
  const { isProduction } = require("./ebay-api");
  console.log(`⚡ EBX Server running on http://localhost:${PORT}`);
  console.log(`🧠 LLM endpoint: ${process.env.LOCAL_LLM_URL || "http://localhost:1234/v1"}`);
  console.log(`🛒 Publish mode: ${isProduction() ? "PRODUCTION (réel)" : "sandbox (test)"}`);
  console.log(`🌐 Mode: live scrapers + fallbacks`);
});
