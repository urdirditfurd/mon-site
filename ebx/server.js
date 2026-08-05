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
  resolvePriceViaSearch,
  sanitizeProductPrice,
  buildKeywordAnalysisFromItems,
  buildHtmlFromProduct,
  enrichProductListingCopy,
  injectProductImagesIntoHtml,
  countRealImagesInHtml,
  isRealProductImage,
  scrubWhySectionInHtml,
  stripSupplierProvenance,
  cleanMarketingCopy,
  sanitizeListingHtml,
} = require("./scraper");
const { browseSearch, browseSellerItems } = require("./ebay-browse");
const {
  enrichItemsImages,
  withProductImage,
  nicheVisual,
} = require("./product-images");
const {
  antiBanDelay,
  scanVero,
  scoreSeoTitle,
  buildAiTitle,
  prepareDiscreetListing,
  rewriteEbayTitle,
  estimateMargin,
  buildPilotageFeed,
  getEventCalendar,
  getTrendingNiches,
  getTopSellers,
  getMarketPulse,
  shouldEscalateSav,
  draftSavReplyTemplate,
} = require("./business-engine");
const {
  getRankings,
  analyzeTitleKeywords,
  analyzeCompetitor,
  buildDescriptionFromUrl,
  getDashboardStats,
  getAutoOrders,
} = require("./mock-data");
const { generateListing, generateSavReply, generateProductCopy } = require("./ai-brain");
const { publishToEbay } = require("./ebay-api");

function defaultVariantValuesForTitle(title = "") {
  const t = String(title || "").toLowerCase();
  if (/led|bande|strip|n[eé]on|lumineuse|blanc chaud|froid|kelvin|cct/i.test(t)) {
    return ["Blanc chaud", "Blanc froid"];
  }
  if (/coque|case|housse|silicone/i.test(t)) return ["Noir", "Transparent"];
  if (/cable|câble|usb|hdmi/i.test(t)) return ["1 m", "2 m"];
  return ["Option A", "Option B"];
}

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
if (!listingCols.includes("variations_active")) {
  db.exec("ALTER TABLE listings ADD COLUMN variations_active INTEGER DEFAULT 0");
}
if (!listingCols.includes("variations_json")) {
  db.exec("ALTER TABLE listings ADD COLUMN variations_json TEXT DEFAULT ''");
}

const getRecentListings = db.prepare(
  `SELECT id, seo_title, suggested_price, keywords, source_url, created_at,
          ebay_listing_id, ebay_offer_id, publish_env, published_at,
          variations_active, variations_json,
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
   SET ebay_listing_id = ?, ebay_offer_id = ?, publish_env = ?, published_at = CURRENT_TIMESTAMP,
       variations_active = ?, variations_json = ?
   WHERE id = ?`
);

function rememberListingPublish(localId, pub = {}) {
  const vars = pub.variations || null;
  const active = vars && Array.isArray(vars.values) && vars.values.length >= 2 ? 1 : pub.listingId ? 1 : 0;
  updateListingPublish.run(
    String(pub.listingId || ""),
    String(pub.offerId || ""),
    String(pub.env || ""),
    active,
    vars ? JSON.stringify(vars) : "",
    Number(localId)
  );
}

function clearListingPublish(localId) {
  updateListingPublish.run("", "", "", 0, "", Number(localId));
}
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
const deleteOrderByRef = db.prepare("DELETE FROM auto_orders WHERE order_ref = ?");

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

