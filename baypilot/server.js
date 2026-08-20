const { loadEbayEnv } = require("./load-env");
loadEbayEnv();
const { dbPath, ensureClientDirs, opsStatePath, clientMeta, PRODUCT_NAME } = require("./runtime-paths");
const {
  loadOpsState,
  saveOpsState,
  mergeOnboarding,
  nextOnboardingStep,
  isAutoPublishArmed,
  computePnl,
  buildWeeklyReport,
  reportToHtml,
} = require("./ops-engine");
ensureClientDirs();
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
  titleMatchesQuery,
  resolvePriceViaSearch,
  sanitizeProductPrice,
  confirmAliPriceLoop,
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
  scanHazardous,
  scoreSeoTitle,
  buildAiTitle,
  prepareDiscreetListing,
  rewriteEbayTitle,
  estimateMargin,
  competitiveSellPrice,
  buildPilotageFeed,
  getEventCalendar,
  getTrendingNiches,
  getTopSellers,
  getMarketPulse,
  shouldEscalateSav,
  draftSavReplyTemplate,
} = require("./business-engine");
const {
  languageForMarket,
  buildDemandKeywords,
  nextDemandSlice,
  pickMostProfitableOffer,
  rankOffersByProfit,
  isSupplierUrl,
  competitorMarketPrices,
  explainUnprofitable,
  snipableDemandQuery,
  rollPipelineDay,
  looksLikeCategoryLabel,
  DEFAULT_PREPARE_PER_TICK,
  DEFAULT_PUBLISH_PER_TICK,
  QUEUE_CAP,
  DEMAND_ALGO,
} = require("./auto-publish-engine");
const {
  getRankings,
  analyzeTitleKeywords,
  analyzeCompetitor,
  buildDescriptionFromUrl,
  getDashboardStats,
  getAutoOrders,
} = require("./mock-data");
const { generateListing, generateSavReply, generateProductCopy } = require("./ai-brain");
const { publishToEbay, runWithSeller, clearTokenCache, getSellerIdentity } = require("./ebay-api");
const { normalizeListingLang, languageLabel, copyMatchesLanguage } = require("./listing-i18n");
const {
  createWebAuth,
  publicBaseUrl,
  signOAuthState,
  verifyOAuthState,
} = require("./web-auth");
const { cleanEnvToken } = require("./load-env");

const app = express();
const PORT = process.env.PORT || 3101;

const db = new DatabaseSync(dbPath());
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
if (!listingCols.includes("cost_price")) {
  db.exec("ALTER TABLE listings ADD COLUMN cost_price REAL DEFAULT 0");
}
if (!listingCols.includes("auto_prepared")) {
  db.exec("ALTER TABLE listings ADD COLUMN auto_prepared INTEGER DEFAULT 0");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS auto_publish_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER,
    seo_title TEXT,
    sell_price REAL,
    cost_price REAL,
    competitor_price REAL,
    competitor_count INTEGER DEFAULT 0,
    net_pct REAL,
    ebay_listing_id TEXT DEFAULT '',
    marketplace TEXT DEFAULT 'FR',
    status TEXT,
    detail TEXT DEFAULT '',
    published_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const getRecentListings = db.prepare(
  `SELECT id, seo_title, suggested_price, cost_price, keywords, source_url, created_at,
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
  const active =
    vars && vars.enabled !== false && Array.isArray(vars.values) && vars.values.length >= 2 ? 1 : 0;
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
  "INSERT INTO listings (seo_title, html_description, suggested_price, keywords, source_url, cost_price) VALUES (?, ?, ?, ?, ?, ?)"
);
const findRecentDuplicate = db.prepare(
  `SELECT id FROM listings
   WHERE seo_title = ?
     AND ABS(suggested_price - ?) < 0.01
     AND datetime(created_at) >= datetime('now', '-30 seconds')
   ORDER BY id DESC LIMIT 1`
);

/** Insert listing; si même titre+prix dans les 30s → réutilise l'id (anti double-clic / double sniper). */
function insertListingSafe({ seoTitle, html, price, keywords = "", sourceUrl = "", costPrice = 0 }) {
  const title = String(seoTitle || "").slice(0, 80);
  const suggested = Number(price) || 0;
  const cost = Number(costPrice) || 0;
  const recent = findRecentDuplicate.get(title, suggested);
  if (recent) {
    return { id: Number(recent.id), duplicate: true };
  }
  const result = insertListingStmt.run(
    title,
    String(html || ""),
    suggested,
    String(keywords || ""),
    String(sourceUrl || ""),
    cost
  );
  return { id: Number(result.lastInsertRowid), duplicate: false };
}

/** Insert + cache images locales (async). */
async function insertListingWithImageCache(opts) {
  const result = insertListingSafe(opts);
  try {
    const row = getListingById.get(result.id);
    if (row) await localizeListingImages(row);
  } catch (err) {
    console.warn(`[EBX] cache images listing #${result.id}:`, err.message);
  }
  return result;
}

function marketplaceToCode(marketplace) {
  const s = String(marketplace || "");
  if (/united states|ebay_us|\bus\b/i.test(s)) return "US";
  if (/germany|ebay_de|\bde\b/i.test(s)) return "DE";
  if (/united kingdom|ebay_gb|\bgb\b/i.test(s)) return "GB";
  return "FR";
}

const insertAutoPublishLog = db.prepare(
  `INSERT INTO auto_publish_log
    (listing_id, seo_title, sell_price, cost_price, competitor_price, competitor_count, net_pct, ebay_listing_id, marketplace, status, detail)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const listAutoPublishLog = db.prepare(
  `SELECT id, listing_id, seo_title, sell_price, cost_price, competitor_price, competitor_count, net_pct,
          ebay_listing_id, marketplace, status, detail, published_at
   FROM auto_publish_log
   ORDER BY published_at DESC, id DESC
   LIMIT 200`
);
const listPublishedHistory = db.prepare(
  `SELECT id, seo_title, suggested_price, cost_price, published_at, ebay_listing_id, publish_env, source_url
   FROM listings
   WHERE published_at IS NOT NULL AND TRIM(COALESCE(ebay_listing_id, '')) != ''
   ORDER BY published_at DESC
   LIMIT 200`
);
const listUnpublishedForAuto = db.prepare(
  `SELECT * FROM listings
   WHERE TRIM(COALESCE(ebay_listing_id, '')) = ''
     AND TRIM(COALESCE(seo_title, '')) != ''
     AND COALESCE(auto_prepared, 0) >= 0
   ORDER BY COALESCE(auto_prepared, 0) DESC, created_at ASC
   LIMIT 40`
);
const findListingBySourceUrl = db.prepare(
  `SELECT id FROM listings WHERE source_url = ? ORDER BY id DESC LIMIT 1`
);
const findListingByAutoQuery = db.prepare(
  `SELECT id FROM listings WHERE keywords LIKE ? ORDER BY id DESC LIMIT 1`
);
const markListingAutoPrepared = db.prepare(
  `UPDATE listings SET auto_prepared = 1, suggested_price = ?, cost_price = ? WHERE id = ?`
);
const countAutoQueue = db.prepare(
  `SELECT COUNT(*) AS n FROM listings
   WHERE TRIM(COALESCE(ebay_listing_id, '')) = ''
     AND COALESCE(auto_prepared, 0) = 1`
);

function loadPipelineState(marketplace = "France") {
  let raw = {};
  try {
    raw = JSON.parse(getSetting.get("auto_publish_state")?.value || "{}");
  } catch (_) {
    raw = {};
  }
  return rollPipelineDay(raw, marketplace);
}

function savePipelineState(state) {
  try {
    state.queued = Number(countAutoQueue.get()?.n || 0);
    upsertSetting.run("auto_publish_state", JSON.stringify(state));
  } catch (err) {
    console.warn("[EBX] save pipeline state:", err.message);
  }
}

function listingCost(listing) {
  const stored = Number(listing?.cost_price);
  if (stored > 0) return stored;
  const sell = Number(listing?.suggested_price);
  if (sell > 0) return Number((sell / 1.8).toFixed(2));
  return 0;
}

async function resolveListingCost(listing) {
  let cost = listingCost(listing);
  const sourceUrl = String(listing?.source_url || "");
  if (!(cost >= 1.99) && sourceUrl && isSupplierProductUrl(sourceUrl)) {
    try {
      const scraped = await scrapeProduct(sourceUrl);
      const p = Number(scraped?.price) || 0;
      if (p >= 1.99) {
        cost = p;
        db.prepare("UPDATE listings SET cost_price = ? WHERE id = ?").run(p, listing.id);
      }
    } catch (e) {
      console.warn(`[EBX] cost scrape #${listing.id}:`, e.message);
    }
  }
  return cost;
}

async function loadCompetitorMarket(query, { marketplace = "FR", send = () => {} } = {}) {
  let items = [];
  let api = "";
  try {
    const r = await browseSearch(query, { marketplace, limit: 20 });
    items = r.items || [];
    api = r.api || "browse";
  } catch (err) {
    try {
      const ebay = await scrapeEbaySearch(query, { marketplace, limit: 20 });
      items = ebay.items || [];
      api = "scrape";
    } catch (err2) {
      api = `fail:${err2.message || err.message}`;
      send({ type: "log", message: `[PREPARE] prix eBay: ${err2.message || err.message}` });
    }
  }
  const prices = competitorMarketPrices(items, query);
  return { items, prices, api };
}

async function snipeSupplierCandidates(query, { send = () => {}, fast = true } = {}) {
  const cmp = await findCheapestSupplier(query, {
    sources: ["amazon", "aliexpress", "cdiscount"],
    limit: 3,
    fast,
    onLog: (m) => send({ type: "log", message: m }),
  });
  return (cmp.candidates || []).filter((o) => isSupplierUrl(o.url) && Number(o.price) >= 1.99);
}

