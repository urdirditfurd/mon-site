/**
 * EBX Business Engine — capacités niveau Business (sans abonnement).
 * Anti-ban, VeRO, SEO scoring, pilotage.
 */

/** Marques / termes VeRO fréquents (liste locale extensible). */
const VERO_BRANDS = [
  "nike",
  "adidas",
  "apple",
  "iphone",
  "ipad",
  "macbook",
  "airpods",
  "sony playstation",
  "playstation 5",
  "ps5",
  "xbox",
  "nintendo",
  "louis vuitton",
  "gucci",
  "chanel",
  "hermes",
  "rolex",
  "disney",
  "marvel",
  "lego",
  "samsung galaxy official",
  "dyson",
  "bose",
  "beats by dre",
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

/**
 * Délai anti-ban.
 * testMode=true → court (dev).
 * testMode=false → jitter humain ; hors 8h–22h locale → attend jusqu'à la prochaine fenêtre.
 */
async function antiBanDelay({ testMode = true, label = "step" } = {}) {
  if (testMode) {
    const ms = randomBetween(200, 600);
    await sleep(ms);
    return { waitedMs: ms, deferred: false, label };
  }

  const now = new Date();
  const hour = now.getHours();
  let deferred = false;
  let extra = 0;

  if (hour < 8 || hour >= 22) {
    deferred = true;
    // Attente courte simulée (évite de bloquer des heures en CLI) + gros jitter
    extra = randomBetween(3000, 8000);
  }

  const ms = extra + randomBetween(2500, 9000);
  await sleep(ms);
  return { waitedMs: ms, deferred, label, hour };
}

function scanVero(text) {
  const hay = String(text || "").toLowerCase();
  const hits = VERO_BRANDS.filter((b) => hay.includes(b));
  return {
    ok: hits.length === 0,
    hits,
    level: hits.length === 0 ? "clear" : hits.length <= 2 ? "warn" : "block",
    message:
      hits.length === 0
        ? "Aucun signal VeRO connu"
        : `Risque VeRO : ${hits.slice(0, 5).join(", ")}`,
  };
}

/** Score SEO 0–100 à partir d'un titre + mots-clés. */
function scoreSeoTitle(title, keywords = []) {
  const t = String(title || "").trim();
  const len = t.length;
  let score = 40;

  if (len >= 60 && len <= 80) score += 25;
  else if (len >= 40 && len < 60) score += 15;
  else if (len > 80) score -= 15;
  else if (len < 25) score -= 10;

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 6 && words.length <= 14) score += 10;

  const kwHits = (keywords || []).filter((k) =>
    t.toLowerCase().includes(String(k).toLowerCase())
  ).length;
  score += Math.min(20, kwHits * 5);

  if (!/[!?]{2,}|💰|🔥|✅/.test(t)) score += 5;
  if (/\b(neuf|new|garantie|livraison)\b/i.test(t)) score += 5;

  score = Math.max(0, Math.min(100, score));
  return {
    score,
    length: len,
    keywordHits: kwHits,
    grade: score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : "D",
  };
}

function buildAiTitle(productName, keywords = []) {
  const base = String(productName || "Produit")
    .replace(/\s+/g, " ")
    .trim();
  const extras = (keywords || [])
    .map((k) => String(k).trim())
    .filter(Boolean)
    .filter((k) => !base.toLowerCase().includes(k.toLowerCase()))
    .slice(0, 4);
  let title = [base, ...extras].join(" ").replace(/\s+/g, " ").trim();
  if (title.length > 80) title = title.slice(0, 80).replace(/\s+\S*$/, "");
  if (!/\bneuf\b/i.test(title) && title.length < 75) {
    title = `${title} Neuf`.slice(0, 80);
  }
  return title;
}

function estimateMargin({ cost, sellPrice, ebayFeeRate = 0.13 } = {}) {
  const c = Number(cost) || 0;
  const s = Number(sellPrice) || 0;
  if (s <= 0) return { netPct: 0, netAmount: 0, fees: 0 };
  const fees = s * ebayFeeRate;
  const net = s - fees - c;
  return {
    fees: Number(fees.toFixed(2)),
    netAmount: Number(net.toFixed(2)),
    netPct: Number(((net / s) * 100).toFixed(1)),
  };
}

function buildPilotageFeed({
  listings = [],
  orders = [],
  seller = null,
  ebayEnv = "sandbox",
  publishedToday = 0,
} = {}) {
  const alerts = [];

  if (ebayEnv !== "production") {
    alerts.push({
      level: "warn",
      title: "Mode Sandbox",
      detail: "Les publications ne vont pas sur ton vrai compte. EBAY_ENV=production pour le réel.",
    });
  } else if (seller?.userId) {
    alerts.push({
      level: "ok",
      title: `Compte vendeur : ${seller.userId}`,
      detail: "OAuth Production lié — prêt à publier.",
    });
  }

  const noImg = listings.filter((l) => !l.has_images && !l.ebay_listing_id).length;
  if (noImg > 0) {
    alerts.push({
      level: "warn",
      title: `${noImg} listing(s) sans image`,
      detail: "Republier tentera un re-scrape, ou régénère via Description Builder.",
    });
  }

  const pendingOrders = orders.filter((o) => o.status === "pending").length;
  if (pendingOrders > 0) {
    alerts.push({
      level: "info",
      title: `${pendingOrders} auto-order(s) en attente`,
      detail: "Passe à Auto-Order → Avancer / commander chez le fournisseur.",
    });
  }

  const published = listings.filter((l) => l.ebay_listing_id).length;
  alerts.push({
    level: "info",
    title: `${published} annonce(s) liées eBay`,
    detail: `${publishedToday} publication(s) récente(s) mémorisée(s) localement.`,
  });

  const veroSample = listings.slice(0, 8).map((l) => scanVero(l.seo_title));
  const veroHits = veroSample.filter((v) => !v.ok);
  if (veroHits.length) {
    alerts.push({
      level: "warn",
      title: "Signaux VeRO sur des titres",
      detail: veroHits[0].message + " — vérifie avant volume.",
    });
  }

  alerts.push({
    level: "ok",
    title: "Pilotage Business actif",
    detail: "Listings, titres, descriptions, sniper, sync et multi-comptes sans quota abonnement.",
  });

  return alerts;
}

module.exports = {
  sleep,
  antiBanDelay,
  scanVero,
  scoreSeoTitle,
  buildAiTitle,
  estimateMargin,
  buildPilotageFeed,
  VERO_BRANDS,
};