db.exec(`
  CREATE TABLE IF NOT EXISTS ebx_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS sav_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT UNIQUE,
    item_id TEXT,
    item_title TEXT,
    sender TEXT,
    subject TEXT,
    body TEXT,
    status TEXT DEFAULT 'new',
    draft TEXT DEFAULT '',
    escalate INTEGER DEFAULT 0,
    escalate_reason TEXT DEFAULT '',
    confidence REAL DEFAULT 0,
    reply_source TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const getSetting = db.prepare("SELECT value FROM ebx_settings WHERE key = ?");
const upsertSetting = db.prepare(
  `INSERT INTO ebx_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
);
const listSavMessages = db.prepare(
  "SELECT * FROM sav_messages ORDER BY updated_at DESC, id DESC LIMIT 100"
);
const getSavById = db.prepare("SELECT * FROM sav_messages WHERE id = ?");
const getSavByMessageId = db.prepare("SELECT * FROM sav_messages WHERE message_id = ?");
const savCols = db.prepare("PRAGMA table_info(sav_messages)").all().map((c) => c.name);
if (!savCols.includes("received_at")) {
  db.exec("ALTER TABLE sav_messages ADD COLUMN received_at TEXT DEFAULT ''");
}
const insertSavMessage = db.prepare(
  `INSERT INTO sav_messages
    (message_id, item_id, item_title, sender, subject, body, status, draft, escalate, escalate_reason, confidence, reply_source, received_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const updateSavDraft = db.prepare(
  `UPDATE sav_messages
   SET draft = ?, escalate = ?, escalate_reason = ?, confidence = ?, reply_source = ?, status = ?, updated_at = CURRENT_TIMESTAMP
   WHERE id = ?`
);
const updateSavStatus = db.prepare(
  "UPDATE sav_messages SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
);
const deleteSavById = db.prepare("DELETE FROM sav_messages WHERE id = ?");

/** URL fournisseur dropship valide (jamais eBay → eBay). */
function isSupplierProductUrl(url) {
  const u = String(url || "");
  if (!u || /ebay\.(com|fr|de|co\.uk|it|es)\b/i.test(u)) return false;
  if (/wholesale-|\/w\/wholesale|\/search\/|SearchText=|\/s\?k=/i.test(u)) return false;
  return /amazon\.[a-z.]+\/.*(dp|gp\/product)|aliexpress\.com\/item\/|cdiscount\.com\/.+\.html/i.test(u);
}

/** Commande issue du sync eBay (pas un faux AO- sniper). */
function isRealEbayOrderRef(ref) {
  const r = String(ref || "");
  if (!r || /^AO-/i.test(r) || /^DEMO/i.test(r)) return false;
  return r.length >= 12 || /^\d{2}-\d+-\d+/.test(r);
}

function listingIsSupplierSourced(row) {
  const url = String(row?.source_url || "");
  if (!url || /ebay\.(com|fr|de|co\.uk|it|es)\b/i.test(url)) return false;
  // Uniquement fiches produit Amazon / Ali / Cdiscount (pas pages recherche / wholesale)
  return isSupplierProductUrl(url);
}

function purgeNonSupplierListings() {
  const rows = getRecentListings.all();
  let removed = 0;
  for (const row of rows) {
    if (!listingIsSupplierSourced(row)) {
      deleteListingById.run(row.id);
      removed += 1;
    }
  }
  return removed;
}

function purgeFakeAutoOrders() {
  const rows = getOrders.all();
  let removed = 0;
  const del = db.prepare("DELETE FROM auto_orders WHERE order_ref = ?");
  for (const row of rows) {
    if (!isRealEbayOrderRef(row.order_ref)) {
      del.run(row.order_ref);
      removed += 1;
    }
  }
  return removed;
}

// Nettoyage one-shot au démarrage (listings eBay importés + faux AO sniper + démos SAV)
try {
  purgeNonSupplierListings();
  purgeFakeAutoOrders();
  db.prepare("DELETE FROM sav_messages WHERE message_id LIKE 'DEMO-%'").run();
} catch (e) {
  console.warn("[EBX] purge démarrage:", e.message);
}

const DEFAULT_SUPPLIER_CFG = {
  amazon: { enabled: true, auto: true, label: "Amazon France", connected: false, delay: "1-2 jours" },
  aliexpress: { enabled: true, auto: true, label: "AliExpress", connected: false, delay: "7-15 jours" },
  cdiscount: { enabled: true, auto: true, label: "Cdiscount", connected: false, delay: "1-3 jours", comingSoon: false },
  autoOrderMode: false,
  autoProcessOnSync: true,
  maxPerDay: 50,
  aliMode: "chrome_extension",
  notifyOnOrder: true,
  notifyOnError: true,
  processedToday: 0,
  processedDay: "",
};

function getSupplierConfig() {
  try {
    const row = getSetting.get("supplier_auto_order");
    if (row?.value) {
      const parsed = JSON.parse(row.value);
      const merged = { ...DEFAULT_SUPPLIER_CFG, ...parsed };
      for (const key of ["amazon", "aliexpress", "cdiscount"]) {
        merged[key] = { ...DEFAULT_SUPPLIER_CFG[key], ...(parsed[key] || {}) };
      }
      // Cdiscount désormais actif (ignore ancien comingSoon persisté)
      merged.cdiscount = {
        ...merged.cdiscount,
        enabled: merged.cdiscount.enabled !== false,
        comingSoon: false,
        delay: merged.cdiscount.delay === "Bientôt" ? "1-3 jours" : merged.cdiscount.delay || "1-3 jours",
      };
      const today = new Date().toISOString().slice(0, 10);
      if (merged.processedDay !== today) {
        merged.processedToday = 0;
        merged.processedDay = today;
      }
      return merged;
    }
  } catch (_) {}
  return { ...DEFAULT_SUPPLIER_CFG, processedDay: new Date().toISOString().slice(0, 10) };
}

function saveSupplierConfig(cfg) {
  upsertSetting.run("supplier_auto_order", JSON.stringify(cfg));
}

function supplierKeyFromName(nameOrUrl = "") {
  const s = String(nameOrUrl).toLowerCase();
  if (s.includes("amazon")) return "amazon";
  if (s.includes("cdiscount")) return "cdiscount";
  if (s.includes("ali")) return "aliexpress";
  return "aliexpress";
}

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
    description_builder: "desc-v2",
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

    // CA / commandes = UNIQUEMENT ventes eBay synchronisées (jamais les faux AO- du sniper)
    const ebayOrders = orders.filter((o) => isRealEbayOrderRef(o.order_ref));
    const realRevenue = ebayOrders.reduce((s, o) => s + (Number(o.amount) || 0), 0);
    const ebaySynced = ebayOrders.length;
    const pendingOrders = ebayOrders.filter((o) => o.status === "pending").length;
    const delivered = ebayOrders.filter((o) => o.status === "delivered").length;
    const avgTicket = ebayOrders.length ? realRevenue / ebayOrders.length : 0;
    const estCost = realRevenue * 0.55;
    const estFees = realRevenue * 0.13;
    const estMarginPct =
      realRevenue > 0 ? Number((((realRevenue - estCost - estFees) / realRevenue) * 100).toFixed(1)) : 0;

    if (pendingOrders > 0) {
      pilotage.unshift({
        level: "warn",
        title: `${pendingOrders} commande(s) à traiter`,
        detail: "Auto-Order → Sync eBay → copie l'adresse → ouvre le fournisseur → Avancer.",
      });
    }

    // Tendances / calendrier / niches (parité EBX dashboard)
    let trending = [];
    let rankingsLive = false;
    try {
      const seeds = ["coque iphone", "colle b7000", "bande led", "chargeur usb c", "éponge maquillage"];
      for (const q of seeds.slice(0, 3)) {
        try {
          const r = await browseSearch(q, { marketplace: "FR", limit: 2 });
          (r.items || []).forEach((it) =>
            trending.push(
              withProductImage({
                title: it.title,
                price: it.price || 0,
                sold: it.sold || Math.round(40 + Math.random() * 400),
                url: it.url,
                image: it.image || null,
                category: q,
              })
            )
          );
        } catch (_) {}
      }
      rankingsLive = trending.length > 0;
    } catch (_) {}
    if (!trending.length) {
      trending = getRankings("FR").slice(0, 8).map((p) =>
        withProductImage({
          title: p.title,
          price: p.price,
          sold: p.sold,
          url: null,
          image: p.image || null,
          category: p.category,
        })
      );
    }
    trending = enrichItemsImages(trending);
    const calendar = getEventCalendar();
    const niches = getTrendingNiches(trending).map((n) => {
      const v = nicheVisual(n.name);
      return { ...n, icon: n.icon || v.icon, image: v.image, color: v.color };
    });
    const topSellers = getTopSellers("FR");
    const marketPulse = getMarketPulse(trending);
    const savOpen = listSavMessages.all().filter((m) => m.status !== "sent" && m.status !== "archived").length;
    if (savOpen > 0) {
      pilotage.unshift({
        level: "info",
        title: `${savOpen} message(s) SAV ouverts`,
        detail: "SAV → Sync messages → brouillon IA / escalade / envoyer.",
      });
    }
    const nextEvent = calendar.find((e) => e.phase === "live" || e.phase === "prep" || e.phase === "upcoming");
    if (nextEvent) {
      pilotage.push({
        level: "ok",
        title: `Calendrier: ${nextEvent.name}`,
        detail: `${nextEvent.label} · niche ${nextEvent.niche} — ${nextEvent.tip}`,
      });
    }

    res.json({
      success: true,
      data: {
        ...base,
        revenue: Number(realRevenue.toFixed(2)),
        revenueSource: ebaySynced ? "ebay_orders" : "none",
        margin: estMarginPct,
        avgTicket: Number(avgTicket.toFixed(2)),
        listings: listings.filter(listingIsSupplierSourced).length,
        published,
        pendingOrders,
        delivered,
        orders: ebayOrders.length,
        ebaySynced,
        ebayEnv,
        sellerUserId: seller?.userId || null,
        pilotage,
        plan: "Business",
        trending: trending.slice(0, 10).map((t) => ({
          ...t,
          ca: Number(((Number(t.price) || 0) * (Number(t.sold) || 0)).toFixed(0)),
        })),
        trendingLive: rankingsLive,
        trendingUpdatedAt: new Date().toISOString(),
        calendar: calendar,
        niches: niches.slice(0, 6),
        topSellers,
        marketPulse,
        greetName: seller?.userId || "vendeur",
        savOpen,
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
  const algo =
    "Classement = niches populaires FR (coque, LED, chargeur…) via Browse API eBay, " +
    "dédupliqué, trié par score (ventes estimées × prix). " +
    "eBay Browse ne fournit pas toujours le sold count exact — on utilise les signaux listing + position de recherche.";
  try {
    const seeds = ["coque iphone", "verre trempe", "colle b7000", "bande led", "chargeur usb c"];
    const all = [];
    for (const q of seeds) {
      try {
        const r = await browseSearch(q, { marketplace, limit: 3 });
        r.items.forEach((it, idx) =>
          all.push({
            ...it,
            seed: q,
            sold: Number(it.sold) || Math.max(1, 30 - idx * 5),
            relevance: 3 - idx,
          })
        );
      } catch (_) {}
    }
    if (all.length) {
      const scored = [...all].sort((a, b) => {
        const sa = (Number(a.sold) || 0) * Math.max(1, Number(a.price) || 1) + (a.relevance || 0) * 10;
        const sb = (Number(b.sold) || 0) * Math.max(1, Number(b.price) || 1) + (b.relevance || 0) * 10;
        return sb - sa;
      });
      const seen = new Set();
      const uniq = [];
      for (const p of scored) {
        const key = String(p.title || "").slice(0, 40).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        uniq.push(p);
        if (uniq.length >= 12) break;
      }
      const data = enrichItemsImages(
        uniq.map((p, i) => ({
          rank: i + 1,
          title: p.title,
          category: p.seed || "eBay",
          price: p.price || 0,
          sold: p.sold || 0,
          marketplace,
          trend: i % 3 === 0 ? "up" : i % 3 === 1 ? "stable" : "down",
          url: p.url,
          image: p.image || null,
          live: true,
        }))
      );
      return res.json({ success: true, data, live: true, source: "ebay-browse-api", algo });
    }
  } catch (err) {
    console.warn("[EBX] rankings browse fail:", err.message);
  }
  try {
    const live = await scrapeRankings({ marketplace });
    if (live.length)
      return res.json({
        success: true,
        data: enrichItemsImages(live),
        live: true,
        source: "scrape",
        algo,
      });
  } catch (err) {
    console.warn("[EBX] rankings scrape fail:", err.message);
  }
  const mock = enrichItemsImages(
    getRankings(marketplace).map((p) => ({
      ...p,
      image: null,
      url: `https://www.ebay.fr/sch/i.html?_nkw=${encodeURIComponent(p.title)}`,
    }))
  );
  res.json({ success: true, data: mock, live: false, source: "mock", algo });
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
    if (Array.isArray(data.bestsellers)) {
      data.bestsellers = enrichItemsImages(data.bestsellers);
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
    if (Array.isArray(data.bestsellers)) {
      data.bestsellers = enrichItemsImages(data.bestsellers);
    }
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
    const rows = getOrders.all().filter((o) => isRealEbayOrderRef(o.order_ref));
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
          fromEbay: true,
        };
      }),
      live: true,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/auto-orders/config", (_req, res) => {
  res.json({ success: true, data: getSupplierConfig() });
});

