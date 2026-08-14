/**
 * Auto-Publish — pipeline quotidien demande → fournisseur → annonce → prix ≥ 5 % → eBay.
 * Fonctions pures testables + orchestration async (deps injectables).
 */

const { competitiveSellPrice, estimateMargin, scanVero, scanHazardous } = require("./business-engine");

const STOPWORDS = new Set(
  `le la les de des du un une et ou pour avec sans the and for with a an of to in on der die das und für mit im
   pack lot set pcs pièces piece pieces neuf new etui étui plus ultra best top vente flash
  `
    .split(/\s+/)
    .filter(Boolean)
);

const MIN_NET_PCT = 5;
const DEFAULT_PREPARE_PER_TICK = 3;
const DEFAULT_PUBLISH_PER_TICK = 3;
const QUEUE_CAP = 18;
/** Incrémente pour forcer un rescan des mots-clés du jour. */
const DEMAND_ALGO = 2;

function languageForMarket(marketplace = "FR") {
  const c = String(marketplace || "FR").toUpperCase().replace(/^EBAY_/, "");
  if (c === "DE") return "de";
  if (c === "US" || c === "GB") return "en";
  return "fr";
}

function keywordFromTitle(title = "") {
  const tokens = String(title || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9àâäéèêëïîôùûüç\s-]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  const uniq = [];
  for (const t of tokens) {
    if (!uniq.includes(t)) uniq.push(t);
    if (uniq.length >= 5) break;
  }
  return uniq.slice(0, 4).join(" ").trim();
}

function isBlockedDemandQuery(query) {
  const q = String(query || "");
  if (q.length < 6) return true;
  const vero = scanVero(q);
  if (!vero.ok) return true;
  const haz = scanHazardous(q);
  if (haz.level === "block") return true;
  return false;
}

function looksLikeCategoryLabel(q) {
  const s = String(q || "").trim();
  if (/[\/&]/.test(s)) return true;
  if (s.split(/\s+/).length <= 2 && /^(mode|cadeaux|beaute|beauté|maison|voyage|deco|déco|sport|jardin|enfants|high-tech|tech)$/i.test(s)) {
    return true;
  }
  return false;
}

/**
 * Construit la file de mots-clés du jour.
 * Seeds (niches rotatives = demande ciblée + snipable) d'abord, puis titres tendances eBay,
 * puis tips calendrier découpés (jamais un label de catégorie).
 */
