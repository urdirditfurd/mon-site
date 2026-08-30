/**
 * Double vérification pré-publication eBay.
 * Empêche de publier une fiche dont l’identité ou le prix ne matchent plus
 * la source fournisseur (ex. Logitech ~87 € publiée à 11,51 €).
 */
"use strict";

const STOP = new Set([
  "le", "la", "les", "un", "une", "des", "de", "du", "et", "ou", "pour", "avec", "sans",
  "sur", "dans", "aux", "the", "and", "for", "with", "from", "new", "neuf", "nouvelle",
  "nouveau", "pack", "lot", "set", "kit", "pc", "mac", "usb", "led", "rgb", "noir",
  "blanc", "black", "white", "couleur", "color", "size", "taille", "cm", "mm",
]);

function extractAsin(url = "") {
  const m = String(url).match(/\/(?:dp|gp\/(?:product|aw\/d))\/([A-Z0-9]{10})/i);
  return m ? m[1].toUpperCase() : "";
}

function normalize(s = "") {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function significantTokens(text = "", { minLen = 3 } = {}) {
  return normalize(text)
    .split(/\s+/)
    .filter((t) => t.length >= minLen && !STOP.has(t) && !/^\d+$/.test(t));
}

/**
 * Identité titre : assez de tokens significatifs en commun (marque / modèle).
 */
function titlesShareIdentity(sourceTitle, listingTitle) {
  const src = significantTokens(sourceTitle);
  const lst = new Set(significantTokens(listingTitle));
  if (!src.length || !lst.size) return { ok: false, hits: 0, need: 2, ratio: 0 };
  const hits = src.filter((t) => lst.has(t) || [...lst].some((l) => l.includes(t) || t.includes(l)));
  const uniq = [...new Set(hits)];
  const need = Math.min(3, Math.max(2, Math.ceil(src.slice(0, 8).length * 0.4)));
  const ratio = uniq.length / Math.min(8, src.length);
  return { ok: uniq.length >= need || ratio >= 0.45, hits: uniq.length, need, ratio, shared: uniq.slice(0, 8) };
}

/**
 * Prix : le coût stocké et le prix de vente doivent rester cohérents avec le prix live source.
 * Cas bloqué : Amazon 87 € → coût ~10 € → vente 11,51 €.
 */
function priceSaneVsSource({ livePrice, cost, sell } = {}) {
  const live = Number(livePrice) || 0;
  const c = Number(cost) || 0;
  const s = Number(sell) || 0;
  if (!(live >= 1.99)) return { ok: true, skipped: true, reason: "pas de prix live" };

  // Coût stocké anormalement bas vs fournisseur live
  if (c >= 1.99 && c < live * 0.55) {
    return {
      ok: false,
      code: "COST_TOO_LOW_VS_SOURCE",
      message: `Coût stocké ${c.toFixed(2)}€ trop bas vs source live ${live.toFixed(2)}€ (seuil 55%)`,
      live,
      cost: c,
      sell: s,
    };
  }

  // Vente sous le prix fournisseur (dropship impossible / mauvais concurrents)
  if (s >= 1.99 && s < live * 0.92) {
    return {
      ok: false,
      code: "SELL_BELOW_SOURCE",
      message: `Prix vente ${s.toFixed(2)}€ < 92% du prix source ${live.toFixed(2)}€ — publication bloquée`,
      live,
      cost: c,
      sell: s,
    };
  }

  // Vente sous le coût
  if (s >= 1.99 && c >= 1.99 && s < c) {
    return {
      ok: false,
      code: "SELL_BELOW_COST",
      message: `Prix vente ${s.toFixed(2)}€ < coût ${c.toFixed(2)}€`,
      live,
      cost: c,
      sell: s,
    };
  }

  return { ok: true, live, cost: c, sell: s };
}

/**
 * @param {object} listing
 * @param {object} deps
 * @param {Function} deps.scrapeProduct
 * @param {Function} [deps.isSupplierProductUrl]
 */
async function verifyListingMatchesSource(listing, deps = {}) {
  const scrapeProduct = deps.scrapeProduct;
  const isSupplierProductUrl =
    deps.isSupplierProductUrl ||
    ((url) =>
      /amazon\.[a-z.]+\/.*(dp|gp\/product)|aliexpress\.com\/item\/|cdiscount\.com\/.+\.html/i.test(
        String(url || "")
      ));

  const sourceUrl = String(listing?.source_url || "").trim();
  if (!sourceUrl) {
    return {
      ok: false,
      code: "NO_SOURCE_URL",
      message: "Pas de source_url — double vérification impossible",
    };
  }
  if (!isSupplierProductUrl(sourceUrl)) {
    return {
      ok: false,
      code: "BAD_SOURCE_URL",
      message: `source_url invalide (pas une fiche fournisseur) : ${sourceUrl.slice(0, 80)}`,
    };
  }

  if (typeof scrapeProduct !== "function") {
    return { ok: false, code: "NO_SCRAPER", message: "scrapeProduct manquant" };
  }

  let scraped;
  try {
    scraped = await scrapeProduct(sourceUrl);
  } catch (err) {
    return {
      ok: false,
      code: "SOURCE_SCRAPE_FAILED",
      message: `Re-scrape source échoué — publication refusée (sécurité) : ${err.message || err}`,
    };
  }

  const sourceTitle = String(scraped?.title || "").trim();
  const livePrice = Number(scraped?.price) || 0;
  const listingTitle = String(listing?.seo_title || listing?.title || "").trim();
  const cost = Number(listing?.cost_price) || 0;
  const sell = Number(listing?.suggested_price) || 0;

  const urlAsin = extractAsin(sourceUrl);
  const scrapedAsin = extractAsin(scraped?.url || scraped?.finalUrl || "") || extractAsin(sourceUrl);
  if (urlAsin && scrapedAsin && urlAsin !== scrapedAsin) {
    return {
      ok: false,
      code: "ASIN_MISMATCH",
      message: `ASIN divergent : URL ${urlAsin} ≠ scrape ${scrapedAsin}`,
      sourceTitle,
      livePrice,
    };
  }

  if (!sourceTitle || sourceTitle.length < 8) {
    return {
      ok: false,
      code: "WEAK_SOURCE_TITLE",
      message: "Titre source trop faible après re-scrape — publication refusée",
    };
  }

  const identity = titlesShareIdentity(sourceTitle, listingTitle);
  if (!identity.ok) {
    return {
      ok: false,
      code: "TITLE_IDENTITY_MISMATCH",
      message: `Identité titre insuffisante (source « ${sourceTitle.slice(0, 60)} » vs listing « ${listingTitle.slice(
        0,
        60
      )} » — ${identity.hits}/${identity.need} tokens)`,
      sourceTitle,
      listingTitle,
      identity,
      livePrice,
      asin: urlAsin || scrapedAsin,
    };
  }

  const price = priceSaneVsSource({ livePrice, cost, sell });
  if (!price.ok) {
    return {
      ok: false,
      code: price.code,
      message: price.message,
      sourceTitle,
      listingTitle,
      identity,
      price,
      livePrice,
      asin: urlAsin || scrapedAsin,
    };
  }

  return {
    ok: true,
    code: "OK",
    message: `Double vérif OK — ASIN ${urlAsin || scrapedAsin || "n/a"} · source ${livePrice || "?"}€ · vente ${sell}€`,
    sourceTitle,
    listingTitle,
    identity,
    price,
    livePrice,
    asin: urlAsin || scrapedAsin,
    scraped,
  };
}

module.exports = {
  extractAsin,
  significantTokens,
  titlesShareIdentity,
  priceSaneVsSource,
  verifyListingMatchesSource,
};
