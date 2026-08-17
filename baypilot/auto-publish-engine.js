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
const DEMAND_ALGO = 4;

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
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w) && !looksLikeBrandToken(w));
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

function isWeakDemandQuery(q) {
  const toks = String(q || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (toks.length < 2) return true;
  const GENERIC = new Set([
    "deco", "ete", "plage", "voyage", "maison", "cadeau", "cadeaux", "sacs",
    "mode", "sport", "jardin", "tech", "bureau", "enfants", "accessoires",
    "laptop", "stands",
  ]);
  if (toks.every((t) => GENERIC.has(t) || t.length <= 3)) return true;
  if (!toks.some((t) => t.length >= 5) && toks.every((t) => t.length <= 4)) return true;
  return false;
}

/** Marques / noms vendeur collés dans les titres eBay — polluent le sniper. */
function looksLikeBrandToken(tok) {
  const t = String(tok || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (t.length < 5) return false;
  if (
    /^(krystalparis|krystal|cascata|aeuezxx|flintronic|vinato|elalove|aiqinu|lamicall|incutex|tuya|lenovo)$/i.test(
      t
    )
  ) {
    return true;
  }
  // Marque collée type "krystalparis" / "prokrystal" sans voyelle régulière produit
  if (t.length >= 11 && /(paris|crystal|krystal)$/i.test(t)) return true;
  return false;
}

function snipableDemandQuery(query) {
  const toks = String(query || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9àâäéèêëïîôùûüç\s-]/gi, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !looksLikeBrandToken(t));
  if (toks.length >= 2) return toks.slice(0, 4).join(" ");
  return String(query || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
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
    if (!q || looksLikeCategoryLabel(q) || isWeakDemandQuery(q) || isBlockedDemandQuery(q)) return false;
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

function normalizeMatch(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function queryToks(query) {
  return normalizeMatch(query)
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function titleOverlapsQuery(title, query) {
  const toks = queryToks(query);
  if (!toks.length) return true;
  const t = normalizeMatch(title);
  if (!t) return false;
  const hits = toks.filter(
    (tok) => t.includes(tok) || t.includes(`${tok}s`) || (tok.endsWith("s") && t.includes(tok.slice(0, -1)))
  );
  return hits.length >= Math.min(toks.length, Math.max(2, Math.ceil(toks.length * 0.66)));
}

function isUsedListing(item = {}) {
  const cond = String(item.condition || "");
  if (/\b(new|neuf|brand new|new with tags|new without tags|nouveau)\b/i.test(cond)) return false;
  const blob = `${cond} ${item.title || ""}`;
  return /\b(used|occasion|usag[ée]|refurbished|reconditionn|pour pi[eè]ces|pre-?owned|very good|bon [eé]tat|tr[eè]s bon [eé]tat|acceptable|open box|comme neuf)\b/i.test(
    blob
  );
}

/**
 * Prix eBay comparables : neuf, titre proche, hors occasions / lots dump.
 * Accepte des nombres ou des objets { price, title, condition }.
 */
function competitorMarketPrices(items = [], query = "") {
  const rows = [];
  for (const it of items || []) {
    if (typeof it === "number" || (it != null && typeof it !== "object")) {
      const p = Number(it);
      if (p >= 2.5 && p < 500) rows.push(p);
      continue;
    }
    const p = Number(it.price);
    if (!(p >= 2.5 && p < 500)) continue;
    if (isUsedListing(it)) continue;
    const title = String(it.title || "");
    if (title && query && !titleOverlapsQuery(title, query)) continue;
    rows.push(p);
  }
  rows.sort((a, b) => a - b);
  return rows;
}

function explainUnprofitable(ranked, competitorPrices = []) {
  if (!ranked.length) {
    return "Aucun fournisseur avec une fiche produit (Amazon / AliExpress / Cdiscount)";
  }
  const r = ranked[0];
  const cost = Number(r.offer?.price) || 0;
  const minSell = r.priced?.minSell;
  const market = r.priced?.market ?? r.priced?.cheapest;
  const n = r.priced?.competitorCount || competitorPrices.length || 0;
  const src = r.offer?.source || "fournisseur";
  if (n <= 0) {
    return `${src} ${cost.toFixed(2)}€ — coût ou URL invalide`;
  }
  return `${src} ${cost.toFixed(2)}€ → plancher ${Number(minSell).toFixed(2)}€ vs eBay neuf ${
    market != null ? Number(market).toFixed(2) + "€" : "n/a"
  } (${n} concurrent${n > 1 ? "s" : ""}) — pas concurrentiel à net ≥ 5%`;
}

function isSupplierUrl(url) {
  const u = String(url || "");
  if (!u || /ebay\.(com|fr|de|co\.uk|it|es)\b/i.test(u)) return false;
  if (/wholesale-|\/w\/wholesale|\/search\/|SearchText=|\/s\?k=/i.test(u)) return false;
  if (/cdiscount\.com\/[^?]*(?:\/r-|\/f-\d+-nav)/i.test(u)) return false;
  return /amazon\.[a-z.]+\/(?:[^/?#]+\/)?(?:dp|gp\/(?:product|aw\/d))\b|aliexpress\.com\/(?:item|i)\/|cdiscount\.com\/.+\.html/i.test(
    u
  );
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
  isWeakDemandQuery,
  snipableDemandQuery,
  looksLikeBrandToken,
  buildDemandKeywords,
  nextDemandSlice,
  todayKey,
  rankOffersByProfit,
  pickMostProfitableOffer,
  isSupplierUrl,
  competitorMarketPrices,
  titleOverlapsQuery,
  explainUnprofitable,
  emptyPipelineState,
  rollPipelineDay,
};