function buildDemandKeywords({ trendItems = [], seeds = [], calendarEvents = [], limit = 24 } = {}) {
  const cap = Math.max(4, Number(limit) || 24);
  const out = [];
  const seen = new Set();
  const push = (raw, reason) => {
    const q = String(raw || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    if (!q || looksLikeCategoryLabel(q) || isBlockedDemandQuery(q)) return false;
    if (q.split(/\s+/).length < 2) return false;
    const key = q.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    out.push({ query: q, reason: reason || "demand" });
    return true;
  };

  for (const s of seeds || []) push(s, "seed");

  const scored = [...(trendItems || [])].sort((a, b) => {
    const sa = (Number(a.sold) || 0) * (Number(a.price) || 1) + (Number(a._score) || 0);
    const sb = (Number(b.sold) || 0) * (Number(b.price) || 1) + (Number(b._score) || 0);
    return sb - sa;
  });
  for (const it of scored) {
    if (out.length >= cap) break;
    if (it.seed) push(it.seed, "trend-seed");
    if (out.length >= cap) break;
    const fromTitle = keywordFromTitle(it.title);
    if (fromTitle) push(fromTitle, "trend-title");
  }

  for (const ev of calendarEvents || []) {
    if (out.length >= cap) break;
    if (ev.phase !== "live" && ev.phase !== "prep") continue;
    const chunks = String(ev.tip || "").split(/[,;/|]+/);
    for (const chunk of chunks) {
      if (out.length >= cap) break;
      const tipWords = keywordFromTitle(chunk);
      const n = tipWords ? tipWords.split(/\s+/).length : 0;
      if (tipWords && n >= 2 && n <= 4) push(tipWords, "calendar-tip");
    }
  }

  return out.slice(0, cap);
}

function nextDemandSlice(keywords, cursor = 0, count = 2) {
  const list = Array.isArray(keywords) ? keywords : [];
  if (!list.length) return { items: [], cursor: 0 };
  const n = Math.max(1, Number(count) || 2);
  const items = [];
  let i = Number(cursor) || 0;
  for (let k = 0; k < n && k < list.length; k++) {
    items.push(list[i % list.length]);
    i = (i + 1) % list.length;
  }
  return { items, cursor: i };
}

function todayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * Classe les offres fournisseur par rentabilité nette après prix concurrentiel eBay.
 * Garde uniquement celles avec net ≥ minNetPct.
 */
function rankOffersByProfit(offers, competitorPrices = [], minNetPct = MIN_NET_PCT) {
  const rows = [];
  for (const offer of offers || []) {
    const cost = Number(offer?.price);
    if (!(cost >= 1.99)) continue;
    const priced = competitiveSellPrice({ cost, competitorPrices, minNetPct });
    const margin = estimateMargin({ cost, sellPrice: priced.sell });
    const ok = Boolean(priced.profitable && (priced.competitorCount === 0 || priced.competitive));
    rows.push({
      offer,
      priced,
      netAmount: margin.netAmount,
      netPct: margin.netPct,
      profitable: ok,
    });
  }
  rows.sort((a, b) => {
    if (a.profitable !== b.profitable) return a.profitable ? -1 : 1;
    if (Math.abs((b.netPct || 0) - (a.netPct || 0)) > 0.4) return b.netPct - a.netPct;
    return Number(a.offer.price) - Number(b.offer.price);
  });
  return rows;
}

function pickMostProfitableOffer(offers, competitorPrices = [], minNetPct = MIN_NET_PCT) {
  const ranked = rankOffersByProfit(offers, competitorPrices, minNetPct);
  const best = ranked.find((r) => r.profitable);
  return best || null;
}

function isSupplierUrl(url) {
  const u = String(url || "");
  if (!u || /ebay\.(com|fr|de|co\.uk|it|es)\b/i.test(u)) return false;
  if (/wholesale-|\/w\/wholesale|\/search\/|SearchText=|\/s\?k=/i.test(u)) return false;
  if (/cdiscount\.com\/[^?]*(?:\/r-|\/f-\d+-nav)/i.test(u)) return false;
  return /amazon\.[a-z.]+\/.*(dp|gp\/product)|aliexpress\.com\/item\/|cdiscount\.com\/.+\.html/i.test(u);
}

function emptyPipelineState(marketplace = "France") {
  return {
    day: "",
    marketplace,
    keywords: [],
    cursor: 0,
    lastTickAt: null,
    lastPhase: "",
    preparedToday: 0,
    publishedToday: 0,
    skippedToday: 0,
    lastError: "",
    lastQuery: "",
    queued: 0,
    algo: 0,
  };
}

function rollPipelineDay(state, marketplace, now = new Date()) {
  const day = todayKey(now);
  const prev = state && typeof state === "object" ? state : {};
  if (prev.day === day && prev.marketplace === marketplace) return { ...prev, marketplace };
  return {
    ...emptyPipelineState(marketplace),
    day,
    marketplace,
  };
}

module.exports = {
  MIN_NET_PCT,
  DEFAULT_PREPARE_PER_TICK,
  DEFAULT_PUBLISH_PER_TICK,
  QUEUE_CAP,
  DEMAND_ALGO,
  languageForMarket,
  keywordFromTitle,
  isBlockedDemandQuery,
  looksLikeCategoryLabel,
  buildDemandKeywords,
  nextDemandSlice,
  todayKey,
  rankOffersByProfit,
  pickMostProfitableOffer,
  isSupplierUrl,
  emptyPipelineState,
  rollPipelineDay,
};