function mergeOfferLists(a = [], b = []) {
  const seen = new Set();
  const out = [];
  for (const o of [...a, ...b]) {
    const key = String(o?.url || "")
      .split("?")[0]
      .replace(/\/$/, "")
      .toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  return out;
}

async function priceListingForEbay(listing, { marketplace = "FR", minNetPct = 5 } = {}) {
  const cost = await resolveListingCost(listing);
  const q =
    String(listing.seo_title || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 8)
      .join(" ") || String(listing.seo_title || "produit");
  const market = await loadCompetitorMarket(q, { marketplace });
  const competitorPrices = market.prices;
  const priced = competitiveSellPrice({ cost, competitorPrices, minNetPct });
  return { ...priced, cost, competitorPrices, query: q, api: market.api };
}

let autoPublishBusy = false;
let autoPublishBusySince = 0;
const AUTO_PUBLISH_BUSY_MAX_MS = 12 * 60 * 1000;
const AUTO_PUBLISH_INTERVAL_MS = Math.max(
  15_000,
  Number(process.env.AUTO_PUBLISH_INTERVAL_MS) || 10 * 60 * 1000
);
const autoPublishScheduler = {
  intervalMs: AUTO_PUBLISH_INTERVAL_MS,
  startedAt: null,
  lastFiredAt: null,
  nextFireAt: null,
  fireCount: 0,
  attemptCount: 0,
  lastSkipReason: "",
  timer: null,
};

function claimAutoPublishBusy(send = () => {}) {
  if (autoPublishBusy) {
    const age = Date.now() - (autoPublishBusySince || 0);
    if (age > AUTO_PUBLISH_BUSY_MAX_MS) {
      console.warn(`[EBX] Auto-Publish: verrou expiré après ${Math.round(age / 1000)}s — reset`);
      send({ type: "log", message: `[WARN] Verrou pipeline expiré (${Math.round(age / 60_000)} min) — reprise` });
      autoPublishBusy = false;
    } else {
      return false;
    }
  }
  autoPublishBusy = true;
  autoPublishBusySince = Date.now();
  return true;
}

function releaseAutoPublishBusy() {
  autoPublishBusy = false;
  autoPublishBusySince = 0;
}

function scheduleAutoPublishNext(from = Date.now()) {
  autoPublishScheduler.nextFireAt = new Date(from + autoPublishScheduler.intervalMs).toISOString();
}

function fireScheduledAutoPublish(reason = "interval") {
  autoPublishScheduler.attemptCount += 1;
  const enabled = getSetting.get("auto_publish_enabled")?.value === "1";
  const ops = loadOpsState(opsStatePath());
  const isolated = Boolean(String(process.env.BAYPILOT_CLIENT_DIR || "").trim());
  const armed = !isolated || isAutoPublishArmed(ops);
  if (!enabled) {
    autoPublishScheduler.lastSkipReason = "disabled";
    scheduleAutoPublishNext();
    return { skipped: true, reason: "disabled" };
  }
  if (!armed) {
    autoPublishScheduler.lastSkipReason = "not-armed";
    scheduleAutoPublishNext();
    return { skipped: true, reason: "not-armed" };
  }
  if (autoPublishBusy) {
    const age = Date.now() - (autoPublishBusySince || 0);
    if (age <= AUTO_PUBLISH_BUSY_MAX_MS) {
      autoPublishScheduler.lastSkipReason = "busy";
      console.log(`[auto-publish] pulse #${autoPublishScheduler.attemptCount} (${reason}) reporté — pipeline encore en cours (${Math.round(age / 1000)}s)`);
      scheduleAutoPublishNext();
      return { skipped: true, reason: "busy" };
    }
    console.warn(`[EBX] Auto-Publish interval: verrou expiré (${Math.round(age / 1000)}s)`);
    releaseAutoPublishBusy();
  }
  autoPublishScheduler.lastSkipReason = "";
  autoPublishScheduler.lastFiredAt = new Date().toISOString();
  autoPublishScheduler.fireCount += 1;
  scheduleAutoPublishNext();
  const marketplace = getSetting.get("auto_publish_market")?.value || "France";
  console.log(
    `[auto-publish] tick #${autoPublishScheduler.fireCount} pulse #${autoPublishScheduler.attemptCount} (${reason}) · prochain ${autoPublishScheduler.nextFireAt}`
  );
  runAutoPublishTick({
    marketplace,
    send: (o) => {
      if (o.type === "log") console.log("[auto-publish]", o.message);
    },
  }).catch((err) => console.warn("[auto-publish]", err.message));
  return { skipped: false, reason, fireCount: autoPublishScheduler.fireCount };
}

function startAutoPublishScheduler() {
  if (autoPublishScheduler.timer) return autoPublishScheduler;
  autoPublishScheduler.startedAt = new Date().toISOString();
  scheduleAutoPublishNext();
  autoPublishScheduler.timer = setInterval(() => {
    fireScheduledAutoPublish("interval");
  }, autoPublishScheduler.intervalMs);
  const mins = Math.round(autoPublishScheduler.intervalMs / 60000);
  console.log(
    `⏱️  Auto-Publish scheduler: toutes les ${mins} min (${autoPublishScheduler.intervalMs} ms) · prochain ${autoPublishScheduler.nextFireAt}`
  );
  const enabled = getSetting.get("auto_publish_enabled")?.value === "1";
  if (enabled) {
    console.log("[auto-publish] Automatisation déjà ON au démarrage — kick immédiat");
    setImmediate(() => fireScheduledAutoPublish("boot"));
  }
  return autoPublishScheduler;
}

function quarantineListing(listingId, reason = "") {
  try {
    db.prepare("UPDATE listings SET auto_prepared = -1 WHERE id = ?").run(Number(listingId));
    if (reason) console.warn(`[EBX] Listing #${listingId} retiré de la file auto: ${reason.slice(0, 160)}`);
  } catch (err) {
    console.warn(`[EBX] quarantine #${listingId}:`, err.message);
  }
}

function isPhotoPublishError(msg) {
  const m = String(msg || "");
  return /25002|500 pixels|résolution des photos|photo.*exigences|Gallery|trop petite|image trop/i.test(m);
}

async function runAutoPublishBatch({ marketplace = "FR", limit = 5, send = () => {}, nested = false } = {}) {
  if (!nested) {
    if (!claimAutoPublishBusy(send)) {
      send({ type: "log", message: "[SKIP] Auto-Publish déjà en cours" });
      return { busy: true, published: 0, skipped: 0, errors: 0, items: [] };
    }
  }
  const stats = { published: 0, skipped: 0, errors: 0, items: [] };
  const marketCode = marketplaceToCode(marketplace);
  try {
    const max = Math.min(Math.max(Number(limit) || 5, 1), 10);
    const rows = listUnpublishedForAuto
      .all()
      .filter((row) => listingIsSupplierSourced(row))
      .slice(0, max);
    send({
      type: "log",
      message: `[INIT] Auto-Publish — ${rows.length} listing(s), marché ${marketCode}, qty 5000, net ≥ 5%`,
    });
    if (!rows.length) {
      send({ type: "log", message: "[PUBLISH] Aucun listing fournisseur en attente" });
      if (!nested) send({ type: "done", ...stats });
      return stats;
    }

    for (let i = 0; i < rows.length; i++) {
      let listing = rows[i];
      const title = String(listing.seo_title || "Produit");
      send({
        type: "progress",
        pct: Math.round((i / rows.length) * 90) + 5,
        label: `Listing ${i + 1}/${rows.length}`,
        detail: title.slice(0, 70),
      });
      send({ type: "log", message: `[ITEM] #${listing.id} ${title.slice(0, 60)}` });

      const vero = scanVero(`${listing.seo_title} ${listing.html_description || ""}`);
      if (vero.level === "block") {
        stats.skipped += 1;
        insertAutoPublishLog.run(
          listing.id, title, listing.suggested_price || 0, listingCost(listing), null, 0, null, "", marketCode, "skipped", `VeRO: ${vero.message}`
        );
        send({ type: "log", message: `[SKIP] VeRO — ${vero.message}` });
        continue;
      }
      const haz = scanHazardous(`${listing.seo_title} ${listing.html_description || ""}`);
      if (haz.level === "block") {
        stats.skipped += 1;
        insertAutoPublishLog.run(
          listing.id, title, listing.suggested_price || 0, listingCost(listing), null, 0, null, "", marketCode, "skipped", `Hazmat: ${haz.message}`
        );
        send({ type: "log", message: `[SKIP] Hazmat — ${haz.message}` });
        continue;
      }

      try {
        listing = await ensureListingImages(listing);
        if (countRealImagesInHtml(listing.html_description || "") <= 0) {
          stats.skipped += 1;
          insertAutoPublishLog.run(
            listing.id, title, listing.suggested_price || 0, listingCost(listing), null, 0, null, "", marketCode, "skipped", "Pas d'images utilisables"
          );
          send({ type: "log", message: `[SKIP] Pas d'images utilisables` });
          continue;
        }
      } catch (imgErr) {
        stats.errors += 1;
        insertAutoPublishLog.run(
          listing.id, title, listing.suggested_price || 0, listingCost(listing), null, 0, null, "", marketCode, "error", imgErr.message
        );
        send({ type: "log", message: `[ERROR] images: ${imgErr.message}` });
        continue;
      }

      let priced;
      try {
        priced = await priceListingForEbay(listing, { marketplace: marketCode, minNetPct: 5 });
      } catch (priceErr) {
        stats.errors += 1;
        insertAutoPublishLog.run(
          listing.id, title, listing.suggested_price || 0, listingCost(listing), null, 0, null, "", marketCode, "error", priceErr.message
        );
        send({ type: "log", message: `[ERROR] prix: ${priceErr.message}` });
        continue;
      }

      send({
        type: "log",
        message: `[PRICE] coût ${Number(priced.cost).toFixed(2)}€ · min ${Number(priced.minSell).toFixed(2)}€ · concurrent ${
          priced.cheapest != null ? Number(priced.cheapest).toFixed(2) + "€" : "n/a"
        } (${priced.competitorCount}) · vente ${Number(priced.sell).toFixed(2)}€ · net ${priced.netPct}%`,
      });

      if (!(priced.sell > 0) || !priced.profitable || (priced.competitorCount > 0 && priced.competitive === false)) {
        stats.skipped += 1;
        const why =
          priced.competitorCount > 0 && priced.competitive === false
            ? `Pas assez concurrentiel (plancher ${priced.minSell}€ vs eBay ${priced.cheapest}€)`
            : `Rentabilité < 5% (net ${priced.netPct}%, min ${priced.minSell}€)`;
        insertAutoPublishLog.run(
          listing.id,
          title,
          priced.sell || 0,
          priced.cost || 0,
          priced.cheapest,
          priced.competitorCount || 0,
          priced.netPct,
          "",
          marketCode,
          "skipped",
          why
        );
        quarantineListing(listing.id, why);
        send({ type: "log", message: `[SKIP] ${why} — retiré de la file auto` });
        continue;
      }

      db.prepare("UPDATE listings SET suggested_price = ? WHERE id = ?").run(priced.sell, listing.id);
      listing.suggested_price = priced.sell;

      try {
        await antiBanDelay({ testMode: false, label: "auto-publish" });
        const result = await publishToEbay(listing, listing.id, { quantity: 5000, variations: { enabled: false } });
        if (result?.listingId) {
          rememberListingPublish(listing.id, result);
          stats.published += 1;
          const row = {
            listingId: listing.id,
            title,
            price: priced.sell,
            date: new Date().toISOString(),
            ebayListingId: result.listingId,
          };
          stats.items.push(row);
          insertAutoPublishLog.run(
            listing.id,
            title,
            priced.sell,
            priced.cost || 0,
            priced.cheapest,
            priced.competitorCount || 0,
            priced.netPct,
            String(result.listingId),
            marketCode,
            "published",
            `qty 5000 · ${priced.competitorCount} concurrent(s)`
          );
          send({
            type: "published",
            item: row,
          });
          send({ type: "log", message: `[OK] publié #${result.listingId} à ${priced.sell.toFixed(2)}€` });
        } else {
          throw new Error("Pas de listingId eBay");
        }
      } catch (pubErr) {
        stats.errors += 1;
        const errMsg = String(pubErr.message || pubErr).slice(0, 400);
        insertAutoPublishLog.run(
          listing.id,
          title,
          priced.sell,
          priced.cost || 0,
          priced.cheapest,
          priced.competitorCount || 0,
          priced.netPct,
          "",
          marketCode,
          "error",
          errMsg
        );
        send({ type: "log", message: `[ERROR] publish: ${pubErr.message}` });
        if (isPhotoPublishError(errMsg)) {
          try {
            send({ type: "log", message: `[REPAIR] Photos eBay < 500px — re-scrape images…` });
            listing = await ensureListingImages(listing);
            const result2 = await publishToEbay(listing, listing.id, { quantity: 5000, variations: { enabled: false } });
            if (result2?.listingId) {
              rememberListingPublish(listing.id, result2);
              stats.published += 1;
              stats.errors = Math.max(0, stats.errors - 1);
              insertAutoPublishLog.run(
                listing.id,
                title,
                priced.sell,
                priced.cost || 0,
                priced.cheapest,
                priced.competitorCount || 0,
                priced.netPct,
                String(result2.listingId),
                marketCode,
                "published",
                `qty 5000 · photos réparées`
              );
              send({ type: "log", message: `[OK] publié #${result2.listingId} après réparation photos` });
              continue;
            }
          } catch (repairErr) {
            send({ type: "log", message: `[REPAIR] échec: ${repairErr.message}` });
          }
          quarantineListing(listing.id, errMsg);
          send({ type: "log", message: `[SKIP] Listing #${listing.id} retiré de la file (photos eBay)` });
        }
      }
    }
    send({ type: "stats", ...stats });
    send({
      type: "log",
      message: `[PUBLISH] publiés ${stats.published} · ignorés ${stats.skipped} · erreurs ${stats.errors}`,
    });
    if (!nested) {
      send({ type: "done", ...stats });
    }
    return stats;
  } finally {
    if (!nested) releaseAutoPublishBusy();
  }
}

async function buildListingFromSupplierUrl(productUrl, { language = "fr", themeColor = "#6d7ddf" } = {}) {
  const langOpts = { language, forceLanguage: language === "en" || language === "de" };
  const scraped = await scrapeProduct(productUrl);
  scraped.images = (scraped.images || []).filter(isRealProductImage);
  scraped.title = stripSupplierProvenance(scraped.title);
  scraped.description = cleanMarketingCopy(scraped.description || "");
  scraped.bullets = (scraped.bullets || [])
    .map((b) => cleanMarketingCopy(String(b).replace(/^\s*source\s*:\s*/i, "")))
    .filter((b) => b && !/^source\s*:/i.test(b));
  const vero = scanVero(`${scraped.title} ${(scraped.bullets || []).join(" ")}`);
  if (vero.level === "block") throw new Error(`VeRO: ${vero.message}`);
  const haz = scanHazardous(`${scraped.title} ${scraped.description || ""}`);
  if (haz.level === "block") throw new Error(`Hazmat: ${haz.message}`);
  const discreet = prepareDiscreetListing(scraped, { marginMult: 1.8, language });
  discreet.seo_title = stripSupplierProvenance(discreet.seo_title);
  if (discreet.product) {
    discreet.product.title = stripSupplierProvenance(discreet.product.title);
    discreet.product.description = cleanMarketingCopy(discreet.product.description || "");
    discreet.product.language = language;
    discreet.product = enrichProductListingCopy(
      {
        ...discreet.product,
        originalTitle: discreet.original_title || discreet.product.originalTitle || discreet.product.title,
        images: scraped.images || [],
        language,
      },
      langOpts
    );
  }
  const html = sanitizeListingHtml(buildHtmlFromProduct(discreet.product, themeColor, langOpts));
  return {
    seoTitle: String(discreet.seo_title || "").slice(0, 80),
    html,
    costPrice: Number(scraped.price) || 0,
    suggestedPrice: Number(discreet.suggested_price) || 0,
    source: scraped.source,
    images: scraped.images || [],
  };
}

async function refreshDemandIfNeeded(marketplace, send = () => {}) {
  const marketCode = marketplaceToCode(marketplace);
  let state = loadPipelineState(marketplace);
  const dirty = (state.keywords || []).some((k) => {
    const q = String(k.query || k || "");
    return looksLikeCategoryLabel(q) || q.split(/\s+/).length < 2;
  });
  const hasSeeds = (state.keywords || []).some((k) => k.reason === "seed" || k.reason === "trend-seed");
  if (
    Array.isArray(state.keywords) &&
    state.keywords.length >= 4 &&
    !dirty &&
    hasSeeds &&
    state.algo === DEMAND_ALGO
  ) {
    return state;
  }
  send({ type: "log", message: `[DEMAND] Scan tendances eBay ${marketCode} (demande du jour)…` });
  let trendItems = [];
  let seeds = [];
  try {
    const { fetchTrendingProducts, seedsForPeriod } = require("./trending-engine");
    seeds = seedsForPeriod("day", new Date(), marketCode) || [];
    const trend = await fetchTrendingProducts({
      marketplace: marketCode,
      period: "day",
      fast: true,
      limit: 16,
      maxMs: 20000,
    });
    trendItems = trend.items || [];
    send({
      type: "log",
      message: `[DEMAND] ${trendItems.length} signal(aux) live${trend.live ? "" : " (cache)"}`,
    });
  } catch (err) {
    send({ type: "log", message: `[DEMAND] trending: ${err.message}` });
  }
  const calendar = getEventCalendar();
  state.keywords = buildDemandKeywords({
    trendItems,
    seeds,
    calendarEvents: calendar,
    limit: 28,
  });
  state.cursor = 0;
  state.algo = DEMAND_ALGO;
  savePipelineState(state);
  send({
    type: "log",
    message: `[DEMAND] ${state.keywords.length} mot(s)-clé(s) ciblés aujourd'hui`,
  });
  return state;
}

async function runAutoPrepareBatch({ marketplace = "France", limit = DEFAULT_PREPARE_PER_TICK, send = () => {} } = {}) {
  const marketCode = marketplaceToCode(marketplace);
  const language = languageForMarket(marketCode);
  const max = Math.min(Math.max(Number(limit) || 2, 1), 5);
  const stats = { prepared: 0, skipped: 0, errors: 0 };
  const queuedNow = Number(countAutoQueue.get()?.n || 0);
  if (queuedNow >= QUEUE_CAP) {
    send({
      type: "log",
      message: `[PREPARE] File pleine (${queuedNow}/${QUEUE_CAP}) — publication d'abord, pas de nouvelles fiches`,
    });
    return stats;
  }
  let state = await refreshDemandIfNeeded(marketplace, send);
  if (!(state.keywords || []).length) {
    send({ type: "log", message: "[PREPARE] Aucun mot-clé demande aujourd'hui" });
    savePipelineState(state);
    return stats;
  }

  const tried = new Set();
  const maxAttempts = Math.min((state.keywords || []).length, Math.max(max * 4, 8));
  while (stats.prepared < max && tried.size < maxAttempts) {
    if (Number(countAutoQueue.get()?.n || 0) >= QUEUE_CAP) {
      send({ type: "log", message: `[PREPARE] File au plafond ${QUEUE_CAP} — stop préparation` });
      break;
    }
    const slice = nextDemandSlice(state.keywords, state.cursor, 1);
    state.cursor = slice.cursor;
    const kw = slice.items[0];
    if (!kw?.query || tried.has(kw.query)) break;
    tried.add(kw.query);

    if (findListingByAutoQuery.get(`%auto-publish:${kw.query}%`)) {
      send({ type: "log", message: `[PREPARE] « ${kw.query} » déjà en Mes Listings — mot-clé suivant` });
      continue;
    }

    state.lastQuery = kw.query;
    state.lastPhase = "prepare";
    send({
      type: "progress",
      pct: 55,
      label: "Préparation",
      detail: `Demande « ${kw.query} »`,
    });
    send({ type: "log", message: `[PREPARE] Demande « ${kw.query} » (${kw.reason}) → sniper fournisseur` });

    const searchQ = snipableDemandQuery(kw.query) || kw.query;
    if (searchQ !== kw.query) {
      send({ type: "log", message: `[PREPARE] requête sniper nettoyée « ${kw.query} » → « ${searchQ} »` });
    }

    const ebayMarket = await loadCompetitorMarket(searchQ, { marketplace: marketCode, send });
    const competitorPrices = ebayMarket.prices;
    send({
      type: "log",
      message: `[PREPARE] ${competitorPrices.length} concurrent(s) eBay neuf/même produit sur ${ebayMarket.items.length} annonce(s) (${ebayMarket.api})${
        competitorPrices[0] ? ` · marché ${competitorPrices[0].toFixed(2)}€` : ""
      }`,
    });

    let candidates = [];
    try {
      candidates = await snipeSupplierCandidates(searchQ, { send, fast: true });
    } catch (e) {
      stats.errors += 1;
      state.skippedToday += 1;
      send({ type: "log", message: `[PREPARE] sniper: ${e.message}` });
      continue;
    }

    if (!candidates.length && searchQ.split(/\s+/).length > 2) {
      const shortQ = searchQ.split(/\s+/).slice(0, 2).join(" ");
      send({ type: "log", message: `[PREPARE] 0 candidat — essai court « ${shortQ} »` });
      try {
        candidates = await snipeSupplierCandidates(shortQ, { send, fast: true });
      } catch (_) {}
    }

    send({
      type: "log",
      message: `[PREPARE] candidats ${candidates.map((c) => `${c.source}:${Number(c.price).toFixed(2)}€`).join(" · ") || "aucun"}`,
    });

    let ranked = rankOffersByProfit(candidates, competitorPrices, 5);
    let best = ranked.find((r) => r.profitable) || null;
    if (!best) {
      send({ type: "log", message: `[PREPARE] relance AliExpress (souvent moins cher)…` });
      try {
        const ali = await findCheapestSupplier(searchQ, {
          sources: ["aliexpress"],
          limit: 3,
          fast: false,
          onLog: (m) => send({ type: "log", message: m }),
        });
        const extra = (ali.candidates || []).filter((o) => isSupplierUrl(o.url) && Number(o.price) >= 1.99);
        candidates = mergeOfferLists(candidates, extra);
        ranked = rankOffersByProfit(candidates, competitorPrices, 5);
        best = ranked.find((r) => r.profitable) || null;
        send({
          type: "log",
          message: `[PREPARE] après Ali: ${candidates.map((c) => `${c.source}:${Number(c.price).toFixed(2)}€`).join(" · ") || "aucun"}`,
        });
      } catch (e) {
        send({ type: "log", message: `[PREPARE] Ali retry: ${e.message}` });
      }
    }

    if (!best) {
      stats.skipped += 1;
      state.skippedToday += 1;
      const why = explainUnprofitable(ranked, competitorPrices);
      insertAutoPublishLog.run(
        0,
        kw.query,
        ranked[0]?.priced?.sell || 0,
        ranked[0]?.offer?.price || 0,
        ranked[0]?.priced?.market || competitorPrices[0] || null,
        competitorPrices.length,
        ranked[0]?.netPct ?? null,
        "",
        marketCode,
        "skipped",
        why
      );
      send({ type: "log", message: `[PREPARE] ignoré « ${kw.query} » — ${why}` });
      continue;
    }

    const url = String(best.offer.url).split("?")[0];
    if (findListingBySourceUrl.get(url)) {
      send({ type: "log", message: `[PREPARE] déjà en Mes Listings — ${url} — mot-clé suivant` });
      continue;
    }

    send({
      type: "log",
      message: `[PREPARE] meilleur fournisseur ${best.offer.source} ${Number(best.offer.price).toFixed(2)}€ → vente ${best.priced.sell}€ (net ${best.netPct}%)`,
    });

    try {
      const built = await buildListingFromSupplierUrl(url, { language });
      const cost = built.costPrice >= 1.99 ? built.costPrice : Number(best.offer.price);
      const priced = competitiveSellPrice({
        cost,
        competitorPrices,
        minNetPct: 5,
      });
      if (!priced.profitable || (priced.competitorCount > 0 && priced.competitive === false)) {
        stats.skipped += 1;
        state.skippedToday += 1;
        const why = `Après scrape: plancher ${priced.minSell}€ vs eBay ${
          priced.market != null ? priced.market + "€" : "n/a"
        } (net ${priced.netPct}%)`;
        insertAutoPublishLog.run(
          0,
          built.seoTitle || kw.query,
          priced.sell || 0,
          cost,
          priced.market || priced.cheapest,
          priced.competitorCount || 0,
          priced.netPct,
          "",
          marketCode,
          "skipped",
          why
        );
        send({ type: "log", message: `[PREPARE] fiche écartée — ${why}` });
        continue;
      }
      const result = await insertListingWithImageCache({
        seoTitle: built.seoTitle,
        html: built.html,
        price: priced.sell,
        keywords: `auto-publish:${kw.query}`,
        sourceUrl: url,
        costPrice: cost,
      });
      markListingAutoPrepared.run(priced.sell, cost, result.id);
      stats.prepared += 1;
      state.preparedToday += 1;
      insertAutoPublishLog.run(
        result.id,
        built.seoTitle,
        priced.sell,
        cost,
        priced.cheapest,
        priced.competitorCount || 0,
        priced.netPct,
        "",
        marketCode,
        "prepared",
        `file d'attente · ${best.offer.source} · qty 5000 au prochain cycle`
      );
      send({
        type: "log",
        message: `[PREPARE] listing #${result.id} en file — ${built.seoTitle.slice(0, 48)} @ ${priced.sell}€`,
      });
    } catch (err) {
      stats.errors += 1;
      state.lastError = err.message;
      send({ type: "log", message: `[PREPARE] listing: ${err.message}` });
    }
  }

  state.lastTickAt = new Date().toISOString();
  savePipelineState(state);
  send({
    type: "log",
    message: `[PREPARE] +${stats.prepared} en file · ignorés ${stats.skipped} · erreurs ${stats.errors}`,
  });
  return stats;
}

async function runAutoPublishTick({
  marketplace = "France",
  publishLimit = DEFAULT_PUBLISH_PER_TICK,
  prepareLimit = DEFAULT_PREPARE_PER_TICK,
  send = () => {},
} = {}) {
  if (!claimAutoPublishBusy(send)) {
    send({ type: "log", message: "[SKIP] pipeline déjà en cours" });
    return { busy: true, published: 0, prepared: 0, skipped: 0, errors: 0 };
  }
  const out = { published: 0, prepared: 0, skipped: 0, errors: 0, items: [] };
  try {
    let state0 = loadPipelineState(marketplace);
    state0.lastTickAt = new Date().toISOString();
    state0.lastPhase = "tick";
    savePipelineState(state0);
    send({
      type: "log",
      message: `[INIT] Pipeline Auto-Publish — publie le lot prêt, puis prépare le suivant (net ≥ 5%, qty 5000)`,
    });
    send({ type: "progress", pct: 8, label: "Publication", detail: "Lot préparé au cycle précédent" });
    const pub = await runAutoPublishBatch({
      marketplace,
      limit: publishLimit,
      send,
      nested: true,
    });
    out.published = pub.published || 0;
    out.skipped += pub.skipped || 0;
    out.errors += pub.errors || 0;
    out.items = pub.items || [];
    let state = loadPipelineState(marketplace);
    state.publishedToday = (Number(state.publishedToday) || 0) + out.published;
    state.lastPhase = "publish";
    savePipelineState(state);

    send({ type: "progress", pct: 48, label: "Préparation", detail: "Nouvelles annonces pour le prochain cycle" });
    const prep = await runAutoPrepareBatch({ marketplace, limit: prepareLimit, send });
    out.prepared = prep.prepared || 0;
    out.skipped += prep.skipped || 0;
    out.errors += prep.errors || 0;

    send({
      type: "log",
      message: `[DONE] publiés ${out.published} · préparés ${out.prepared} · ignorés ${out.skipped} · erreurs ${out.errors}`,
    });
    send({ type: "done", ...out });
    return out;
  } catch (err) {
    send({ type: "log", message: `[ERROR] ${err.message}` });
    send({ type: "done", ...out, errors: (out.errors || 0) + 1 });
    return out;
  } finally {
    releaseAutoPublishBusy();
  }
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
const ebayAccountCols = db.prepare("PRAGMA table_info(ebay_accounts)").all().map((c) => c.name);
if (!ebayAccountCols.includes("owner_user_id")) {
  db.exec("ALTER TABLE ebay_accounts ADD COLUMN owner_user_id INTEGER");
}
if (!ebayAccountCols.includes("fulfillment_policy_id")) {
  db.exec("ALTER TABLE ebay_accounts ADD COLUMN fulfillment_policy_id TEXT DEFAULT ''");
}
if (!ebayAccountCols.includes("payment_policy_id")) {
  db.exec("ALTER TABLE ebay_accounts ADD COLUMN payment_policy_id TEXT DEFAULT ''");
}
if (!ebayAccountCols.includes("return_policy_id")) {
  db.exec("ALTER TABLE ebay_accounts ADD COLUMN return_policy_id TEXT DEFAULT ''");
}

const webAuth = createWebAuth(db);
/* Inscription / connexion DÉSACTIVÉES pour le moment (ignorer EBX_MULTIUSER).
   Pour réactiver plus tard : remettre la lecture de process.env.EBX_MULTIUSER. */
const MULTIUSER = false;
const OAUTH_STATE_SECRET =
  String(process.env.EBX_SESSION_SECRET || process.env.EBX_BASIC_AUTH_PASS || "ebx-oauth-secret").trim();

const listEbayAccounts = db.prepare(
  "SELECT id, label, user_id, env, marketplace, is_active, owner_user_id, created_at FROM ebay_accounts ORDER BY is_active DESC, id DESC"
);
const listEbayAccountsForOwner = db.prepare(
  "SELECT id, label, user_id, env, marketplace, is_active, owner_user_id, created_at FROM ebay_accounts WHERE owner_user_id = ? ORDER BY is_active DESC, id DESC"
);
const insertEbayAccount = db.prepare(
  `INSERT INTO ebay_accounts (label, user_id, refresh_token, env, marketplace, is_active, owner_user_id)
   VALUES (?, ?, ?, ?, ?, 0, ?)`
);
const clearActiveAccounts = db.prepare("UPDATE ebay_accounts SET is_active = 0");
const clearActiveAccountsForOwner = db.prepare(
  "UPDATE ebay_accounts SET is_active = 0 WHERE owner_user_id = ?"
);
const activateEbayAccount = db.prepare("UPDATE ebay_accounts SET is_active = 1 WHERE id = ?");
const getEbayAccountById = db.prepare("SELECT * FROM ebay_accounts WHERE id = ?");
const deleteEbayAccount = db.prepare("DELETE FROM ebay_accounts WHERE id = ?");
const getActiveEbayAccount = db.prepare(
  "SELECT * FROM ebay_accounts WHERE is_active = 1 ORDER BY id DESC LIMIT 1"
);
const getActiveEbayAccountForOwner = db.prepare(
  "SELECT * FROM ebay_accounts WHERE is_active = 1 AND owner_user_id = ? ORDER BY id DESC LIMIT 1"
);
const findEbayAccountByOwnerAndSeller = db.prepare(
  "SELECT * FROM ebay_accounts WHERE owner_user_id = ? AND user_id = ? LIMIT 1"
);
const updateEbayAccountRefresh = db.prepare(
  `UPDATE ebay_accounts
   SET refresh_token = ?, env = ?, marketplace = ?, label = ?, is_active = 1
   WHERE id = ?`
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
const updateSavInboxFields = db.prepare(
  `UPDATE sav_messages
   SET item_id = ?, item_title = ?, sender = ?, subject = ?, body = ?,
       received_at = CASE WHEN ? != '' THEN ? ELSE received_at END,
       updated_at = CURRENT_TIMESTAMP
   WHERE message_id = ?`
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
  // Cdiscount pages catégorie / recherche (r-motclé.html) ≠ fiche produit
  if (/cdiscount\.com\/[^?]*(?:\/r-|\/f-\d+-nav)/i.test(u)) return false;
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

/** Auth HTTP basique — désactivée par défaut. Pour réactiver : EBX_BASIC_AUTH_ENABLED=1 + USER/PASS. */
function basicAuthMiddleware(req, res, next) {
  const enabled = String(process.env.EBX_BASIC_AUTH_ENABLED || "").trim() === "1";
  const user = String(process.env.EBX_BASIC_AUTH_USER || "").trim();
  const pass = String(process.env.EBX_BASIC_AUTH_PASS || "").trim();
  if (!enabled || !user || !pass) return next();

  const header = req.headers.authorization || "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      const u = idx >= 0 ? decoded.slice(0, idx) : decoded;
      const p = idx >= 0 ? decoded.slice(idx + 1) : "";
      if (u === user && p === pass) return next();
    } catch (_) {
      /* fallthrough */
    }
  }
  res.set("WWW-Authenticate", 'Basic realm="EBX", charset="UTF-8"');
  return res.status(401).send("Authentification requise");
}
app.use(basicAuthMiddleware);

/** Session web + contexte vendeur eBay de l'utilisateur (multi-tenant). */
app.use((req, res, next) => {
  req.webUser = webAuth.userFromRequest(req);
  let account = null;
  if (req.webUser) {
    account = getActiveEbayAccountForOwner.get(req.webUser.id) || null;
  } else if (!MULTIUSER) {
    account = getActiveEbayAccount.get() || null;
  }
  req.ebayAccount = account;
  runWithSeller(account, () => next());
});

function requireWebUser(req, res, next) {
  // Auth web désactivée — accès libre aux APIs
  return next();
}
app.use(requireWebUser);

// Images produit cachées localement (publish EPS sans dépendre d'Ali/Amazon)
const { ensureCacheDir, localizeHtmlImages, CACHE_DIR } = require("./image-cache");
ensureCacheDir();
app.use("/media", express.static(CACHE_DIR, { maxAge: "7d", fallthrough: true }));

app.use(express.static(path.join(__dirname)));

/**
 * Télécharge les images distantes du listing vers /media et réécrit le HTML.
 * À appeler avant publish (et idéalement à l'import).
 */
async function localizeListingImages(listing) {
  if (!listing?.id) return listing;
  const html = String(listing.html_description || "");
  if (!html || !/<img\b/i.test(html)) return listing;

  const { isTinyOrPlaceholderImageUrl } = require("./image-cache");
  const imgSrcs = [];
  const reSrc = /<img[^>]+src=["']([^"']+)["']/gi;
  let mm;
  while ((mm = reSrc.exec(html))) imgSrcs.push(mm[1]);
  const hasTinyEbay = imgSrcs.some((s) => isTinyOrPlaceholderImageUrl(s));
  const remoteNonEbay = imgSrcs.filter(
    (s) => /^https?:\/\//i.test(s) && !/ebayimg\.com|ebaystatic\.com/i.test(s)
  );

  // Déjà 100% local et sans miniatures → skip
  if (!remoteNonEbay.length && !hasTinyEbay && imgSrcs.every((s) => /^\/media\//i.test(s))) {
    return listing;
  }
  // Rien à faire si seulement de « bonnes » ebayimg déjà OK et pas de remote — quand même
  // revalider si hasTinyEbay ; sinon si tout est ebayimg non-tiny on laisse (publish re-uploade EPS)
  if (!remoteNonEbay.length && !hasTinyEbay && imgSrcs.every((s) => /ebayimg\.com|ebaystatic\.com|\/media\//i.test(s))) {
    // Force quand même un passage cache pour media-iser (stabilité) si ebayimg présent
    if (!imgSrcs.some((s) => /ebayimg\.com|ebaystatic\.com/i.test(s))) return listing;
  }

  console.log(`[EBX] Cache images listing #${listing.id}…`);
  const result = await localizeHtmlImages(html);
  if ((result.cached > 0 || result.failed > 0) && result.html !== html) {
    updateListingHtml.run(result.html, listing.id);
    console.log(
      `[EBX] Listing #${listing.id}: ${result.cached} image(s) en cache local` +
        (result.failed ? `, ${result.failed} retirée(s)/échec(s)` : "")
    );
    return { ...listing, html_description: result.html };
  }
  if (result.failed && !result.cached) {
    console.warn(`[EBX] Listing #${listing.id}: impossible de cacher les images (${result.failed} échec(s))`);
  }
  return listing;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

app.get("/api/health", (_req, res) => {
  const meta = clientMeta();
  res.json({
    status: "ok",
    product: PRODUCT_NAME,
    llm_url: process.env.LOCAL_LLM_URL || "http://localhost:1234/v1",
    mode: "live+fallback",
    description_builder: "desc-v2",
    client: meta,
  });
});

function liveOnboardingSignals() {
  const listings = getRecentListings.all();
  const sav = listSavMessages.all();
  return {
    ebayOauth: Boolean(getActiveEbayAccount.get()),
    policies:
      Boolean(process.env.EBAY_FULFILLMENT_POLICY_ID_PROD || process.env.EBAY_FULFILLMENT_POLICY_ID) &&
      Boolean(process.env.EBAY_PAYMENT_POLICY_ID_PROD || process.env.EBAY_PAYMENT_POLICY_ID) &&
      Boolean(process.env.EBAY_RETURN_POLICY_ID_PROD || process.env.EBAY_RETURN_POLICY_ID),
    publishedCount: listings.filter((l) => String(l.ebay_listing_id || "").trim()).length,
    savCount: sav.length,
  };
}

app.get("/api/ops/meta", (_req, res) => {
  const ops = loadOpsState(opsStatePath());
  const live = liveOnboardingSignals();
  const onboarding = mergeOnboarding(ops.onboarding, live);
  res.json({
    success: true,
    data: {
      ...clientMeta(),
      onboarding,
      nextStep: nextOnboardingStep(onboarding),
      autoPublishArmed: isAutoPublishArmed({ onboarding }),
      paymentNeverAutonomous: true,
    },
  });
});

app.get("/api/ops/onboarding", (_req, res) => {
  const ops = loadOpsState(opsStatePath());
  const onboarding = mergeOnboarding(ops.onboarding, liveOnboardingSignals());
  res.json({ success: true, data: { ...ops, onboarding, nextStep: nextOnboardingStep(onboarding) } });
});

app.post("/api/ops/onboarding", (req, res) => {
  try {
    const prev = loadOpsState(opsStatePath());
    const patch = req.body || {};
    const onboarding = { ...prev.onboarding };
    const src = patch.onboarding && typeof patch.onboarding === "object" ? patch.onboarding : patch;
    for (const key of Object.keys(onboarding)) {
      if (typeof src[key] === "boolean") onboarding[key] = src[key];
    }
    const next = saveOpsState(opsStatePath(), {
      ...prev,
      onboarding,
      feeEur: patch.feeEur != null ? Number(patch.feeEur) : prev.feeEur,
      notes: patch.notes != null ? String(patch.notes) : prev.notes,
    });
    res.json({ success: true, data: next });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get("/api/ops/pnl", (_req, res) => {
  try {
    const pnl = computePnl({ listings: getRecentListings.all(), orders: getOrders.all() });
    res.json({ success: true, data: pnl });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/ops/weekly-report", (_req, res) => {
  try {
    const meta = clientMeta();
    const ops = loadOpsState(opsStatePath());
    const live = liveOnboardingSignals();
    const report = buildWeeklyReport({
      client: {
        id: meta.clientId,
        name: meta.clientName || meta.clientId || "Solo",
        marketplace: process.env.EBAY_MARKETPLACE_ID || "EBAY_FR",
        feeEur: ops.feeEur,
      },
      listings: getRecentListings.all(),
      orders: getOrders.all(),
      sav: listSavMessages.all(),
      publishLog: listAutoPublishLog.all(),
      opsState: ops,
      live,
    });
    if (String(_req.query.format || "") === "html") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(reportToHtml(report));
    }
    res.json({ success: true, data: report });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function envPresent(v) {
  return Boolean(v && String(v).trim() && !String(v).includes("your_"));
}

app.get("/api/setup", async (_req, res) => {
  const { isProduction, getSellerIdentity, diagnosePublishReadiness, getAccessToken } = require("./ebay-api");
  const setup = {
    prodKeys: envPresent(process.env.EBAY_PROD_CLIENT_ID) && envPresent(process.env.EBAY_PROD_CLIENT_SECRET),
    sandboxKeys: envPresent(process.env.EBAY_CLIENT_ID) && envPresent(process.env.EBAY_CLIENT_SECRET),
    refreshToken: envPresent(process.env.EBAY_REFRESH_TOKEN),
    refreshTokenProd: envPresent(process.env.EBAY_REFRESH_TOKEN_PROD),
    userToken: envPresent(process.env.EBAY_USER_TOKEN),
    ruName: envPresent(process.env.EBAY_RU_NAME),
    ebayEnv: isProduction() ? "production" : "sandbox",
    marketplace: process.env.EBAY_MARKETPLACE_ID || "EBAY_US",
    policies:
      envPresent(process.env.EBAY_FULFILLMENT_POLICY_ID) &&
      envPresent(process.env.EBAY_PAYMENT_POLICY_ID) &&
      envPresent(process.env.EBAY_RETURN_POLICY_ID),
    policiesProd:
      envPresent(process.env.EBAY_FULFILLMENT_POLICY_ID_PROD) &&
      envPresent(process.env.EBAY_PAYMENT_POLICY_ID_PROD) &&
      envPresent(process.env.EBAY_RETURN_POLICY_ID_PROD),
    llmUrl: process.env.LOCAL_LLM_URL || "http://localhost:1234/v1",
    product: PRODUCT_NAME,
    browse: { ok: false, api: null, error: null, sample: null },
    llm: { ok: false },
    seller: { ok: false, userId: null, email: null, error: null },
    publishReady: null,
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
    const token = await getAccessToken();
    setup.publishReady = await diagnosePublishReadiness(token, { price: 29.99 });
  } catch (err) {
    setup.publishReady = { ok: false, issues: [err.message], warnings: [] };
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

app.get("/api/ebay/preflight", async (_req, res) => {
  try {
    const { getAccessToken, diagnosePublishReadiness, getSellerIdentity, isProduction } = require("./ebay-api");
    const token = await getAccessToken();
    const diagnosis = await diagnosePublishReadiness(token, { price: 29.99 });
    let seller = null;
    try {
      seller = await getSellerIdentity();
    } catch (_) {}
    res.json({
      success: true,
      data: {
        env: isProduction() ? "production" : "sandbox",
        seller,
        ...diagnosis,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
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
      // Ne bloque pas le dashboard si GetUser est lent
      seller = await Promise.race([
        getSellerIdentity(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("seller-timeout")), 2500)),
      ]);
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

    // Tendances : cache d'abord, live rapide (max ~3.5s), jamais bloquer le reste du dashboard
    let trending = [];
    let rankingsLive = false;
    let trendingMeta = { period: "day", seeds: [], algo: null, cached: false, marketplace: "FR" };
    const dashMarketRaw = String(_req.query?.marketplace || "FR");
    try {
      const {
        fetchTrendingProducts,
        peekTrendingCache,
        scheduleTrendingRefresh,
        seedsForPeriod,
        normalizeMarketCode,
      } = require("./trending-engine");
      const marketplace = normalizeMarketCode(dashMarketRaw);
      const dashPeriod = String(_req.query?.trendPeriod || "day").toLowerCase();
      const period = ["day", "week", "month"].includes(dashPeriod) ? dashPeriod : "day";
      const force = String(_req.query?.refresh || "") === "1";

      let trend = peekTrendingCache({ marketplace, period, limit: 10 });
      if (!trend || force) {
        try {
          trend = await fetchTrendingProducts({
            marketplace,
            period,
            force,
            limit: 10,
            fast: true,
            maxMs: force ? 8000 : 3500,
            preferCache: !force,
          });
        } catch (err) {
          console.warn("[EBX] dashboard trending live:", err.message);
          trend = peekTrendingCache({ marketplace, period, limit: 10 }) || trend;
        }
      } else {
        // Cache hit → enrichissement complet en fond
        scheduleTrendingRefresh({ marketplace, period, limit: 12 });
      }

      if (trend?.items?.length) {
        trending = trend.items.map((it) =>
          withProductImage({
            title: it.title,
            price: it.price || 0,
            sold: Number(it.sold) > 0 ? Number(it.sold) : 0,
            soldEstimated: !!it.soldEstimated,
            url: it.url,
            image: it.image || null,
            category: it.category,
            ca: it.ca,
            period: it.period || period,
            currency: it.currency || null,
          })
        );
        rankingsLive = !!trend.live && trending.length > 0;
        trendingMeta = {
          period,
          marketplace,
          seeds: trend.seeds?.length ? trend.seeds : seedsForPeriod(period, new Date(), marketplace),
          algo: trend.algo || null,
          cached: !!trend.cached,
          stale: !!trend.stale,
          source: trend.source || null,
          updatedAt: trend.updatedAt || null,
        };
      } else {
        trendingMeta.period = period;
        trendingMeta.marketplace = marketplace;
        trendingMeta.seeds = seedsForPeriod(period, new Date(), marketplace);
      }
    } catch (err) {
      console.warn("[EBX] dashboard trending:", err.message);
    }
    const dashMarket =
      trendingMeta.marketplace ||
      String(dashMarketRaw || "FR")
        .toUpperCase()
        .replace(/^EBAY_/, "");
    if (!trending.length) {
      trending = getRankings(dashMarket).slice(0, 8).map((p) =>
        withProductImage({
          title: p.title,
          price: p.price,
          sold: p.sold,
          url: null,
          image: p.image || null,
          category: p.category,
        })
      );
      rankingsLive = false;
    }
    trending = enrichItemsImages(trending);
    const calendar = getEventCalendar();
    const niches = getTrendingNiches(trending).map((n) => {
      const v = nicheVisual(n.name);
      return { ...n, icon: n.icon || v.icon, image: v.image, color: v.color };
    });
    const topSellers = getTopSellers(dashMarket);
    const marketPulse = getMarketPulse(trending, new Date(), dashMarket);
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
          ca:
            t.ca != null
              ? Number(t.ca)
              : Number(((Number(t.price) || 0) * (Number(t.sold) || 0)).toFixed(0)),
          soldLabel:
            Number(t.sold) > 0 ? `${t.sold}${t.soldEstimated ? " ~" : ""}` : "—",
        })),
        trendingLive: rankingsLive,
        trendingUpdatedAt: trendingMeta.updatedAt || new Date().toISOString(),
        trendingPeriod: trendingMeta.period || "day",
        trendingMarketplace: trendingMeta.marketplace || dashMarket || "FR",
        trendingCached: !!trendingMeta.cached,
        trendingStale: !!trendingMeta.stale,
        trendingSeeds: trendingMeta.seeds || [],
        trendingAlgo: trendingMeta.algo || null,
        trendingSource: trendingMeta.source || null,
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

/** Importe les ventes Fulfillment dans auto_orders. processQueue=false n’enchaîne pas Auto-Order. */
async function importRecentEbayOrders({ processQueue = false } = {}) {
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
  if (processQueue && created > 0 && (cfg.autoOrderMode || cfg.autoProcessOnSync)) {
    try {
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
  return {
    fetched: orders.length,
    created,
    updated,
    autoProcessed: autoPack?.processed || 0,
    autoOrderMode: Boolean(cfg.autoOrderMode),
    ebayEnv: env,
    sellerUserId: sellerUserId || null,
    note:
      orders.length === 0
        ? `Aucune vente trouvée sur le compte ${sellerUserId || "eBay"} (${env}) ces 90 derniers jours. Normal si tu n'as pas encore de commande acheteur.`
        : `${orders.length} commande(s) synchronisée(s) depuis ${sellerUserId || "eBay"} (${env}).`,
  };
}

app.get("/api/trending", async (req, res) => {
  try {
    const { fetchTrendingProducts, getCachedTrendingMeta, peekTrendingCache } = require("./trending-engine");
    const marketplace = req.query.marketplace || "FR";
    const period = ["day", "week", "month"].includes(String(req.query.period || ""))
      ? String(req.query.period)
      : "day";
    const force = String(req.query.refresh || req.query.force || "") === "1";
    const fast = String(req.query.fast || "") !== "0";
    let trend;
    try {
      trend = await fetchTrendingProducts({
        marketplace,
        period,
        force,
        limit: Number(req.query.limit) || 12,
        fast: force ? false : fast,
        maxMs: force ? 20000 : 6000,
        preferCache: !force,
      });
    } catch (err) {
      trend = peekTrendingCache({ marketplace, period, limit: 12 });
      if (!trend) throw err;
    }
    const data = enrichItemsImages(trend.items || []);
    return res.json({
      success: true,
      data,
      live: !!trend.live,
      cached: !!trend.cached,
      stale: !!trend.stale,
      period: trend.period,
      seeds: trend.seeds || [],
      source: trend.source,
      algo: trend.algo,
      updatedAt: trend.updatedAt,
      meta: getCachedTrendingMeta(marketplace),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/rankings", async (req, res) => {
  const marketplace = req.query.marketplace || "FR";
  const period = ["day", "week", "month"].includes(String(req.query.period || ""))
    ? String(req.query.period)
    : "week";
  const force = String(req.query.refresh || "") === "1";
  const algoFallback =
    "Niches rotatives FR → Browse eBay → ventes via fiche item (estimatedSoldQuantity). Pas de sold inventé.";
  try {
    const { fetchTrendingProducts, peekTrendingCache } = require("./trending-engine");
    let trend;
    try {
      trend = await fetchTrendingProducts({
        marketplace,
        period,
        force,
        limit: 12,
        fast: !force,
        maxMs: force ? 25000 : 8000,
        preferCache: !force,
      });
    } catch (_) {
      trend = peekTrendingCache({ marketplace, period, limit: 12 });
    }
    if (trend?.items?.length) {
      const data = enrichItemsImages(
        trend.items.map((p, i) => ({
          ...p,
          rank: i + 1,
          live: !!trend.live,
        }))
      );
      return res.json({
        success: true,
        data,
        live: !!trend.live,
        cached: !!trend.cached,
        stale: !!trend.stale,
        period,
        seeds: trend.seeds || [],
        source: trend.source || "trending-engine",
        algo: trend.algo || algoFallback,
        updatedAt: trend.updatedAt,
      });
    }
  } catch (err) {
    console.warn("[EBX] rankings trending-engine fail:", err.message);
  }
  try {
    const live = await scrapeRankings({ marketplace });
    if (live.length)
      return res.json({
        success: true,
        data: enrichItemsImages(live),
        live: true,
        period,
        source: "scrape",
        algo: algoFallback,
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
  res.json({
    success: true,
    data: mock,
    live: false,
    period,
    source: "mock",
    algo: algoFallback,
  });
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

function readSavSyncMeta() {
  try {
    const raw = getSetting.get("sav_sync_meta")?.value;
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeSavSyncMeta(meta) {
  upsertSetting.run("sav_sync_meta", JSON.stringify(meta || {}));
}

function ingestSavMessages(messages) {
  let created = 0;
  let updated = 0;
  for (const m of messages || []) {
    const mid = String(m.messageId || `${m.itemId}-${m.sender}-${m.creationDate}`).slice(0, 80);
    if (!mid) continue;
    const received = m.creationDate || "";
    const existing = getSavByMessageId.get(mid);
    const subject = m.subject || (m.source === "mymessages" ? "(message eBay)" : "(sans sujet)");
    if (existing) {
      updateSavInboxFields.run(
        m.itemId || existing.item_id || "",
        m.itemTitle || existing.item_title || "",
        m.sender || existing.sender || "",
        subject || existing.subject || "",
        m.body || existing.body || "",
        received,
        received,
        mid
      );
      updated += 1;
      continue;
    }
    insertSavMessage.run(
      mid,
      m.itemId || "",
      m.itemTitle || "",
      m.sender || "",
      subject,
      m.body || "",
      "new",
      "",
      0,
      "",
      0,
      "",
      received || new Date().toISOString()
    );
    created += 1;
  }
  return { created, updated };
}

let inboxSyncBusy = false;
async function syncSavInboxFromEbay({ includeOrders = true } = {}) {
  const { syncEbayInbox, getSellerIdentity } = require("./ebay-api");
  let seller = { ok: false, userId: null, error: null };
  try {
    const id = await getSellerIdentity();
    seller = { ok: true, userId: id.userId || null, email: id.email || "", error: null };
  } catch (e) {
    seller = { ok: false, userId: null, error: e.message };
  }
  const inbox = await syncEbayInbox();
  const ingested = ingestSavMessages(inbox.messages);
  let orders = { fetched: 0, created: 0, updated: 0, error: null };
  if (includeOrders) {
    try {
      orders = await importRecentEbayOrders({ processQueue: false });
    } catch (e) {
      orders.error = e.message;
    }
  }
  const meta = {
    at: new Date().toISOString(),
    live: Boolean(inbox.live),
    sellerOk: seller.ok,
    sellerUserId: seller.userId || null,
    memberCount: inbox.memberCount || 0,
    myMessagesCount: inbox.myMessagesCount || 0,
    fetched: inbox.count || 0,
    created: ingested.created,
    updated: ingested.updated,
    errors: inbox.errors || [],
    ordersError: orders.error || null,
    salesFetched: orders.fetched || 0,
  };
  writeSavSyncMeta(meta);
  return { ...inbox, ...ingested, seller, orders, meta };
}

function startInboxSyncScheduler() {
  const ms = Math.max(60_000, Number(process.env.EBAY_INBOX_SYNC_MS) || 5 * 60 * 1000);
  const run = () => {
    if (inboxSyncBusy) return;
    inboxSyncBusy = true;
    syncSavInboxFromEbay({ includeOrders: true })
      .then((r) => {
        console.log(
          `[sav-sync] live=${r.live} messages=${r.count} member=${r.memberCount} my=${r.myMessagesCount} ventes=${r.orders?.fetched || 0}`
        );
      })
      .catch((err) => {
        writeSavSyncMeta({
          ...readSavSyncMeta(),
          at: new Date().toISOString(),
          live: false,
          error: err.message,
        });
        console.warn("[sav-sync]", err.message);
      })
      .finally(() => {
        inboxSyncBusy = false;
      });
  };
  setTimeout(run, 12_000);
  setInterval(run, ms);
  console.log(`📬 Inbox eBay: sync toutes les ${Math.round(ms / 60000)} min (messages + ventes, sans Auto-Order)`);
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

app.get("/api/sav/status", async (_req, res) => {
  try {
    const meta = readSavSyncMeta();
    let seller = { ok: Boolean(meta.sellerOk), userId: meta.sellerUserId || null, error: meta.error || null };
    if (!meta.at) {
      try {
        const { getSellerIdentity } = require("./ebay-api");
        const id = await getSellerIdentity();
        seller = { ok: true, userId: id.userId || null, error: null };
      } catch (e) {
        seller = { ok: false, userId: null, error: e.message };
      }
    }
    const pendingSales = getOrders.all().filter((o) => isRealEbayOrderRef(o.order_ref) && o.status === "pending").length;
    const inboxCount = listSavMessages.all().filter((m) => m.status !== "sent" && m.status !== "archived").length;
    res.json({
      success: true,
      data: {
        connected: Boolean(seller.ok),
        sellerUserId: seller.userId || null,
        sellerError: seller.error || null,
        lastSyncAt: meta.at || null,
        live: meta.live !== false && Boolean(seller.ok),
        memberCount: meta.memberCount || 0,
        myMessagesCount: meta.myMessagesCount || 0,
        fetched: meta.fetched || 0,
        errors: meta.errors || [],
        ordersError: meta.ordersError || null,
        salesFetched: meta.salesFetched || 0,
        pendingSales,
        inboxCount,
        note: seller.ok
          ? "Connecté à eBay : questions acheteurs (GetMemberMessages) + My Messages + ventes Fulfillment. Les e-mails marketing / pub / mot de passe eBay n’apparaissent pas ici."
          : "Compte eBay non lu — reconnecte OAuth dans Paramètres. " + (seller.error || ""),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Compteurs messages SAV + ventes à traiter (pour badges / cloche hors pages). */
function getNotifReadMap() {
  try {
    const raw = getSetting.get("notif_read")?.value;
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function saveNotifReadMap(map) {
  upsertSetting.run("notif_read", JSON.stringify(map || {}));
}

function notifKey(type, id) {
  return `${type}:${id}`;
}

function buildNotificationsPayload() {
  const readMap = getNotifReadMap();
  const messages = listSavMessages.all();
  const openMessages = messages.filter((m) => m.status !== "sent" && m.status !== "archived");
  const ebayOrders = getOrders.all().filter((o) => isRealEbayOrderRef(o.order_ref));
  const pendingSales = ebayOrders.filter((o) => o.status === "pending");

  // Purge des clés lues obsolètes (messages partis / commandes plus pending)
  const liveKeys = new Set([
    ...openMessages.map((m) => notifKey("message", m.id)),
    ...pendingSales.map((o) => notifKey("sale", o.order_ref)),
  ]);
  let pruned = false;
  for (const k of Object.keys(readMap)) {
    if (!liveKeys.has(k)) {
      delete readMap[k];
      pruned = true;
    }
  }
  if (pruned) saveNotifReadMap(readMap);

  const unreadMessages = openMessages.filter((m) => !readMap[notifKey("message", m.id)]);
  const unreadSales = pendingSales.filter((o) => !readMap[notifKey("sale", o.order_ref)]);

  const items = [];
  for (const m of unreadMessages.slice(0, 8)) {
    items.push({
      type: "message",
      id: m.id,
      key: notifKey("message", m.id),
      title: m.subject || "(sans sujet)",
      detail: `${m.sender || "Acheteur"}${m.item_title ? " · " + m.item_title : ""}`,
      status: m.status || "new",
      page: "sav",
      at: m.received_at || m.updated_at || m.created_at || "",
      unread: true,
    });
  }
  for (const o of unreadSales.slice(0, 8)) {
    items.push({
      type: "sale",
      id: o.order_ref,
      key: notifKey("sale", o.order_ref),
      title: o.product || "Vente eBay",
      detail: `${Number(o.amount || 0).toFixed(2)} € · ${o.order_ref}`,
      status: o.status,
      page: "settings",
      at: o.created_at || "",
      unread: true,
    });
  }
  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  const messagesCount = unreadMessages.length;
  const salesCount = unreadSales.length;
  return {
    messages: {
      open: openMessages.length,
      unread: messagesCount,
      new: unreadMessages.filter((m) => m.status === "new" || !m.status).length,
      escalated: unreadMessages.filter((m) => m.status === "escalated" || m.escalate).length,
      draft: unreadMessages.filter((m) => m.status === "draft").length,
    },
    sales: {
      pending: pendingSales.length,
      unread: salesCount,
    },
    total: messagesCount + salesCount,
    items: items.slice(0, 12),
    updatedAt: new Date().toISOString(),
  };
}

function markNotificationsRead({ keys = [], types = [], all = false } = {}) {
  const readMap = getNotifReadMap();
  const now = new Date().toISOString();
  const messages = listSavMessages.all().filter((m) => m.status !== "sent" && m.status !== "archived");
  const pendingSales = getOrders
    .all()
    .filter((o) => isRealEbayOrderRef(o.order_ref) && o.status === "pending");

  const mark = (key) => {
    if (key) readMap[key] = now;
  };

  if (all) {
    for (const m of messages) mark(notifKey("message", m.id));
    for (const o of pendingSales) mark(notifKey("sale", o.order_ref));
  } else {
    const typeSet = new Set((types || []).map(String));
    if (typeSet.has("message") || typeSet.has("messages") || typeSet.has("sav")) {
      for (const m of messages) mark(notifKey("message", m.id));
    }
    if (typeSet.has("sale") || typeSet.has("sales") || typeSet.has("auto-order") || typeSet.has("orders")) {
      for (const o of pendingSales) mark(notifKey("sale", o.order_ref));
    }
    for (const k of keys || []) {
      const key = String(k || "").trim();
      if (key) mark(key);
    }
  }

  saveNotifReadMap(readMap);
  return buildNotificationsPayload();
}

app.get("/api/notifications", (_req, res) => {
  try {
    res.json({ success: true, data: buildNotificationsPayload() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Assistant d'aide (FAQ locale + LLM optionnel). */
const HELP_FAQ = [
  {
    keys: ["sniper", "auto-snipe", "snipe", "import"],
    reply:
      "Product Sniper cherche un signal eBay puis un produit Amazon / Ali / Cdiscount. Les liens trouvés s’affichent sous « Meilleure offre par site ». L’import va dans Mes Listings. Auto-Publish publie ensuite après comparaison des prix eBay (rentabilité ≥ 5 %, quantité 5000).",
  },
  {
    keys: ["prix", "skip", "manquant", "n/a"],
    reply:
      "Si le prix fournisseur n’est pas lu (captcha Amazon, Playwright manquant), EBX estime un coût et affiche quand même le lien produit. Sur Windows : installe Chrome + `npx playwright install`, ou utilise Import Manuel avec l’URL produit.",
  },
  {
    keys: ["auto-publish", "autopublish", "publication auto", "auto publish"],
    reply:
      "Auto-Publish (sous Product Sniper) enchaîne tout seul : tendances eBay du marché → fournisseur le plus rentable (Sniper) → fiche claire → prix concurrentiel avec net ≥ 5 % → publication toutes les 10 min (qty 5000). Auto-Order OFF ne bloque pas. Coche le toggle Automatisation ; le serveur (PM2) doit rester allumé.",
  },
  {
    keys: ["listing", "publier", "publication", "mes listings"],
    reply:
      "Dans Mes Listings : Modifier → vérifier titre/prix/images → Publier eBay. Le bouton Rafraîchir recharge la liste sans attendre le diagnostic OAuth.",
  },
  {
    keys: ["notification", "sav", "message", "mail", "email"],
    reply:
      "Notifications = inbox eBay API (questions acheteurs + My Messages) et ventes à traiter — pas ta boîte mail. Les e-mails marketing / pub / mot de passe eBay n’y apparaissent jamais. Sync auto toutes les 5 min si le compte OAuth est lié.",
  },
  {
    keys: ["ebay", "oauth", "connecter", "compte"],
    reply:
      "Paramètres → Connecter mon eBay (OAuth navigateur). Les comptes liés apparaissent en dessous — active celui qui publie.",
  },
  {
    keys: ["auto-order", "commande", "fournisseur", "vente"],
    reply:
      "Auto-Order (Paramètres) commande chez le fournisseur après une vente. Il n’a aucun effet sur Auto-Publish. Tu peux publier toutes les 10 min avec Auto-Order OFF — il faut juste cocher le toggle Automatisation Auto-Publish.",
  },
  {
    keys: ["langue", "allemand", "anglais", "manuel"],
    reply:
      "Import Manuel → choisis la langue (FR / EN / DE) avant d’importer. Titre et description sont adaptés à la langue.",
  },
];

function answerHelpFaq(message) {
  const q = String(message || "").toLowerCase();
  if (!q.trim()) {
    return "Pose une question sur EBX : sniper, listings, notifications, eBay, Auto-Order…";
  }
  let best = null;
  let score = 0;
  for (const item of HELP_FAQ) {
    const hits = item.keys.filter((k) => q.includes(k)).length;
    if (hits > score) {
      score = hits;
      best = item.reply;
    }
  }
  if (best) return best;
  return "Je peux t’aider sur : Product Sniper, Mes Listings, Notifications, connexion eBay, Auto-Order (Paramètres), Import Manuel. Reformule avec l’un de ces sujets.";
}

app.post("/api/help-chat", async (req, res) => {
  try {
    const message = String(req.body?.message || "").slice(0, 500);
    let reply = answerHelpFaq(message);
    let source = "faq";
    try {
      const { generateHelpReply } = require("./ai-brain");
      if (typeof generateHelpReply === "function") {
        const llm = await Promise.race([
          generateHelpReply(message),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 2500)),
        ]);
        if (llm?.reply) {
          reply = String(llm.reply).slice(0, 800);
          source = "llm";
        }
      }
    } catch (_) {
      /* FAQ suffit */
    }
    res.json({ success: true, reply, source });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, reply: answerHelpFaq("") });
  }
});

/** Marque des notifications comme lues → le badge disparaît. */
app.post("/api/notifications/read", (req, res) => {
  try {
    const { keys, types, all, type } = req.body || {};
    const typeList = Array.isArray(types) ? types : type ? [type] : [];
    const data = markNotificationsRead({
      keys: Array.isArray(keys) ? keys : keys ? [keys] : [],
      types: typeList,
      all: Boolean(all),
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/sav/sync", async (_req, res) => {
  try {
    if (inboxSyncBusy) {
      const meta = readSavSyncMeta();
      return res.json({
        success: true,
        fetched: meta.fetched || 0,
        created: 0,
        updated: 0,
        live: Boolean(meta.live),
        busy: true,
        apiError: null,
        note: "Sync déjà en cours — réessaie dans quelques secondes.",
        meta,
      });
    }
    inboxSyncBusy = true;
    try {
      const result = await syncSavInboxFromEbay({ includeOrders: true });
      const errNote = (result.errors || []).length ? ` (${result.errors.join(" · ")})` : "";
      res.json({
        success: true,
        fetched: result.count || 0,
        created: result.created || 0,
        updated: result.updated || 0,
        live: Boolean(result.live),
        memberCount: result.memberCount || 0,
        myMessagesCount: result.myMessagesCount || 0,
        salesFetched: result.orders?.fetched || 0,
        sellerUserId: result.seller?.userId || null,
        connected: Boolean(result.seller?.ok),
        apiError: result.seller?.ok ? null : result.seller?.error || null,
        errors: result.errors || [],
        note: result.live
          ? `Inbox eBay : ${result.memberCount || 0} question(s) acheteur, ${result.myMessagesCount || 0} My Messages, ${result.orders?.fetched || 0} vente(s).${errNote}`
          : "API messages indisponible (OAuth / compte). " + (result.errors || []).join(" · "),
      });
    } finally {
      inboxSyncBusy = false;
    }
  } catch (err) {
    inboxSyncBusy = false;
    writeSavSyncMeta({
      ...readSavSyncMeta(),
      at: new Date().toISOString(),
      live: false,
      error: err.message,
    });
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
        parentMessageId: String(row.message_id || "").replace(/^(member|mm):/, ""),
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
    marketplace = "France",
    source = "auto",
    query = "gadgets",
  } = req.body || {};
  // Mode REEL — propose 3 offres (pas de publish eBay auto)
  const testMode = false;
  const ticket = "all";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const progress = (pct, label, detail = "") =>
    send({ type: "progress", pct, label, detail: String(detail || "").slice(0, 160) });
  const max = Math.min(Math.max(Number(count) || 1, 1), 100);
    const marketCode = marketplaceToCode(marketplace);
  let scanned = 0;
  let imported = 0;
  let listed = 0;
  let errors = 0;
  let veroBlocked = 0;
  let skipped = 0;

  try {
    progress(5, "Initialisation", "Auto-Snipe v5");
    send({
      type: "log",
      message: `[INIT] Auto-Snipe v5 — 1 meilleure offre par site, loop prix AliExpress`,
    });
    send({
      type: "log",
      message: `[CONFIG] Market=${marketplace} (${marketCode}) | Source=${source}`,
    });
    send({
      type: "log",
      message: `[RULE] eBay = signal demande uniquement — on propose 3 fiches Amazon / AliExpress / Cdiscount (jamais eBay, pas d'import auto)`,
    });
    const d0 = await antiBanDelay({ testMode, label: "init" });
    progress(12, "Protection anti-ban", `${d0.waitedMs}ms`);
    send({
      type: "log",
      message: `[PROTECT] Anti-ban humain ✓ (${d0.waitedMs}ms${d0.deferred ? ", hors horaires" : ""}) | VeRO scan ✓`,
    });
    await antiBanDelay({ testMode, label: "scan" });

    // 1) Signaux demande eBay (tendances) — mots-clés, pas le produit à importer
    progress(18, "Scan demande eBay", query);
    send({ type: "log", message: `[SCAN] Signaux demande eBay pour "${query}"...` });
    let demandHints = [];
    try {
      const r = await browseSearch(query, { marketplace: marketCode, limit: max + 4 });
      demandHints = r.items;
      scanned = Math.max(demandHints.length * 12, demandHints.length);
      progress(25, "Signaux eBay reçus", `${demandHints.length} signal(aux)`);
      send({ type: "log", message: `[SCAN] ${demandHints.length} signaux eBay (${r.api}) — on sourcera hors eBay` });
    } catch (err) {
      send({ type: "log", message: `[WARN] Browse API: ${err.message}` });
      try {
        const ebay = await scrapeEbaySearch(query, { marketplace: marketCode, limit: max + 4 });
        demandHints = ebay.items;
        scanned = demandHints.length * 8;
        progress(25, "Signaux eBay (scrape)", `${demandHints.length} signal(aux)`);
        send({ type: "log", message: `[SCAN] ${demandHints.length} signaux via scrape eBay` });
      } catch (err2) {
        send({ type: "log", message: `[WARN] eBay scrape: ${err2.message}` });
      }
    }
    send({ type: "stats", scanned, imported, listed, errors });

    const searchQ =
      String(query || "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 8)
        .join(" ") || "gadget";

    progress(32, "Ciblage mot-clé", searchQ);
    send({
      type: "log",
      message: `[TARGET] Offres fournisseurs pour "${searchQ}" (mot-clé utilisateur — pas le titre eBay)`,
    });

    const vero = scanVero(searchQ);
    if (vero.level === "block") {
      veroBlocked += 1;
      errors += 1;
      progress(100, "Bloqué VeRO", vero.message);
      send({ type: "log", message: `[VERO] BLOQUÉ — ${vero.message}` });
      send({ type: "stats", scanned, imported: 0, listed: 0, errors, offers: 0 });
      send({ type: "done", scanned, imported: 0, listed: 0, errors, offers: 0 });
      res.end();
      return;
    }
    if (!vero.ok) send({ type: "log", message: `[VERO] Attention — ${vero.message}` });
    const hazQ = scanHazardous(searchQ);
    if (hazQ.level === "block") {
      skipped += 1;
      progress(100, "Bloqué hazmat", hazQ.message);
      send({ type: "log", message: `[HAZMAT] BLOQUÉ requête — ${hazQ.message}` });
      send({ type: "done", scanned, imported: 0, listed: 0, errors, offers: 0 });
      res.end();
      return;
    }
    await antiBanDelay({ testMode, label: "target" });

    progress(40, "Comparaison sources", "Amazon · AliExpress · Cdiscount");
    send({
      type: "log",
      message:
        source === "auto"
          ? `[SOURCE] Amazon + AliExpress + Cdiscount — 3 offres les moins chères, pertinentes vs "${searchQ}"…`
          : `[SOURCE] Recherche fournisseur (${source})…`,
    });

    const sourcesWanted =
      source === "auto"
        ? ["amazon", "aliexpress", "cdiscount"]
        : source === "amazon"
          ? ["amazon"]
          : source === "aliexpress"
            ? ["aliexpress"]
            : source === "cdiscount"
              ? ["cdiscount"]
              : ["amazon", "aliexpress", "cdiscount"];

    let progressFloor = 40;
    const sourceLog = (m) => {
      send({ type: "log", message: m });
      const msg = String(m || "");
      if (/\[amazon\]/i.test(msg)) {
        progressFloor = Math.max(progressFloor, 52);
        progress(progressFloor, "Recherche Amazon", msg.replace(/^\[[^\]]+\]\s*/, "").slice(0, 120));
      } else if (/\[aliexpress\]/i.test(msg)) {
        progressFloor = Math.max(progressFloor, 62);
        progress(progressFloor, "Recherche AliExpress", msg.replace(/^\[[^\]]+\]\s*/, "").slice(0, 120));
      } else if (/\[cdiscount\]/i.test(msg)) {
        progressFloor = Math.max(progressFloor, 72);
        progress(progressFloor, "Recherche Cdiscount", msg.replace(/^\[[^\]]+\]\s*/, "").slice(0, 120));
      } else if (/\[SOURCE\]/i.test(msg)) {
        progressFloor = Math.max(progressFloor, 78);
        progress(progressFloor, "Tri des candidats", msg.replace(/^\[[^\]]+\]\s*/, "").slice(0, 120));
      }
    };

    let offers = [];
    try {
      const cmp = await findCheapestSupplier(searchQ, {
        sources: sourcesWanted,
        limit: 8,
        onLog: sourceLog,
        priceMin: 0,
        priceMax: 400,
      });
      progress(85, "Meilleure offre par site", `${cmp.compared || 0} prix comparé(s)`);
      const mapped = (cmp.candidates || [])
        .filter((p) => p?.url && isSupplierProductUrl(p.url) && titleMatchesQuery(p.title, searchQ) && p.price > 0 && p.price <= 400)
        .map((p) => ({
          title: p.title || searchQ,
          url: p.url,
          source: String(p.source || "fournisseur").replace(/\+.*/, "") || "fournisseur",
          price: p.price,
          image: p.image || null,
        }));
      // Garde 1 fiche par marketplace (ne pas écraser Ali par un 2e Amazon)
      const bySrc = new Map();
      for (const o of mapped) {
        const k = String(o.source || "").toLowerCase();
        if (!bySrc.has(k) || o.price < bySrc.get(k).price) bySrc.set(k, o);
      }
      offers = [...bySrc.values()].sort((a, b) => a.price - b.price);
      if (offers.length < 3) {
        for (const o of mapped) {
          if (offers.length >= 3) break;
          if (offers.some((x) => x.url === o.url)) continue;
          offers.push(o);
        }
        offers.sort((a, b) => a.price - b.price);
      }
      scanned = Math.max(scanned, Number(cmp.compared) || 0, offers.length);
    } catch (e) {
      send({ type: "log", message: `[WARN] Comparaison sources: ${e.message}` });
    }

    if (!offers.length && (source === "auto" || source === "aliexpress")) {
      progress(88, "Relance AliExpress", "Aucun candidat — nouvel essai");
      send({ type: "log", message: `[SOURCE] Relance AliExpress seule…` });
      try {
        const aliOnly = await scrapeAliExpressSearch(searchQ, { limit: 6, onLog: sourceLog });
        offers = (aliOnly || [])
          .filter((p) => p?.url && isSupplierProductUrl(p.url) && titleMatchesQuery(p.title, searchQ) && p.price > 0 && p.price <= 400)
          .sort((a, b) => a.price - b.price)
          .slice(0, 3)
          .map((p) => ({
            title: p.title || searchQ,
            url: p.url,
            source: "aliexpress",
            price: p.price,
            image: p.image || null,
          }));
      } catch (e) {
        send({ type: "log", message: `[WARN] Relance Ali: ${e.message}` });
      }
    }

    progress(88, "Prix", "Loop confirmation AliExpress");
    send({ type: "log", message: `[PRICE] Loop confirmation des prix AliExpress (rejette 1,00 € leurre)` });
    const confirmed = [];
    for (const o of offers) {
      if (!/aliexpress/i.test(String(o.source || ""))) {
        confirmed.push(o);
        continue;
      }
      try {
        const looped = await confirmAliPriceLoop(o.url, o.title, { attempts: 3, onLog: sourceLog });
        if (looped.price >= 1.99) {
          confirmed.push({
            ...o,
            price: looped.price,
            title: looped.title && looped.title.length > 8 ? looped.title : o.title,
          });
          send({
            type: "log",
            message: `[PRICE] ${looped.price.toFixed(2)}€ confirmé — ${String(o.title).slice(0, 42)}`,
          });
        } else {
          send({
            type: "log",
            message: `[PRICE] écarté (prix non fiable) — ${String(o.title).slice(0, 42)}`,
          });
        }
      } catch (e) {
        send({ type: "log", message: `[PRICE] loop fail: ${e.message}` });
      }
    }
    offers = confirmed.sort((a, b) => a.price - b.price);

    imported = offers.length;
    if (!offers.length) {
      errors += 1;
      progress(100, "Aucune offre", `Rien de pertinent pour « ${searchQ} »`);
      send({
        type: "log",
        message: `[ERROR] Aucune offre pertinente pour "${searchQ}" (titre doit coller au mot-clé, prix réel Amazon/Ali/Cdiscount).`,
      });
      send({ type: "stats", scanned, imported: 0, listed: 0, errors, offers: 0 });
      send({ type: "done", scanned, imported: 0, listed: 0, errors, offers: 0 });
      res.end();
      return;
    }

    progress(94, "3 offres prêtes", offers.map((o) => `${o.source} ${Number(o.price).toFixed(2)}€`).join(" · "));
    send({ type: "candidates", items: offers });
    for (const c of offers) {
      send({
        type: "log",
        message: `[LINK] ${c.source} ${Number(c.price).toFixed(2)}€: ${String(c.title).slice(0, 48)} → ${c.url}`,
      });
    }
    send({
      type: "log",
      message: `[BEST] 3 offres proposées (pas d'import auto) — choisis celle à importer dans Mes Listings`,
    });
    send({ type: "stats", scanned, imported: offers.length, listed: 0, errors, offers: offers.length });
    send({
      type: "log",
      message: `[DONE] Auto-Snipe v5 — ${offers.length} offre(s) pour "${searchQ}", ${errors} erreur(s), VeRO=${veroBlocked}`,
    });
    progress(100, "Terminé", `${offers.length} offre(s) — clique Importer pour ajouter à Mes Listings`);
    send({ type: "done", scanned, imported: offers.length, listed: 0, errors, offers: offers.length });
  } catch (err) {
    progress(100, "Erreur", err.message);
    send({ type: "log", message: `[ERROR] ${err.message}` });
  }
  res.end();
});

app.get("/api/auto-publish/history", (_req, res) => {
  try {
    const enabled = getSetting.get("auto_publish_enabled")?.value === "1";
    const market = getSetting.get("auto_publish_market")?.value || "France";
    const state = loadPipelineState(market);
    const intervalMin = Math.round(autoPublishScheduler.intervalMs / 60000);
    res.json({
      success: true,
      data: {
        enabled,
        marketplace: market,
        quantity: 5000,
        minNetPct: 5,
        intervalMin,
        intervalMs: autoPublishScheduler.intervalMs,
        autoPublishArmed: !Boolean(String(process.env.BAYPILOT_CLIENT_DIR || "").trim()) || isAutoPublishArmed(loadOpsState(opsStatePath())),
        paymentNeverAutonomous: true,
        scheduler: {
          startedAt: autoPublishScheduler.startedAt,
          lastFiredAt: autoPublishScheduler.lastFiredAt,
          nextFireAt: autoPublishScheduler.nextFireAt,
          fireCount: autoPublishScheduler.fireCount,
          attemptCount: autoPublishScheduler.attemptCount,
          lastSkipReason: autoPublishScheduler.lastSkipReason || "",
          busy: autoPublishBusy,
        },
        pipeline: {
          day: state.day,
          lastPhase: state.lastPhase,
          lastTickAt: state.lastTickAt,
          lastQuery: state.lastQuery,
          preparedToday: state.preparedToday || 0,
          publishedToday: state.publishedToday || 0,
          skippedToday: state.skippedToday || 0,
          queued: Number(countAutoQueue.get()?.n || 0),
          keywords: (state.keywords || []).slice(0, 12),
          lastError: state.lastError || "",
        },
        published: listPublishedHistory.all(),
        log: listAutoPublishLog.all(),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/auto-publish/settings", (req, res) => {
  try {
    const wasOn = getSetting.get("auto_publish_enabled")?.value === "1";
    if (req.body?.enabled != null) {
      upsertSetting.run("auto_publish_enabled", req.body.enabled ? "1" : "0");
    }
    if (req.body?.marketplace) {
      upsertSetting.run("auto_publish_market", String(req.body.marketplace));
    }
    const enabled = getSetting.get("auto_publish_enabled")?.value === "1";
    const marketplace = getSetting.get("auto_publish_market")?.value || "France";
    const isolated = Boolean(String(process.env.BAYPILOT_CLIENT_DIR || "").trim());
    const armed = !isolated || isAutoPublishArmed(loadOpsState(opsStatePath()));
    if (enabled && !wasOn && armed) {
      setImmediate(() => {
        fireScheduledAutoPublish("enable");
      });
    }
    const intervalMin = Math.round(autoPublishScheduler.intervalMs / 60000);
    res.json({
      success: true,
      data: {
        enabled,
        marketplace,
        quantity: 5000,
        minNetPct: 5,
        intervalMin,
        intervalMs: autoPublishScheduler.intervalMs,
        kicked: Boolean(enabled && !wasOn && armed),
        armed,
        skipReason: enabled && !armed ? "not-armed" : "",
        nextFireAt: autoPublishScheduler.nextFireAt,
        fireCount: autoPublishScheduler.fireCount,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/auto-publish/run", async (req, res) => {
  const marketplace = req.body?.marketplace || getSetting.get("auto_publish_market")?.value || "France";
  const publishLimit = req.body?.limit || DEFAULT_PUBLISH_PER_TICK;
  const prepareLimit = req.body?.prepareLimit || DEFAULT_PREPARE_PER_TICK;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  try {
    upsertSetting.run("auto_publish_market", String(marketplace));
    await runAutoPublishTick({ marketplace, publishLimit, prepareLimit, send });
  } catch (err) {
    send({ type: "log", message: `[ERROR] ${err.message}` });
    send({ type: "done", published: 0, prepared: 0, skipped: 0, errors: 1 });
  }
  res.end();
});

app.post("/api/generate-listing", async (req, res) => {
  const { productName, rawKeywords, productUrl, themeColor, language: rawLang, lang } = req.body || {};
  const language = normalizeListingLang(rawLang || lang || "fr");
  const langOpts = { language, forceLanguage: language === "en" || language === "de" };

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
        const discreet = prepareDiscreetListing(scraped, { marginMult: 1.8, language });
        discreet.seo_title = stripSupplierProvenance(discreet.seo_title);
        if (discreet.product) {
          discreet.product.title = stripSupplierProvenance(discreet.product.title);
          discreet.product.description = cleanMarketingCopy(discreet.product.description || "");
          discreet.product.language = language;
        }
        listing = {
          ...discreet,
          language,
          language_label: languageLabel(language),
          html_description: sanitizeListingHtml(
            buildHtmlFromProduct(discreet.product, themeColor || "#667eea", langOpts)
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
          rewriteEbayTitle(listing.seo_title || listing.product_name || "Produit", [], langOpts)
        );
        listing.title_rewritten = true;
        listing.language = language;
        listing.language_label = languageLabel(language);
        listing.product = {
          title: listing.seo_title,
          originalTitle: listing.original_title,
          images: listing.images || [],
          bullets: [],
          description: "",
          price: listing.suggested_price,
          source: "fallback",
          url: productUrl,
          language,
        };
        listing.html_description = sanitizeListingHtml(
          buildHtmlFromProduct(listing.product, themeColor || "#667eea", langOpts)
        );
      }

      // Enrichissement LLM optionnel — ne remplace pas un bon scrape par du vide / générique
      try {
        const baseProduct = {
          ...(listing.product || scraped || {}),
          title: listing.original_title || listing.product_name || listing.seo_title,
          originalTitle: listing.original_title || scraped?.title,
          images: listing.images || scraped?.images || [],
          language,
        };
        const aiPromise = generateProductCopy(baseProduct, langOpts);
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("LLM timeout")), 14000));
        const ai = await Promise.race([aiPromise, timeout]);
        if (ai && !ai._parse_error) {
          const aiTitle = stripSupplierProvenance(
            rewriteEbayTitle(ai.seo_title || listing.seo_title || baseProduct.title, [], langOpts)
          );
          const aiPitch = cleanMarketingCopy(ai.short_pitch || "");
          const aiPitchOk = aiPitch && copyMatchesLanguage(aiPitch, language);
          const aiSections = Array.isArray(ai.sections)
            ? ai.sections.filter(
                (s) => s?.body && copyMatchesLanguage(`${s.heading || ""} ${s.body}`, language)
              )
            : [];
          const aiBenefits = Array.isArray(ai.benefits)
            ? ai.benefits.filter((b) => b && copyMatchesLanguage(String(b), language))
            : [];
          // Si le LLM a répondu dans la mauvaise langue, on laisse enrichProductListingCopy
          // reconstruire les templates EN/DE (forceLanguage).
          const product = enrichProductListingCopy(
            {
              ...baseProduct,
              title: aiTitle,
              originalTitle: listing.original_title || baseProduct.title,
              description: aiPitchOk ? aiPitch : "",
              short_pitch: aiPitchOk ? aiPitch : "",
              sections: aiSections,
              benefits: aiBenefits,
              bullets: aiBenefits.length ? aiBenefits : [],
              specs:
                ai.specs && typeof ai.specs === "object"
                  ? { ...(baseProduct.specs || {}), ...ai.specs }
                  : baseProduct.specs,
              price: baseProduct.price || scraped?.price,
              source: baseProduct.source || scraped?.source,
              language,
            },
            langOpts
          );
          listing = {
            ...listing,
            seo_title: aiTitle,
            product_name: aiTitle,
            language,
            language_label: languageLabel(language),
            html_description: sanitizeListingHtml(
              buildHtmlFromProduct(product, themeColor || "#667eea", langOpts)
            ),
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
        listing.product = enrichProductListingCopy(
          {
            ...listing.product,
            originalTitle: listing.original_title || listing.product.originalTitle || listing.product.title,
            images: listing.images || listing.product.images || [],
            language,
          },
          langOpts
        );
        listing.html_description = sanitizeListingHtml(
          buildHtmlFromProduct(listing.product, themeColor || "#667eea", langOpts)
        );
        listing.images = listing.product.images || listing.images;
        listing.language = language;
        listing.language_label = languageLabel(language);
        listing.enrichment = {
          version: "desc-v2",
          language,
          sections: (listing.product.sections || []).length,
          benefits: (listing.product.benefits || []).length,
          specs: Object.keys(listing.product.specs || {}).length,
          images: (listing.images || []).length,
          source: listing.source,
        };
      }
    } else {
      if (!productName) return res.status(400).json({ error: "productName ou productUrl requis" });
      listing = await generateListing(productName, rawKeywords || "", langOpts);
      listing.seo_title = stripSupplierProvenance(listing.seo_title || productName);
      listing.html_description = sanitizeListingHtml(listing.html_description || "");
      listing.language = language;
      listing.language_label = languageLabel(language);
    }

    listing.seo_title = stripSupplierProvenance(listing.seo_title || "");
    listing.product_name = stripSupplierProvenance(listing.product_name || listing.seo_title);
    if (listing.product) listing.product.title = stripSupplierProvenance(listing.product.title || listing.seo_title);
    listing.language = language;
    listing.language_label = languageLabel(language);
    listing.html_description = sanitizeListingHtml(listing.html_description || "");

    const costPrice = Number(scraped?.price || listing.product?.price || 0) || 0;
    const result = await insertListingWithImageCache({
      seoTitle: listing.seo_title || "",
      html: listing.html_description || "",
      price: listing.suggested_price || 0,
      keywords: rawKeywords || "",
      sourceUrl: productUrl || "",
      costPrice,
    });

    const saved = getListingById.get(result.id);
    return res.json({
      success: true,
      data: {
        ...listing,
        ...(saved || {}),
        id: result.id,
        language,
        language_label: languageLabel(language),
        duplicate: result.duplicate || false,
      },
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
    const { product, themeColor = "#667eea", language: rawLang, lang } = req.body || {};
    if (!product) return res.status(400).json({ success: false, error: "product requis" });
    const language = normalizeListingLang(rawLang || lang || product.language || "fr");
    const langOpts = { language, forceLanguage: language === "en" || language === "de" };
    const cleanedProduct = enrichProductListingCopy(
      {
        ...product,
        title: stripSupplierProvenance(product.title),
        originalTitle: product.originalTitle || product.original_title || product.title,
        description: cleanMarketingCopy(product.description || ""),
        bullets: (product.bullets || [])
          .map((b) => cleanMarketingCopy(String(b).replace(/^\s*source\s*:\s*/i, "")))
          .filter((b) => b && !/^source\s*:/i.test(b)),
        language,
      },
      langOpts
    );
    const html = sanitizeListingHtml(buildHtmlFromProduct(cleanedProduct, themeColor, langOpts));
    res.json({
      success: true,
      data: {
        product_name: cleanedProduct.title,
        seo_title: String(cleanedProduct.title || "").slice(0, 80),
        html_description: html,
        images: cleanedProduct.images || [],
        source: cleanedProduct.source || "generic",
        product: cleanedProduct,
        language,
        language_label: languageLabel(language),
        live: true,
        enrichment: {
          version: "desc-v2",
          language,
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

app.patch("/api/listings/:id", async (req, res) => {
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
      let html = String(html_description);
      try {
        const localized = await localizeHtmlImages(html);
        if (localized.cached > 0) html = localized.html;
      } catch (e) {
        console.warn("[EBX] localize on PATCH:", e.message);
      }
      updateListingHtml.run(html, listing.id);
      listing.html_description = html;
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
 * Puis cache local /media pour le publish EPS.
 */
async function ensureListingImages(listing) {
  let current = listing;
  if (countRealImagesInHtml(current.html_description) <= 0) {
    const sourceUrl = String(current.source_url || "").trim();
    if (!sourceUrl) {
      throw new Error(
        "Aucune image produit dans le listing HTML et pas de source_url. " +
          "Régénère via Description Builder (URL Amazon/eBay) ou Auto-Snipe, puis republie."
      );
    }

    console.log(`[EBX] Listing #${current.id} sans image — re-scrape ${sourceUrl.slice(0, 70)}…`);
    const scraped = await scrapeProduct(sourceUrl);
    const images = (scraped.images || []).filter(isRealProductImage);
    if (!images.length) {
      throw new Error(
        "Impossible de récupérer des images depuis la source. " +
          "Ouvre Description Builder avec une URL produit qui a des photos, sauvegarde, puis publie."
      );
    }

    const html = injectProductImagesIntoHtml(current.html_description, images);
    if (countRealImagesInHtml(html) === 0) {
      const rebuilt = buildHtmlFromProduct(
        {
          title: current.seo_title || scraped.title,
          images,
          bullets: scraped.bullets || [],
          description: scraped.description || current.seo_title,
          price: current.suggested_price,
          source: scraped.source || "repair",
        },
        "#667eea"
      );
      updateListingHtml.run(rebuilt, current.id);
      current = { ...current, html_description: rebuilt };
    } else {
      updateListingHtml.run(html, current.id);
      console.log(`[EBX] Listing #${current.id} : ${images.length} image(s) réinjectée(s)`);
      current = { ...current, html_description: html };
    }
  }

  // Toujours tenter le cache local avant publish
  return localizeListingImages(current);
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

    // Déjà publié localement → ne pas recréer une 2e annonce (doublon eBay)
    if (listing.ebay_listing_id && !req.body?.force && !req.body?.republish) {
      const isFr = String(process.env.EBAY_MARKETPLACE_ID || "").toUpperCase() === "EBAY_FR";
      const host = isFr ? "https://www.ebay.fr" : "https://www.ebay.com";
      return res.status(409).json({
        success: false,
        code: "ALREADY_PUBLISHED",
        error:
          `Cette annonce est déjà en ligne sur eBay (#${listing.ebay_listing_id}).\n` +
          `Pour éviter un doublon : augmente la quantité sur eBay, ou termine l’ancienne puis republie avec force.\n` +
          `Lien : ${host}/itm/${listing.ebay_listing_id}`,
        data: {
          ebayListingId: listing.ebay_listing_id,
          link: `${host}/itm/${listing.ebay_listing_id}`,
        },
      });
    }

    const vero = scanVero(`${listing.seo_title} ${listing.html_description || ""}`);
    if (vero.level === "block" && !req.body?.force) {
      return res.status(400).json({
        success: false,
        error: `VeRO: ${vero.message}. Corrige le titre ou force=true si tu assumes le risque.`,
        vero,
      });
    }
    const haz = scanHazardous(`${listing.seo_title} ${listing.html_description || ""}`);
    if (haz.level === "block" && !req.body?.force) {
      return res.status(400).json({
        success: false,
        code: "HAZARDOUS_MATERIALS",
        error:
          `⛔ Substances dangereuses (pré-contrôle EBX)\n\n${haz.message}\n\n` +
          `Ce produit sera refusé par eBay (erreur 25019 / PI_HAZ). ` +
          `Choisis un autre produit — slime / butter stick / putty sont souvent interdits sur eBay.fr.`,
        hazardous: haz,
      });
    }
    listing = await ensureListingImages(listing);
    const usableImgs = countRealImagesInHtml(listing.html_description || "");
    if (usableImgs <= 0) {
      return res.status(400).json({
        success: false,
        code: "NO_USABLE_IMAGES",
        error:
          "⛔ Aucune photo utilisable pour eBay\n\n" +
          "Les images de cette annonce sont des miniatures (ex. 40×40 / $_1) ou ont été refusées.\n\n" +
          "Que faire :\n" +
          "1) Réimporte le produit depuis AliExpress / Amazon (photos produit réelles)\n" +
          "2) Dans Modifier, vérifie que les photos sont nettes et ≥ 400px\n" +
          "3) Republie\n\n" +
          "Note : une vignette ebayimg.com déjà trop petite ne peut PAS être agrandie.",
      });
    }
    const {
      isProduction,
      getSellerIdentity,
      parseDuplicateListingError,
      differentiateEbayTitle,
    } = require("./ebay-api");
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
    const variations =
      req.body?.variations && typeof req.body.variations === "object"
        ? req.body.variations
        : { enabled: false };

    let result;
    try {
      result = await publishToEbay(listing, listing.id, { variations, quantity: 5000 });
    } catch (pubErr) {
      const dup = parseDuplicateListingError(pubErr);
      if (!dup) throw pubErr;

      // 1er refus doublon : un retry avec titre différencié (Pack/Kit/…)
      if (req.body?.differentiate !== false && req.body?.linkExisting !== true) {
        const newTitle = differentiateEbayTitle(listing.seo_title);
        console.warn(`[EBX] Doublon eBay → retry titre « ${newTitle} » (était « ${listing.seo_title} »)`);
        try {
          const retryListing = { ...listing, seo_title: newTitle };
          result = await publishToEbay(retryListing, listing.id, { variations, quantity: 5000 });
          if (result?.listingId) {
            db.prepare("UPDATE listings SET seo_title = ? WHERE id = ?").run(newTitle, listing.id);
            rememberListingPublish(listing.id, result);
            return res.json({
              success: true,
              data: {
                ...result,
                sellerUserId,
                vero,
                differentiatedTitle: newTitle,
                note:
                  `eBay a refusé un doublon — publié avec le titre différencié « ${newTitle} ». ` +
                  (dup.existingListingId
                    ? `Ancienne annonce toujours active : #${dup.existingListingId}`
                    : ""),
              },
            });
          }
        } catch (retryErr) {
          const dup2 = parseDuplicateListingError(retryErr) || dup;
          console.error("[EBX] Retry différencié échoué:", retryErr.message);
          const { formatEbayPublishError } = require("./ebay-api");
          return res.status(409).json({
            success: false,
            code: "DUPLICATE_LISTING",
            error: dup2.message || formatEbayPublishError(retryErr),
            data: dup2,
          });
        }
      }

      // Option : rattacher le listing local à l’annonce eBay déjà en ligne
      if (req.body?.linkExisting && dup.existingListingId) {
        rememberListingPublish(listing.id, {
          listingId: dup.existingListingId,
          offerId: listing.ebay_offer_id || "",
          env: isProduction() ? "production" : "sandbox",
          variations: { enabled: false },
        });
        return res.json({
          success: true,
          data: {
            listingId: dup.existingListingId,
            linkedExisting: true,
            link: dup.link,
            sellerUserId,
            note: "Listing local rattaché à l’annonce eBay déjà en ligne (pas de nouveau publish).",
          },
        });
      }

      return res.status(409).json({
        success: false,
        code: "DUPLICATE_LISTING",
        error: dup.message,
        data: dup,
      });
    }

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
    const { parseDuplicateListingError, formatEbayPublishError } = require("./ebay-api");
    const dup = parseDuplicateListingError(err);
    if (dup) {
      return res.status(409).json({ success: false, code: "DUPLICATE_LISTING", error: dup.message, data: dup });
    }
    const friendly = formatEbayPublishError(err);
    return res.status(500).json({
      success: false,
      error: friendly,
      raw: String(err.message || "").slice(0, 2000),
    });
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
    const cfg = getSupplierConfig();
    const result = await importRecentEbayOrders({
      processQueue: Boolean(cfg.autoOrderMode || cfg.autoProcessOnSync),
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/accounts", (req, res) => {
  try {
    if (MULTIUSER && req.webUser) {
      return res.json({ success: true, data: listEbayAccountsForOwner.all(req.webUser.id) });
    }
    res.json({ success: true, data: listEbayAccounts.all() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/accounts", async (req, res) => {
  try {
    if (MULTIUSER && !req.webUser) {
      return res.status(401).json({ success: false, error: "Connecte-toi d'abord", authRequired: true });
    }
    const { label, refreshToken, env: accEnv = "production", marketplace = "EBAY_FR" } = req.body || {};
    const token = String(refreshToken || "").trim();
    if (token.length < 40) {
      return res.status(400).json({ success: false, error: "refreshToken trop court" });
    }
    const accountProbe = {
      id: 0,
      refresh_token: token,
      env: accEnv === "sandbox" ? "sandbox" : "production",
      marketplace: marketplace || "EBAY_FR",
    };
    let userId = "";
    try {
      userId = await runWithSeller(accountProbe, async () => {
        clearTokenCache();
        const identity = await getSellerIdentity();
        return identity.userId;
      });
    } catch (e) {
      return res.status(400).json({ success: false, error: "Token invalide: " + e.message });
    }

    const ownerId = req.webUser ? req.webUser.id : null;
    insertEbayAccount.run(
      label || userId || "Compte",
      userId,
      token,
      accountProbe.env,
      accountProbe.marketplace,
      ownerId
    );
    res.json({ success: true, data: { userId } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/accounts/:id/activate", (req, res) => {
  try {
    const row = getEbayAccountById.get(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: "Compte introuvable" });
    if (MULTIUSER && req.webUser && Number(row.owner_user_id) !== Number(req.webUser.id)) {
      return res.status(403).json({ success: false, error: "Ce compte eBay ne t'appartient pas" });
    }
    if (req.webUser) {
      clearActiveAccountsForOwner.run(req.webUser.id);
    } else {
      clearActiveAccounts.run();
    }
    activateEbayAccount.run(row.id);
    clearTokenCache();
    res.json({
      success: true,
      data: { id: row.id, userId: row.user_id, env: row.env, marketplace: row.marketplace },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete("/api/accounts/:id", (req, res) => {
  try {
    const row = getEbayAccountById.get(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: "Compte introuvable" });
    if (MULTIUSER && req.webUser && Number(row.owner_user_id) !== Number(req.webUser.id)) {
      return res.status(403).json({ success: false, error: "Ce compte eBay ne t'appartient pas" });
    }
    deleteEbayAccount.run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Auth web (inscription / login) — chaque user connecte ensuite SON eBay. */
app.get("/api/auth/me", (req, res) => {
  res.json({
    success: true,
    multiuser: MULTIUSER,
    user: req.webUser || null,
    ebay: req.ebayAccount
      ? {
          id: req.ebayAccount.id,
          userId: req.ebayAccount.user_id,
          label: req.ebayAccount.label,
          env: req.ebayAccount.env,
          marketplace: req.ebayAccount.marketplace,
        }
      : null,
  });
});

app.post("/api/auth/register", (req, res) => {
  try {
    if (!MULTIUSER) return res.status(400).json({ success: false, error: "Mode multi-user désactivé" });
    const user = webAuth.register(req.body?.email, req.body?.password);
    const token = webAuth.createSession(user.id);
    webAuth.setSessionCookie(res, token, { secure: String(req.headers["x-forwarded-proto"] || "").includes("https") });
    res.json({ success: true, data: user });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post("/api/auth/login", (req, res) => {
  try {
    if (!MULTIUSER) return res.status(400).json({ success: false, error: "Mode multi-user désactivé" });
    const user = webAuth.login(req.body?.email, req.body?.password);
    const token = webAuth.createSession(user.id);
    webAuth.setSessionCookie(res, token, { secure: String(req.headers["x-forwarded-proto"] || "").includes("https") });
    res.json({ success: true, data: user });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post("/api/auth/logout", (req, res) => {
  webAuth.logout(req, res);
  res.json({ success: true });
});

const EBAY_OAUTH_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.marketing",
].join(" ");

function ebayOAuthConfig(isProd) {
  const clientId = cleanEnvToken(
    isProd ? process.env.EBAY_PROD_CLIENT_ID || process.env.EBAY_CLIENT_ID : process.env.EBAY_CLIENT_ID
  );
  const clientSecret = cleanEnvToken(
    isProd
      ? process.env.EBAY_PROD_CLIENT_SECRET || process.env.EBAY_CLIENT_SECRET
      : process.env.EBAY_CLIENT_SECRET
  );
  const ruName = cleanEnvToken(
    isProd
      ? process.env.EBAY_RU_NAME_PROD || process.env.EBAY_RU_NAME
      : process.env.EBAY_RU_NAME || process.env.EBAY_REDIRECT_URI
  );
  const authUrl = isProd
    ? process.env.EBAY_AUTH_URL_PROD || "https://api.ebay.com/identity/v1/oauth2/token"
    : process.env.EBAY_AUTH_URL || "https://api.sandbox.ebay.com/identity/v1/oauth2/token";
  const consentBase = isProd
    ? "https://auth.ebay.com/oauth2/authorize"
    : "https://auth.sandbox.ebay.com/oauth2/authorize";
  return { clientId, clientSecret, ruName, authUrl, consentBase };
}

/** Démarre OAuth eBay navigateur pour l'utilisateur web connecté. */
app.get("/api/oauth/ebay/start", (req, res) => {
  try {
    if (MULTIUSER && !req.webUser) {
      return res.status(401).json({ success: false, error: "Connecte-toi d'abord", authRequired: true });
    }
    const isProd = String(req.query.env || "production").toLowerCase() !== "sandbox";
    const marketplace = String(req.query.marketplace || "EBAY_FR").toUpperCase();
    const cfg = ebayOAuthConfig(isProd);
    if (!cfg.clientId || !cfg.clientSecret || !cfg.ruName) {
      return res.status(400).json({
        success: false,
        error:
          "App eBay incomplète côté serveur : renseigne EBAY_PROD_CLIENT_ID/SECRET et EBAY_RU_NAME_PROD dans .env (RuName = URL de callback).",
      });
    }
    const state = signOAuthState(
      {
        uid: req.webUser ? req.webUser.id : 0,
        env: isProd ? "production" : "sandbox",
        marketplace,
        exp: Date.now() + 15 * 60 * 1000,
      },
      OAUTH_STATE_SECRET
    );
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      response_type: "code",
      redirect_uri: cfg.ruName,
      scope: EBAY_OAUTH_SCOPES,
      state,
    });
    res.json({ success: true, url: `${cfg.consentBase}?${params.toString()}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Callback OAuth eBay — à déclarer comme RuName / redirect URL dans developer.ebay.com */
app.get("/api/oauth/ebay/callback", async (req, res) => {
  const fail = (msg) => {
    res.status(400).send(`<!doctype html><html><body style="font-family:sans-serif;padding:2rem"><h1>Connexion eBay échouée</h1><p>${String(msg).replace(/[<>&]/g, "")}</p><p><a href="/">Retour EBX</a></p></body></html>`);
  };
  try {
    const code = String(req.query.code || "").trim();
    const stateRaw = String(req.query.state || "").trim();
    if (!code) return fail(req.query.error_description || req.query.error || "Code OAuth manquant");
    const state = verifyOAuthState(stateRaw, OAUTH_STATE_SECRET);
    if (!state) return fail("State OAuth invalide ou expiré — réessaie depuis Paramètres.");
    if (MULTIUSER && (!req.webUser || Number(req.webUser.id) !== Number(state.uid))) {
      return fail("Session web différente — reconnecte-toi à EBX puis relance Connecter eBay.");
    }
    const isProd = state.env !== "sandbox";
    const cfg = ebayOAuthConfig(isProd);
    const credentials = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
    const tokenRes = await fetch(cfg.authUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: cfg.ruName,
      }),
    });
    const tokenText = await tokenRes.text();
    let tokenData;
    try {
      tokenData = JSON.parse(tokenText);
    } catch (_) {
      tokenData = {};
    }
    if (!tokenRes.ok || !tokenData.refresh_token) {
      return fail(`Échange token échoué: ${tokenText.slice(0, 240)}`);
    }
    const refresh = String(tokenData.refresh_token);
    const accountProbe = {
      id: 0,
      refresh_token: refresh,
      env: isProd ? "production" : "sandbox",
      marketplace: state.marketplace || "EBAY_FR",
    };
    let sellerUserId = "";
    try {
      sellerUserId = await runWithSeller(accountProbe, async () => {
        clearTokenCache();
        const identity = await getSellerIdentity();
        return identity.userId || "";
      });
    } catch (e) {
      // Token peut être OK même si GetUser échoue selon scopes
      sellerUserId = "";
      console.warn("[EBX] OAuth identity probe:", e.message);
    }
    const ownerId = req.webUser ? req.webUser.id : state.uid || null;
    const label = sellerUserId || "Compte eBay";
    if (ownerId && sellerUserId) {
      const existing = findEbayAccountByOwnerAndSeller.get(ownerId, sellerUserId);
      if (existing) {
        if (ownerId) clearActiveAccountsForOwner.run(ownerId, ownerId);
        else clearActiveAccounts.run();
        updateEbayAccountRefresh.run(refresh, accountProbe.env, accountProbe.marketplace, label, existing.id);
      } else {
        if (ownerId) clearActiveAccountsForOwner.run(ownerId, ownerId);
        else clearActiveAccounts.run();
        const info = insertEbayAccount.run(label, sellerUserId, refresh, accountProbe.env, accountProbe.marketplace, ownerId);
        activateEbayAccount.run(info.lastInsertRowid);
      }
    } else {
      if (ownerId) clearActiveAccountsForOwner.run(ownerId, ownerId);
      else clearActiveAccounts.run();
      const info = insertEbayAccount.run(label, sellerUserId, refresh, accountProbe.env, accountProbe.marketplace, ownerId);
      activateEbayAccount.run(info.lastInsertRowid);
    }
    clearTokenCache();
    res.send(`<!doctype html><html><body style="font-family:sans-serif;padding:2rem;background:#f3f3fc">
      <h1 style="color:#242b52">eBay connecté ✔</h1>
      <p>Compte : <strong>${String(sellerUserId || "OK").replace(/[<>&]/g, "")}</strong> (${accountProbe.env})</p>
      <p>Tu peux fermer cet onglet et revenir sur BayPilot — Paramètres.</p>
      <script>setTimeout(function(){ location.href="/#settings"; }, 1200);</script>
      <p><a href="/">Ouvrir BayPilot</a></p>
    </body></html>`);
  } catch (err) {
    fail(err.message);
  }
});

app.get("/api/accounts-DISABLED-PLACEHOLDER", (_req, res) => {
  res.json({ success: true, data: listEbayAccounts.all() });
});

const server = app.listen(PORT, "0.0.0.0", () => {
  const { isProduction } = require("./ebay-api");
  const authOn =
    String(process.env.EBX_BASIC_AUTH_ENABLED || "").trim() === "1" &&
    Boolean(
      String(process.env.EBX_BASIC_AUTH_USER || "").trim() &&
        String(process.env.EBX_BASIC_AUTH_PASS || "").trim()
    );
  console.log(`${PRODUCT_NAME} Server running on http://0.0.0.0:${PORT}`);
  console.log(`📝 Description Builder: desc-v2 (infos produit enrichies)`);
  console.log(`🧠 LLM endpoint: ${process.env.LOCAL_LLM_URL || "http://localhost:1234/v1"}`);
  console.log(`🛒 Publish mode: ${isProduction() ? "PRODUCTION (réel)" : "sandbox (test)"}`);
  console.log(`🌐 Mode: live scrapers + fallbacks`);
  console.log(`🔒 Basic auth: ${authOn ? "ON" : "OFF (déconseillé en public)"}`);
  const meta = clientMeta();
  if (meta.isolated) console.log(`👤 Client isolé : ${meta.clientId} (${meta.clientDir})`);
  else console.log("👤 Mode solo (pas BAYPILOT_CLIENT_DIR) — Auto-Publish non bloqué par l'armement DFY");
  startAutoPublishScheduler();
  startInboxSyncScheduler();
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