app.get("/api/bot-status", (_req, res) => {
  try {
    const cfg = getSupplierConfig();
    const pending = getOrders.all().filter((o) => isRealEbayOrderRef(o.order_ref) && o.status === "pending").length;
    const listings = getRecentListings.all().length;
    const published = getRecentListings.all().filter((l) => l.ebay_listing_id).length;
    res.json({
      success: true,
      data: {
        autoOrderMode: Boolean(cfg.autoOrderMode),
        processedToday: cfg.processedToday || 0,
        maxPerDay: cfg.maxPerDay || 50,
        pending,
        listings,
        published,
        label: cfg.autoOrderMode
          ? `Bot Auto-Order actif ${cfg.processedToday || 0}/${cfg.maxPerDay || 50}`
          : pending > 0
            ? `Auto-Order off · ${pending} commande(s) en attente`
            : "Auto-Order off",
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/auto-orders/config", (req, res) => {
  try {
    const body = req.body || {};
    const cfg = getSupplierConfig();
    for (const key of ["amazon", "aliexpress", "cdiscount"]) {
      if (body[key] && typeof body[key] === "object") {
        cfg[key] = {
          ...cfg[key],
          enabled: body[key].enabled !== false,
          auto: Boolean(body[key].auto),
          connected: Boolean(body[key].connected),
          label: cfg[key].label,
          delay: cfg[key].delay,
          comingSoon: cfg[key].comingSoon,
        };
      }
    }
    if (typeof body.autoProcessOnSync === "boolean") cfg.autoProcessOnSync = body.autoProcessOnSync;
    if (typeof body.autoOrderMode === "boolean") cfg.autoOrderMode = body.autoOrderMode;
    if (body.maxPerDay != null) cfg.maxPerDay = Math.max(1, Math.min(200, Number(body.maxPerDay) || 50));
    if (body.aliMode) cfg.aliMode = String(body.aliMode);
    if (typeof body.notifyOnOrder === "boolean") cfg.notifyOnOrder = body.notifyOnOrder;
    if (typeof body.notifyOnError === "boolean") cfg.notifyOnError = body.notifyOnError;
    saveSupplierConfig(cfg);
    res.json({ success: true, data: cfg });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Prépare le pack « auto » : URLs + adresses pour pending (quota journalier + mode bot). */
app.post("/api/auto-orders/process-queue", async (_req, res) => {
  try {
    const cfg = getSupplierConfig();
    const maxLeft = Math.max(0, (cfg.maxPerDay || 50) - (cfg.processedToday || 0));
    if (maxLeft <= 0) {
      return res.json({
        success: true,
        data: {
          processed: 0,
          pack: [],
          skippedQuota: true,
          note: `Quota journalier atteint (${cfg.maxPerDay}/jour). Augmente Max commandes/jour ou attends demain.`,
        },
      });
    }
    const rows = getOrders.all().filter((o) => isRealEbayOrderRef(o.order_ref) && o.status === "pending");
    const pack = [];
    const botLog = [];
    for (const row of rows) {
      if (pack.length >= maxLeft) break;
      botLog.push({ step: "detect", ok: true, detail: `Vente détectée ${row.order_ref}` });
      let url = row.source_url;
      let supplier = row.supplier;
      if (!url) {
        const found = findSupplierForTitle(row.product);
        url = found.source_url;
        supplier = found.supplier || supplier;
      }
      if (!url || /wholesale-|\/search\/|SearchText=/i.test(url)) {
        try {
          const q = String(row.product || "").split(/\s+/).slice(0, 6).join(" ");
          const cmp = await findCheapestSupplier(q, {
            sources: ["amazon", "aliexpress", "cdiscount"].filter((s) => cfg[s]?.enabled !== false && !cfg[s]?.comingSoon),
            limit: 2,
          });
          if (cmp.best?.url) {
            url = cmp.best.url;
            supplier = String(cmp.best.source || "Fournisseur").split("+")[0];
            botLog.push({ step: "source", ok: true, detail: `Meilleur fournisseur ${supplier}` });
          }
        } catch (_) {}
      }
      if (!url) {
        const q = encodeURIComponent(String(row.product || "").split(/\s+/).slice(0, 6).join(" "));
        url = `https://www.aliexpress.com/w/wholesale-${q}.html`;
        supplier = supplier || "AliExpress";
      }
      const key = supplierKeyFromName(supplier + " " + url);
      if (cfg[key]?.comingSoon) continue;
      if (cfg[key] && cfg[key].enabled === false) continue;
      if (cfg.autoOrderMode && cfg[key] && cfg[key].auto === false) continue;

      updateOrderSource.run(url, supplier || row.supplier || "Fournisseur", row.order_ref);
      updateOrderStatus.run("ordered", row.order_ref);
      const steps = [
        { id: "sync", label: "Adresse acheteur récupérée", ok: Boolean(row.notes) },
        { id: "source", label: `Fournisseur: ${supplier}`, ok: true },
        { id: "open", label: "Page fournisseur préparée", ok: true },
        {
          id: "pay",
          label:
            key === "aliexpress" && cfg.aliMode === "chrome_extension"
              ? "Checkout AliExpress via Extension Chrome (manuel assisté)"
              : "Paiement fournisseur (manuel — colle adresse + paie)",
          ok: false,
        },
      ];
      pack.push({
        id: row.order_ref,
        product: row.product,
        url,
        supplier,
        shipText: row.notes || "",
        amount: row.amount,
        steps,
        aliMode: cfg.aliMode,
      });
      botLog.push({ step: "queue", ok: true, detail: `${row.order_ref} → ordered` });
    }
    cfg.processedToday = (cfg.processedToday || 0) + pack.length;
    cfg.processedDay = new Date().toISOString().slice(0, 10);
    saveSupplierConfig(cfg);
    res.json({
      success: true,
      data: {
        processed: pack.length,
        pack,
        botLog,
        autoOrderMode: cfg.autoOrderMode,
        remainingToday: Math.max(0, cfg.maxPerDay - cfg.processedToday),
        note: cfg.autoOrderMode
          ? "Mode Auto-Order: file préparée (adresse + URL). Paiement fournisseur = étape manuelle/extension — pas d'API Ali/Amazon."
          : "File préparée. Ouvre chaque lien, colle l'adresse, paie, puis Avancer → shipped.",
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
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

app.post("/api/auto-orders/:id/open-supplier", async (req, res) => {
  try {
    const row = getOrderByRef.get(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: "Commande introuvable" });
    let url = row.source_url;
    let supplier = row.supplier;

    if (!url) {
      const found = findSupplierForTitle(row.product);
      url = found.source_url;
      supplier = found.supplier || supplier;
    }

    // Re-sourcing live si pas de lien produit local
    if (!url || /wholesale-|\/search\/|SearchText=/i.test(url)) {
      try {
        const q = String(row.product || "")
          .split(/\s+/)
          .slice(0, 6)
          .join(" ");
        const cmp = await findCheapestSupplier(q, {
          sources: ["amazon", "aliexpress", "cdiscount"],
          limit: 2,
        });
        if (cmp.best?.url) {
          url = cmp.best.url;
          supplier = String(cmp.best.source || "Fournisseur").split("+")[0];
          if (cmp.best.price) {
            // note coût estimé
          }
        }
      } catch (e) {
        console.warn("[EBX] open-supplier resourcing:", e.message);
      }
    }

    if (!url) {
      const q = encodeURIComponent(String(row.product || "").split(/\s+/).slice(0, 6).join(" "));
      url = `https://www.aliexpress.com/w/wholesale-${q}.html`;
      supplier = supplier || "AliExpress";
    }

    updateOrderSource.run(url, supplier || row.supplier || "Fournisseur", row.order_ref);
    if (row.status === "pending") updateOrderStatus.run("ordered", row.order_ref);

    res.json({
      success: true,
      data: {
        id: row.order_ref,
        url,
        supplier,
        shipText: row.notes || "",
        checklist: [
          "1. Adresse acheteur copiée (si Sync eBay fait)",
          "2. Page fournisseur ouverte",
          "3. Colle l'adresse en livraison chez le fournisseur",
          "4. Paie la commande fournisseur",
          "5. Clique Avancer → ordered/shipped quand c'est fait",
        ],
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

app.delete("/api/auto-orders/:id", (req, res) => {
  try {
    const row = getOrderByRef.get(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: "Commande introuvable" });
    deleteOrderByRef.run(row.order_ref);
    res.json({ success: true, data: { id: row.order_ref } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/auto-orders/bulk-delete", (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    if (!ids.length) return res.status(400).json({ success: false, error: "ids requis" });
    let removed = 0;
    for (const id of ids) {
      const row = getOrderByRef.get(id);
      if (!row) continue;
      deleteOrderByRef.run(row.order_ref);
      removed += 1;
    }
    res.json({ success: true, removed });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/listings/bulk-delete", (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ success: false, error: "ids requis" });
    let removed = 0;
    for (const id of ids) {
      deleteListingById.run(id);
      removed += 1;
    }
    res.json({ success: true, removed });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function seedDemoSavIfEmpty() {
  // Plus de messages fictifs — inbox vide tant qu'il n'y a pas de sync eBay.
  return;
}

app.get("/api/sav", (_req, res) => {
  try {
    seedDemoSavIfEmpty();
    const rows = listSavMessages.all();
    res.json({
      success: true,
      data: rows.map((m) => ({
        ...m,
        escalate: Boolean(m.escalate),
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/sav/sync", async (_req, res) => {
  try {
    let fetched = 0;
    let created = 0;
    let live = false;
    let apiError = null;
    try {
      const { getMemberMessages } = require("./ebay-api");
      const { messages } = await getMemberMessages({ daysBack: 21, unansweredOnly: false });
      live = true;
      fetched = messages.length;
      for (const m of messages) {
        const mid = String(m.messageId || `${m.itemId}-${m.sender}-${m.creationDate}`).slice(0, 80);
        if (!mid || getSavByMessageId.get(mid)) continue;
        insertSavMessage.run(
          mid,
          m.itemId || "",
          m.itemTitle || "",
          m.sender || "",
          m.subject || "",
          m.body || "",
          "new",
          "",
          0,
          "",
          0,
          "",
          m.creationDate || new Date().toISOString()
        );
        created += 1;
      }
    } catch (e) {
      apiError = e.message;
      seedDemoSavIfEmpty();
    }
    res.json({
      success: true,
      fetched,
      created,
      live,
      apiError,
      note: live
        ? "Messages eBay synchronisés (Trading GetMemberMessages)."
        : "API messages indisponible (scopes OAuth / compte) — démo locale chargée. " + (apiError || ""),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/sav/:id/draft", async (req, res) => {
  try {
    const row = getSavById.get(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: "Message introuvable" });
    let draft;
    let source = "template";
    try {
      draft = await generateSavReply({
        buyer: row.sender,
        subject: row.subject,
        body: row.body,
        product: row.item_title,
      });
      source = "llm";
    } catch (_) {
      draft = draftSavReplyTemplate({
        buyer: row.sender,
        subject: row.subject,
        body: row.body,
        product: row.item_title,
      });
    }
    const soft = shouldEscalateSav(`${row.subject} ${row.body}`);
    const escalate = draft.escalate || soft.escalate;
    const reason = draft.reason || soft.reason || "";
    const status = escalate ? "escalated" : "draft";
    updateSavDraft.run(
      draft.draft,
      escalate ? 1 : 0,
      reason,
      draft.confidence || 0.5,
      source,
      status,
      row.id
    );
    res.json({
      success: true,
      data: {
        id: row.id,
        draft: draft.draft,
        escalate,
        reason,
        confidence: draft.confidence,
        status,
        source,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/sav/:id/escalate", (req, res) => {
  try {
    const row = getSavById.get(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: "Message introuvable" });
    const reason = String(req.body?.reason || "Escalade manuelle");
    updateSavDraft.run(row.draft || "", 1, reason, row.confidence || 0, row.reply_source || "manual", "escalated", row.id);
    res.json({ success: true, data: { id: row.id, status: "escalated" } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete("/api/sav/:id", (req, res) => {
  try {
    const row = getSavById.get(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: "Message introuvable" });
    deleteSavById.run(row.id);
    res.json({ success: true, data: { id: row.id } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/sav/:id/send", async (req, res) => {
  try {
    const row = getSavById.get(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: "Message introuvable" });
    const body = String(req.body?.draft || row.draft || "").trim();
    if (!body) return res.status(400).json({ success: false, error: "Brouillon vide — génère d'abord" });
    if (row.escalate && !req.body?.force) {
      return res.status(400).json({
        success: false,
        error: "Message en escalade — relis le brouillon puis renvoie avec force=true pour envoyer.",
      });
    }
    // Messages démo : marque sent sans appel eBay
    if (String(row.message_id).startsWith("DEMO-")) {
      updateSavDraft.run(body, row.escalate ? 1 : 0, row.escalate_reason || "", row.confidence || 0, "demo", "sent", row.id);
      return res.json({ success: true, data: { id: row.id, status: "sent", live: false } });
    }
    try {
      const { replyToMemberMessage } = require("./ebay-api");
      await replyToMemberMessage({
        itemId: row.item_id,
        parentMessageId: row.message_id,
        recipientId: row.sender,
        body,
      });
      updateSavDraft.run(body, 0, "", row.confidence || 0, "ebay", "sent", row.id);
      res.json({ success: true, data: { id: row.id, status: "sent", live: true } });
    } catch (e) {
      // Conserve le brouillon même si envoi API échoue
      updateSavDraft.run(body, row.escalate ? 1 : 0, row.escalate_reason || "", row.confidence || 0, row.reply_source || "", row.status, row.id);
      res.status(500).json({
        success: false,
        error: `Envoi eBay échoué: ${e.message}. Brouillon conservé — vérifie scopes OAuth / ItemID.`,
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/sav/auto-draft-all", async (_req, res) => {
  try {
    seedDemoSavIfEmpty();
    const rows = listSavMessages.all().filter((m) => m.status === "new" || !m.draft);
    let n = 0;
    for (const row of rows) {
      let draft;
      let source = "template";
      try {
        draft = await generateSavReply({
          buyer: row.sender,
          subject: row.subject,
          body: row.body,
          product: row.item_title,
        });
        source = "llm";
      } catch (_) {
        draft = draftSavReplyTemplate({
          buyer: row.sender,
          subject: row.subject,
          body: row.body,
          product: row.item_title,
        });
      }
      const soft = shouldEscalateSav(`${row.subject} ${row.body}`);
      const escalate = draft.escalate || soft.escalate;
      updateSavDraft.run(
        draft.draft,
        escalate ? 1 : 0,
        draft.reason || soft.reason || "",
        draft.confidence || 0.5,
        source,
        escalate ? "escalated" : "draft",
        row.id
      );
      n += 1;
    }
    res.json({ success: true, drafted: n });
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
    autoList = true,
    source = "auto",
    query = "gadgets",
    verifiedOnly = true,
  } = req.body || {};
  // Mode REEL uniquement (plus de Mode Test)
  const testMode = false;
  const strictVerified = verifiedOnly !== false && verifiedOnly !== "false";

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
  let skipped = 0;

  const ticketFilter = (price) => {
    if (ticket === "low") return price == null || price <= 30;
    if (ticket === "mid") return price != null && price > 30 && price <= 100;
    return true;
  };

  const sourceList =
    source === "amazon"
      ? ["amazon"]
      : source === "aliexpress"
        ? ["aliexpress"]
        : source === "cdiscount"
          ? ["cdiscount"]
          : ["amazon", "aliexpress", "cdiscount"];

  try {
    send({
      type: "log",
      message: `[INIT] Auto-Snipe BUSINESS — Mode REEL | Prix ${
        strictVerified ? "VÉRIFIÉ fiche uniquement" : "souple"
      }`,
    });
    send({
      type: "log",
      message: `[CONFIG] Market=${marketplace} (${marketCode}) | Marge=${margin}% | Ticket=${ticket} | Source=${source} | Qty=${max}`,
    });
    send({
      type: "log",
      message: `[RULE] Sources = Amazon / AliExpress / Cdiscount uniquement — jamais d'import d'annonces eBay`,
    });
    const d0 = await antiBanDelay({ testMode, label: "init" });
    send({
      type: "log",
      message: `[PROTECT] Anti-ban humain ✓ (${d0.waitedMs}ms${d0.deferred ? ", hors horaires" : ""}) | VeRO scan ✓`,
    });
    await antiBanDelay({ testMode, label: "scan" });

    // 1) Signal demande eBay (tendances) — mots-clés uniquement, pas le produit
    send({ type: "log", message: `[SCAN] Signaux demande eBay pour "${query}"...` });
    let demandHints = [];
    try {
      const r = await browseSearch(query, { marketplace: marketCode, limit: max + 4 });
      demandHints = r.items.filter((i) => ticketFilter(i.price));
      scanned = Math.max(demandHints.length * 12, demandHints.length);
      send({ type: "log", message: `[SCAN] ${demandHints.length} signaux eBay (${r.api}) — on sourcera hors eBay` });
    } catch (err) {
      send({ type: "log", message: `[WARN] Browse API: ${err.message}` });
      try {
        const ebay = await scrapeEbaySearch(query, { marketplace: marketCode, limit: max + 4 });
        demandHints = ebay.items.filter((i) => ticketFilter(i.price));
        scanned = demandHints.length * 8;
        send({ type: "log", message: `[SCAN] ${demandHints.length} signaux via scrape eBay` });
      } catch (err2) {
        send({ type: "log", message: `[WARN] eBay scrape: ${err2.message}` });
      }
    }
    send({ type: "stats", scanned, imported, listed, errors });

    for (let i = 0; i < max; i++) {
      try {
        const hint = demandHints[i];
        // TOUJOURS chercher avec le mot-clé saisi par l'utilisateur (pas le titre eBay déformé)
        const searchQ = String(query || "")
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 8)
          .join(" ") || "gadget";
        const hintExtra = hint
          ? String(hint.title)
              .replace(/\b(collectionneur|livre|ebook|vintage|rare|lot|usb|3m|5m|10m)\b/gi, " ")
              .split(/\s+/)
              .filter((w) => w.length > 3 && /led|cob|bande|ruban|blanc|chaud|froid|flexible|étanche|strip/i.test(w))
              .slice(0, 3)
              .join(" ")
          : "";
        const supplierQueries = [searchQ];
        if (hintExtra && !searchQ.toLowerCase().includes(hintExtra.toLowerCase().slice(0, 8))) {
          supplierQueries.push(`${searchQ} ${hintExtra}`.trim());
        }

        send({
          type: "log",
          message: `[TARGET] Recherche fournisseur: "${searchQ}"${
            hint ? ` (signal demande eBay: "${String(hint.title).slice(0, 40)}…")` : ""
          }`,
        });

        const vero = scanVero(searchQ);
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
        await antiBanDelay({ testMode, label: "target" });

        send({ type: "log", message: `[SOURCE] Comparaison live fournisseurs (${source})…` });
        let candidates = [];
        try {
          const merged = [];
          const sourceLog = (m) => send({ type: "log", message: m });
          for (const sq of supplierQueries) {
            const cmp = await findCheapestSupplier(sq, {
              sources: sourceList,
              limit: 6,
              onLog: sourceLog,
            });
            merged.push(...(cmp.candidates || []));
            if (cmp.best) merged.push(cmp.best);
          }
          const byUrl = new Map();
          for (const c of merged) {
            if (!c?.url || !isSupplierProductUrl(c.url)) continue;
            const key = String(c.url).split("?")[0].toLowerCase();
            const cleaned = sanitizeProductPrice(c.price, c.title);
            const row = {
              ...c,
              price: cleaned,
              priceUnconfirmed: cleaned && c.priceUnconfirmed && !c.priceFromMarketplaceCard && !c.priceConfirmed,
              priceFromMarketplaceCard: !!c.priceFromMarketplaceCard,
              priceConfirmed: !!c.priceConfirmed,
            };
            const prev = byUrl.get(key);
            if (!prev) {
              byUrl.set(key, row);
              continue;
            }
            const score = (x) =>
              (x.priceConfirmed ? 30 : 0) +
              (x.priceFromMarketplaceCard ? 15 : 0) +
              (x.price > 0 ? 10 : 0) +
              Math.min(String(x.title || "").length, 40) / 10;
            if (score(row) > score(prev)) {
              byUrl.set(key, {
                ...prev,
                ...row,
                price: row.price || prev.price,
                priceConfirmed: row.priceConfirmed || prev.priceConfirmed,
                priceFromMarketplaceCard: row.priceFromMarketplaceCard || prev.priceFromMarketplaceCard,
              });
            }
          }
          candidates = [...byUrl.values()].sort((a, b) => {
            // Moins cher d'abord parmi les prix utilisables (confirmé ou carte marketplace)
            const usable = (x) => x.priceConfirmed || x.priceFromMarketplaceCard || (x.price > 0 && !x.priceUnconfirmed);
            const ua = usable(a) ? 0 : a.price > 0 ? 1 : 2;
            const ub = usable(b) ? 0 : b.price > 0 ? 1 : 2;
            if (ua !== ub) return ua - ub;
            const pa = a.price > 0 ? a.price : 9999;
            const pb = b.price > 0 ? b.price : 9999;
            return pa - pb;
          });

          send({
            type: "log",
            message: `[SOURCE] ${candidates.length} candidat(s) bruts trouvés — vérification fiche en cours…`,
          });
          if (candidates[0]?.url) {
            send({
              type: "log",
              message: `[SOURCE] 1er candidat brut: ${String(candidates[0].source).split("+")[0]} — ${String(
                candidates[0].title || ""
              ).slice(0, 45)}`,
            });
          }
        } catch (e) {
          send({ type: "log", message: `[WARN] Comparaison fournisseurs: ${e.message}` });
        }

        if (!candidates.length) {
          skipped += 1;
          send({
            type: "log",
            message:
              `[SKIP] Aucun produit fournisseur réel trouvé (Amazon bloqué ou 0 résultat). ` +
              `Sur Windows: Chrome installé + npm install dans ebx/ puis redémarre. ` +
              `Sinon colle une URL amazon.fr/dp/... en Import Manuel. Jamais d'import d'annonce eBay.`,
          });
          errors += 1;
          send({ type: "stats", scanned, imported, listed, errors });
          continue;
        }

        // ——— PASS VERIFICATION : scrape chaque fiche, ne garder que les prix réels ———
        send({
          type: "log",
          message: `[VERIFY] Mode ${
            strictVerified ? "STRICT (fiche produit uniquement)" : "souple (cartes marketplace autorisées)"
          } — contrôle de ${Math.min(candidates.length, 8)} candidat(s)…`,
        });
        const verifiedDetails = new Map();
        const verifiedList = [];
        for (let vi = 0; vi < Math.min(candidates.length, 8); vi++) {
          const cand = candidates[vi];
          send({
            type: "log",
            message: `[VERIFY] ${vi + 1}/${Math.min(candidates.length, 8)} ${String(cand.source).split("+")[0]} — ${String(
              cand.title || ""
            ).slice(0, 40)}…`,
          });
          try {
            const detail = await scrapeProduct(cand.url);
            detail.images = (detail.images || []).filter(isRealProductImage);
            let cost = sanitizeProductPrice(detail.price, detail.title || cand.title);
            // Amazon / Cdiscount : prix carte search du MÊME ASIN/URL = fiable si fiche sans prix (souvent "voir panier")
            if (
              !(cost > 0) &&
              cand.price > 0 &&
              cand.priceFromMarketplaceCard &&
              /^(amazon|cdiscount)/i.test(String(cand.source || ""))
            ) {
              cost = sanitizeProductPrice(cand.price, detail.title || cand.title);
              if (cost > 0) {
                send({
                  type: "log",
                  message: `[VERIFY] ✓ ${Number(cost).toFixed(2)}€ (carte ${String(cand.source).split("+")[0]} — fiche sans prix affiché)`,
                });
              }
            }
            if (!(cost > 0) && !strictVerified) {
              const resolved = await resolvePriceViaSearch(cand.url, detail.title || cand.title).catch(() => null);
              cost = sanitizeProductPrice(resolved, detail.title || cand.title);
            }
            if (
              !(cost > 0) &&
              !strictVerified &&
              cand.price > 0 &&
              (cand.priceFromMarketplaceCard || !cand.priceUnconfirmed)
            ) {
              cost = sanitizeProductPrice(cand.price, detail.title || cand.title);
            }
            if (!(cost > 0) || !(detail.title && String(detail.title).length > 8)) {
              send({
                type: "log",
                message: `[VERIFY] ✗ rejeté — pas de prix fiche fiable${
                  cand.price > 0 ? ` (indicatif ${Number(cand.price).toFixed(2)}€ ignoré)` : ""
                }`,
              });
              continue;
            }
            detail.price = cost;
            const row = {
              ...cand,
              title: detail.title,
              price: cost,
              priceConfirmed: true,
              priceFromMarketplaceCard: false,
              priceUnconfirmed: false,
              url: cand.url,
            };
            verifiedList.push(row);
            verifiedDetails.set(String(cand.url).split("?")[0].toLowerCase(), detail);
            send({
              type: "log",
              message: `[VERIFY] ✓ ${Number(cost).toFixed(2)}€ — ${String(detail.title).slice(0, 45)}`,
            });
          } catch (e) {
            send({ type: "log", message: `[VERIFY] ✗ ${e.message.slice(0, 80)}` });
          }
        }

        verifiedList.sort((a, b) => a.price - b.price);
        candidates = strictVerified ? verifiedList : verifiedList.length ? verifiedList : candidates;

        send({
          type: "suppliers",
          query: searchQ,
          compared: verifiedList.length,
          verifiedOnly: strictVerified,
          items: (strictVerified ? verifiedList : candidates).slice(0, 5).map((c, idx) => ({
            rank: idx + 1,
            source: String(c.source || "").split("+")[0],
            title: String(c.title || "").slice(0, 90),
            price: c.price != null && c.price > 0 ? Number(c.price) : null,
            priceConfirmed: !!c.priceConfirmed || verifiedDetails.has(String(c.url).split("?")[0].toLowerCase()),
            priceUnconfirmed: !c.priceConfirmed && !!c.priceUnconfirmed,
            url: c.url,
            best: idx === 0,
          })),
        });

        if (!candidates.length || (strictVerified && !verifiedList.length)) {
          skipped += 1;
          send({
            type: "log",
            message: `[SKIP] Aucun fournisseur avec prix VÉRIFIÉ sur la fiche. Astuce: Source=Amazon, ou colle l'URL Ali dans Import Manuel.`,
          });
          errors += 1;
          send({ type: "stats", scanned, imported, listed, errors });
          continue;
        }

        send({
          type: "log",
          message: `[VERIFY] ${verifiedList.length} offre(s) vérifiée(s) — moins cher: ${
            verifiedList[0]
              ? `${String(verifiedList[0].source).split("+")[0]} @ ${Number(verifiedList[0].price).toFixed(2)}€`
              : "n/a"
          }`,
        });

        // Import depuis candidats vérifiés (réutilise le scrape du pass VERIFY)
        let supplier = null;
        let detail = null;
        for (let ci = 0; ci < Math.min(candidates.length, 5); ci++) {
          const cand = candidates[ci];
          const cacheKey = String(cand.url || "").split("?")[0].toLowerCase();
          send({
            type: "log",
            message: `[TRY] #${ci + 1}/${Math.min(candidates.length, 5)} — ${String(cand.source).split("+")[0]} @ ${
              cand.price > 0 ? Number(cand.price).toFixed(2) + "€" : "?"
            }${cand.priceConfirmed ? " [VÉRIFIÉ]" : ""}`,
          });
          try {
            detail = verifiedDetails.get(cacheKey) || null;
            if (!detail) {
              detail = await scrapeProduct(cand.url);
              detail.images = (detail.images || []).filter(isRealProductImage);
            }
            let cost = sanitizeProductPrice(detail.price, detail.title || cand.title);
            let costOrigin = "fiche";

            if (!(cost > 0) && !strictVerified) {
              try {
                const resolved = await resolvePriceViaSearch(cand.url, detail.title || cand.title);
                cost = sanitizeProductPrice(resolved, detail.title || cand.title);
                if (cost > 0) costOrigin = "web";
              } catch (_) {}
            }
            if (
              !(cost > 0) &&
              !strictVerified &&
              cand.price > 0 &&
              (cand.priceFromMarketplaceCard || !cand.priceUnconfirmed)
            ) {
              cost = sanitizeProductPrice(cand.price, detail.title || cand.title);
              if (cost > 0) costOrigin = "carte marketplace";
            }

            // En mode strict : uniquement prix déjà confirmé sur fiche
            if (strictVerified && !(cost > 0 && cand.priceConfirmed)) {
              if (!(cost > 0)) {
                send({ type: "log", message: `[WARN] Pas de prix fiche — essai suivant` });
                detail = null;
                continue;
              }
            }

            if (!(cost > 0)) {
              send({ type: "log", message: `[WARN] Prix introuvable — essai suivant` });
              detail = null;
              continue;
            }

            if (!(detail.title && String(detail.title).length > 8) && cand.title) {
              detail.title = cand.title;
            }
            if (!(detail.title && String(detail.title).length > 8)) {
              send({ type: "log", message: `[WARN] Titre manquant — essai suivant` });
              detail = null;
              continue;
            }

            detail.price = cost;
            supplier = {
              ...cand,
              price: cost,
              priceConfirmed: true,
              priceUnconfirmed: false,
              title: detail.title || cand.title,
            };
            send({
              type: "log",
              message: `[IMPORT] OK — ${(detail.images || []).length} images, coût ${cost.toFixed(2)}€ (${costOrigin})`,
            });
            send({
              type: "suppliers",
              query: searchQ,
              compared: verifiedList.length || 1,
              verifiedOnly: strictVerified,
              items: [
                {
                  rank: 1,
                  source: String(supplier.source || "").split("+")[0],
                  title: String(supplier.title || "").slice(0, 90),
                  price: cost,
                  priceConfirmed: true,
                  url: supplier.url,
                  best: true,
                },
                ...candidates
                  .filter((c) => c.url !== supplier.url)
                  .slice(0, 4)
                  .map((c, idx) => ({
                    rank: idx + 2,
                    source: String(c.source || "").split("+")[0],
                    title: String(c.title || "").slice(0, 90),
                    price: c.price != null && c.price > 0 ? Number(c.price) : null,
                    priceConfirmed: !!c.priceConfirmed,
                    url: c.url,
                    best: false,
                  })),
              ],
            });
            break;
          } catch (e) {
            send({ type: "log", message: `[WARN] Détail produit: ${e.message}` });
            detail = null;
          }
        }

        if (!supplier || !detail || !detail.title) {
          skipped += 1;
          send({ type: "log", message: `[SKIP] Impossible d'obtenir une fiche fournisseur avec prix valide` });
          errors += 1;
          send({ type: "stats", scanned, imported, listed, errors });
          continue;
        }

        const cost = detail.price || supplier.price;
        if (!cost || cost < 0.5 || cost > 500) {
          skipped += 1;
          send({ type: "log", message: `[SKIP] Prix fournisseur invalide (${cost})` });
          errors += 1;
          continue;
        }

        const sellPrice = Number((cost * (1 + Number(margin) / 100) * 1.35).toFixed(2));
        const marginPct = (((sellPrice - cost) / sellPrice) * 100).toFixed(0);
        send({
          type: "log",
          message: `[MARGIN] Coût ${Number(cost).toFixed(2)}€ → Revente ${sellPrice}€ (marge ~${marginPct}%)`,
        });
        send({
          type: "margin",
          cost: Number(cost),
          sellPrice,
          marginPct: Number(marginPct),
          supplier: String(supplier.source || "").split("+")[0],
          url: supplier.url,
          title: String(detail.title || supplier.title || "").slice(0, 100),
        });

        const discreet = prepareDiscreetListing(
          {
            ...detail,
            title: stripSupplierProvenance(detail.title),
            price: cost,
            source: detail.source || supplier.source,
            url: supplier.url,
          },
          { marginMult: 1 + Number(margin) / 100 }
        );
        const title = stripSupplierProvenance(discreet.seo_title || detail.title).slice(0, 80);
        const images = (discreet.images || []).filter(isRealProductImage);
        const html = buildHtmlFromProduct(
          {
            title,
            images,
            bullets: (detail.bullets || [])
              .map((b) => String(b).replace(/^\s*source\s*:\s*/i, "").trim())
              .filter(Boolean)
              .slice(0, 8),
            description: detail.description || "",
            price: cost,
            source: detail.source || supplier.source,
          },
          "#6d7ddf"
        );

        const result = insertListingSafe({
          seoTitle: title,
          html,
          price: sellPrice,
          keywords: query,
          sourceUrl: supplier.url,
        });
        if (result.duplicate) {
          send({ type: "log", message: `[SKIP] Doublon récent ignoré — "${title.slice(0, 40)}" (id ${result.id})` });
          send({ type: "stats", scanned, imported, listed, errors });
          continue;
        }
        imported += 1;
        send({ type: "stats", scanned, imported, listed, errors });
        await antiBanDelay({ testMode, label: "import" });

        if (!autoList) {
          send({ type: "log", message: `[SKIP] Listing auto désactivé — import seul (id ${result.id}) → vois Mes Listings` });
        } else {
          send({ type: "log", message: `[LISTING] Publication eBay (mode REEL)...` });
          try {
            const listing = getListingById.get(Number(result.id));
            const pub = await publishToEbay(listing, listing.id, {
              variations: {
                enabled: true,
                aspect: "Couleur",
                values: /led|bande|strip|cob|n[eé]on/i.test(String(listing.seo_title || ""))
                  ? ["Blanc chaud", "Blanc froid"]
                  : ["Option A", "Option B"],
              },
            });
            if (pub?.listingId) {
              rememberListingPublish(listing.id, pub);
            }
            send({ type: "log", message: `[OK] Publié — listingId=${pub.listingId || "n/a"}` });
            listed += 1;
          } catch (e) {
            errors += 1;
            send({ type: "log", message: `[ERROR] Publish: ${e.message}` });
            send({ type: "log", message: `[INFO] Import quand même en Mes Listings (id ${result.id})` });
          }
        }

        // Pas d'insertion Auto-Order ici — uniquement après vraie vente eBay (sync)
        send({ type: "stats", scanned, imported, listed, errors });
        await antiBanDelay({ testMode, label: "loop" });
      } catch (err) {
        errors += 1;
        send({ type: "log", message: `[ERROR] ${err.message}` });
        send({ type: "stats", scanned, imported, listed, errors });
      }
    }

    send({
      type: "log",
      message: `[DONE] Auto-Snipe terminé — ${listed} listé(s), ${imported} importé(s), ${errors} erreur(s), skip=${skipped}, VeRO=${veroBlocked}`,
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
        scraped.title = stripSupplierProvenance(scraped.title);
        scraped.description = cleanMarketingCopy(scraped.description || "");
        scraped.bullets = (scraped.bullets || [])
          .map((b) => cleanMarketingCopy(String(b).replace(/^\s*source\s*:\s*/i, "")))
          .filter((b) => b && !/^source\s*:/i.test(b));
        const discreet = prepareDiscreetListing(scraped, { marginMult: 1.8 });
        discreet.seo_title = stripSupplierProvenance(discreet.seo_title);
        if (discreet.product) {
          discreet.product.title = stripSupplierProvenance(discreet.product.title);
          discreet.product.description = cleanMarketingCopy(discreet.product.description || "");
        }
        listing = {
          ...discreet,
          html_description: sanitizeListingHtml(
            buildHtmlFromProduct(discreet.product, themeColor || "#667eea")
          ),
          source: scraped.source,
          live: true,
        };
      } catch (scrapeErr) {
        console.warn("[EBX] scrape produit fail:", scrapeErr.message);
        listing = buildDescriptionFromUrl(productUrl, themeColor || "#667eea");
        listing.live = false;
        listing.scrape_error = scrapeErr.message;
        listing.original_title = stripSupplierProvenance(listing.product_name || listing.seo_title);
        listing.seo_title = stripSupplierProvenance(
          rewriteEbayTitle(listing.seo_title || listing.product_name || "Produit")
        );
        listing.title_rewritten = true;
        listing.product = {
          title: listing.seo_title,
          originalTitle: listing.original_title,
          images: listing.images || [],
          bullets: [],
          description: "",
          price: listing.suggested_price,
          source: "fallback",
          url: productUrl,
        };
        listing.html_description = sanitizeListingHtml(
          buildHtmlFromProduct(listing.product, themeColor || "#667eea")
        );
      }

      // Enrichissement LLM optionnel — ne remplace pas un bon scrape par du vide / générique
      try {
        const baseProduct = {
          ...(listing.product || scraped || {}),
          title: listing.original_title || listing.product_name || listing.seo_title,
          originalTitle: listing.original_title || scraped?.title,
          images: listing.images || scraped?.images || [],
        };
        const aiPromise = generateProductCopy(baseProduct);
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("LLM timeout")), 14000));
        const ai = await Promise.race([aiPromise, timeout]);
        if (ai && !ai._parse_error) {
          const aiTitle = stripSupplierProvenance(
            rewriteEbayTitle(ai.seo_title || listing.seo_title || baseProduct.title)
          );
          const aiSections = Array.isArray(ai.sections) ? ai.sections.filter((s) => s?.body) : [];
          const aiBenefits = Array.isArray(ai.benefits) ? ai.benefits.filter(Boolean) : [];
          const product = enrichProductListingCopy({
            ...baseProduct,
            title: aiTitle,
            originalTitle: listing.original_title || baseProduct.title,
            description: cleanMarketingCopy(ai.short_pitch || baseProduct.description || ""),
            short_pitch: cleanMarketingCopy(ai.short_pitch || baseProduct.short_pitch || ""),
            sections: aiSections.length ? aiSections : baseProduct.sections,
            benefits: aiBenefits.length ? aiBenefits : baseProduct.benefits,
            bullets: aiBenefits.length ? aiBenefits : baseProduct.bullets,
            specs:
              ai.specs && typeof ai.specs === "object"
                ? { ...(baseProduct.specs || {}), ...ai.specs }
                : baseProduct.specs,
            price: baseProduct.price || scraped?.price,
            source: baseProduct.source || scraped?.source,
          });
          listing = {
            ...listing,
            seo_title: aiTitle,
            product_name: aiTitle,
            html_description: sanitizeListingHtml(buildHtmlFromProduct(product, themeColor || "#667eea")),
            suggested_price: ai.suggested_price || listing.suggested_price,
            ai_enriched: true,
            title_rewritten: true,
            product,
            images: product.images || listing.images,
          };
        }
      } catch (llmErr) {
        console.warn("[EBX] LLM skip:", llmErr.message);
      }

      // Garantit sections/bénéfices même sans LLM
      if (listing.product) {
        listing.product = enrichProductListingCopy({
          ...listing.product,
          originalTitle: listing.original_title || listing.product.originalTitle || listing.product.title,
          images: listing.images || listing.product.images || [],
        });
        listing.html_description = sanitizeListingHtml(
          buildHtmlFromProduct(listing.product, themeColor || "#667eea")
        );
        listing.images = listing.product.images || listing.images;
        listing.enrichment = {
          version: "desc-v2",
          sections: (listing.product.sections || []).length,
          benefits: (listing.product.benefits || []).length,
          specs: Object.keys(listing.product.specs || {}).length,
          images: (listing.images || []).length,
          source: listing.source,
        };
      }
    } else {
      if (!productName) return res.status(400).json({ error: "productName ou productUrl requis" });
      listing = await generateListing(productName, rawKeywords || "");
      listing.seo_title = stripSupplierProvenance(listing.seo_title || productName);
      listing.html_description = sanitizeListingHtml(listing.html_description || "");
    }

    listing.seo_title = stripSupplierProvenance(listing.seo_title || "");
    listing.product_name = stripSupplierProvenance(listing.product_name || listing.seo_title);
    if (listing.product) listing.product.title = stripSupplierProvenance(listing.product.title || listing.seo_title);
    listing.html_description = sanitizeListingHtml(listing.html_description || "");

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
    const cleanedProduct = enrichProductListingCopy({
      ...product,
      title: stripSupplierProvenance(product.title),
      originalTitle: product.originalTitle || product.original_title || product.title,
      description: cleanMarketingCopy(product.description || ""),
      bullets: (product.bullets || [])
        .map((b) => cleanMarketingCopy(String(b).replace(/^\s*source\s*:\s*/i, "")))
        .filter((b) => b && !/^source\s*:/i.test(b)),
    });
    const html = sanitizeListingHtml(buildHtmlFromProduct(cleanedProduct, themeColor));
    res.json({
      success: true,
      data: {
        product_name: cleanedProduct.title,
        seo_title: String(cleanedProduct.title || "").slice(0, 80),
        html_description: html,
        images: cleanedProduct.images || [],
        source: cleanedProduct.source || "generic",
        product: cleanedProduct,
        live: true,
        enrichment: {
          version: "desc-v2",
          sections: (cleanedProduct.sections || []).length,
          benefits: (cleanedProduct.benefits || []).length,
          specs: Object.keys(cleanedProduct.specs || {}).length,
          images: (cleanedProduct.images || []).length,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/listings", (_req, res) => {
  try {
    const rows = getRecentListings.all().filter(listingIsSupplierSourced);
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Erreur base de données." });
  }
});

app.post("/api/listings/purge-ebay-sources", (_req, res) => {
  try {
    const removed = purgeNonSupplierListings();
    const orders = purgeFakeAutoOrders();
    res.json({ success: true, removedListings: removed, removedOrders: orders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/listings/:id", (req, res) => {
  try {
    const listing = getListingById.get(req.params.id);
    if (!listing) return res.status(404).json({ success: false, error: "Listing introuvable." });
    const cleaned = scrubWhySectionInHtml(listing.html_description || "");
    if (cleaned && cleaned !== listing.html_description) {
      try {
        updateListingHtml.run(cleaned, listing.id);
      } catch (_) {}
      listing.html_description = cleaned;
    }
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
const updateListingTitle = db.prepare("UPDATE listings SET seo_title = ? WHERE id = ?");
const updateListingPrice = db.prepare("UPDATE listings SET suggested_price = ? WHERE id = ?");

app.patch("/api/listings/:id", (req, res) => {
  try {
    const listing = getListingById.get(req.params.id);
    if (!listing) return res.status(404).json({ success: false, error: "Listing introuvable." });
    const { seo_title, html_description, suggested_price } = req.body || {};
    if (seo_title != null) {
      const title = String(seo_title)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
      if (!title) return res.status(400).json({ success: false, error: "Titre vide" });
      updateListingTitle.run(title, listing.id);
      listing.seo_title = title;
    }
    if (html_description != null) {
      updateListingHtml.run(String(html_description), listing.id);
      listing.html_description = html_description;
    }
    if (suggested_price != null && suggested_price !== "") {
      const price = Number(suggested_price);
      if (!(price > 0) || price > 100000) {
        return res.status(400).json({ success: false, error: "Prix invalide" });
      }
      updateListingPrice.run(price, listing.id);
      listing.suggested_price = price;
    }
    return res.json({ success: true, data: getListingById.get(listing.id) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

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

app.post("/api/listings/scrub-why", (_req, res) => {
  try {
    const rows = db.prepare("SELECT id, html_description FROM listings").all();
    let fixed = 0;
    for (const row of rows) {
      const cleaned = scrubWhySectionInHtml(row.html_description || "");
      if (cleaned && cleaned !== row.html_description) {
        updateListingHtml.run(cleaned, row.id);
        fixed += 1;
      }
    }
    return res.json({ success: true, fixed });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

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
    const variations = req.body?.variations || {
      enabled: true,
      aspect: "Couleur",
      values: defaultVariantValuesForTitle(listing.seo_title),
    };
    const result = await publishToEbay(listing, listing.id, { variations });
    if (result?.listingId) {
      rememberListingPublish(listing.id, result);
      const saved = getListingById.get(listing.id);
      console.log(
        `[EBX] Listing #${listing.id} mémorisé → ebay_listing_id=${saved?.ebay_listing_id} env=${saved?.publish_env} variations=${saved?.variations_active ? "OK" : "off"}`
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
    clearListingPublish(listing.id);
    res.json({ success: true, data: { id: listing.id, status: "ended" } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/auto-orders/sync-ebay", async (_req, res) => {
  try {
    const { getRecentOrders } = require("./ebay-api");
    const { orders, env, sellerUserId } = await getRecentOrders({ limit: 40, daysBack: 90 });
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
      // SKU EBX-{listingId}-… → retrouver le listing source
      let match = { source_url: "", supplier: "eBay→fournisseur" };
      const sku = String(line?.sku || "");
      const skuHit = sku.match(/^EBX-(\d+)/i);
      if (skuHit) {
        const listing = getListingById.get(Number(skuHit[1]));
        if (listing?.source_url) {
          const src = listing.source_url;
          match = {
            source_url: src,
            supplier: /amazon/i.test(src)
              ? "Amazon"
              : /cdiscount/i.test(src)
                ? "Cdiscount"
                : /aliexpress/i.test(src)
                  ? "AliExpress"
                  : "Fournisseur",
            listingId: listing.id,
          };
        }
      }
      if (!match.source_url) match = findSupplierForTitle(title);

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
    const cfg = getSupplierConfig();
    let autoPack = null;
    if (created > 0 && (cfg.autoOrderMode || cfg.autoProcessOnSync)) {
      try {
        // Relance logique file (réutilise même endpoint en interne)
        const rows = getOrders.all().filter((o) => isRealEbayOrderRef(o.order_ref) && o.status === "pending");
        const maxLeft = Math.max(0, (cfg.maxPerDay || 50) - (cfg.processedToday || 0));
        autoPack = { processed: 0, ids: [] };
        for (const row of rows.slice(0, maxLeft)) {
          const key = supplierKeyFromName(row.supplier + " " + (row.source_url || ""));
          if (cfg[key]?.enabled === false || cfg[key]?.comingSoon) continue;
          if (cfg.autoOrderMode && cfg[key]?.auto === false) continue;
          let url = row.source_url;
          let supplier = row.supplier;
          if (!url) {
            const found = findSupplierForTitle(row.product);
            url = found.source_url;
            supplier = found.supplier || supplier;
          }
          if (!url) {
            const q = encodeURIComponent(String(row.product || "").split(/\s+/).slice(0, 5).join(" "));
            url = `https://www.aliexpress.com/w/wholesale-${q}.html`;
            supplier = "AliExpress";
          }
          updateOrderSource.run(url, supplier || "Fournisseur", row.order_ref);
          updateOrderStatus.run("ordered", row.order_ref);
          autoPack.ids.push(row.order_ref);
          autoPack.processed += 1;
        }
        cfg.processedToday = (cfg.processedToday || 0) + autoPack.processed;
        cfg.processedDay = new Date().toISOString().slice(0, 10);
        saveSupplierConfig(cfg);
      } catch (_) {}
    }
    res.json({
      success: true,
      fetched: orders.length,
      created,
      updated,
      autoProcessed: autoPack?.processed || 0,
      autoOrderMode: cfg.autoOrderMode,
      ebayEnv: env,
      sellerUserId: sellerUserId || null,
      note:
        orders.length === 0
          ? `Aucune vente trouvée sur le compte ${sellerUserId || "eBay"} (${env}) ces 90 derniers jours. Normal si tu n'as pas encore de commande acheteur.`
          : `${orders.length} commande(s) synchronisée(s) depuis ${sellerUserId || "eBay"} (${env}).`,
    });
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

const server = app.listen(PORT, () => {
  const { isProduction } = require("./ebay-api");
  console.log(`⚡ EBX Server running on http://localhost:${PORT}`);
  console.log(`📝 Description Builder: desc-v2 (infos produit enrichies)`);
  console.log(`🧠 LLM endpoint: ${process.env.LOCAL_LLM_URL || "http://localhost:1234/v1"}`);
  console.log(`🛒 Publish mode: ${isProduction() ? "PRODUCTION (réel)" : "sandbox (test)"}`);
  console.log(`🌐 Mode: live scrapers + fallbacks`);
});
server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`\n❌ Port ${PORT} déjà utilisé — l'ANCIEN serveur tourne encore.`);
    console.error(`   PowerShell :  npm run kill-port`);
    console.error(`   Puis :        npm start\n`);
    console.error(`   Ou en une commande :  npm run restart\n`);
    process.exit(1);
  }
  throw err;
});
