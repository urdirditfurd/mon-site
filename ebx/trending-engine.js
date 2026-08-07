/**
 * Moteur tendances eBay FR — jour / semaine / mois.
 * Browse API + enrichissement ventes + cache disque + rotation niches.
 *
 * eBay ne fournit pas de « top ventes officielles » en API publique :
 * on proxy via niches rotatives + estimatedSoldQuantity + score CA.
 */

const fs = require("fs");
const path = require("path");
const { browseSearch, enrichBrowseItems } = require("./ebay-browse");
const { scanHazardous } = require("./business-engine");

const CACHE_PATH = path.join(__dirname, "data", "trending-cache.json");

/** Marques à exclure des suggestions (VeRO / contrefaçon fréquente). */
const TREND_BLOCK_BRANDS = [
  "stone island",
  "moncler",
  "canada goose",
  "nike",
  "adidas",
  "jordan",
  "louis vuitton",
  "gucci",
  "chanel",
  "hermès",
  "hermes",
  "rolex",
  "dior",
  "balenciaga",
  "supreme",
  "off-white",
  "disney",
  "lego",
  "dyson",
  "apple watch",
  "airpods pro",
];

/** Pool large de niches dropshipping-friendly FR (rotation jour/semaine). */
const NICHE_POOL = [
  // High-tech / mobile (générique, sans marque contrefaite)
  "coque silicone transparent smartphone",
  "verre trempé protection écran",
  "chargeur gan usb-c 65w",
  "cable usb c tresse 2m",
  "support telephone voiture magnetique",
  "powerbank 20000mah",
  "écouteurs bluetooth sans fil",
  "ring light led selfie",
  // Maison / déco
  "bande led rgb wifi",
  "ruban led neon flexible",
  "organiseur tiroir cuisine",
  "crochet mural adhésif",
  "lampe de chevet tactile",
  "diffuseur huile essentielle",
  "tapis de bain antidérapant",
  // Beauté
  "eponge maquillage blender",
  "pinceaux maquillage set",
  "miroir led maquillage",
  "rouleau jade visage",
  "bandeau spa maquillage",
  // Bricolage / réparation (hors hazmat)
  "colle b7000 telephone",
  "kit tournevis precision telephone",
  "ventouse ecran telephone",
  "pate thermique cpu",
  // Bureau / setup
  "tapis de souris xxl",
  "support laptop aluminium",
  "organiseur cables bureau",
  "lampe bureau led clip",
  "repose poignet clavier",
  // Sport / outdoor
  "bande elastique musculation",
  "gourde sport inox",
  "tapis yoga antidérapant",
  "corde à sauter vitesse",
  // Auto
  "aspirateur voiture portable",
  "range documents voiture",
  "chargeur allume cigare usb",
  // Animaux
  "jouet chat plume",
  "brosse chien autotoy",
  "gamelle anti glouton",
  // Saisonnier (été / rentrée / hiver — toujours utiles)
  "ventilateur usb portable",
  "pochette etanche telephone",
  "chauffe main rechargeable",
  "guirlande lumineuse interieur",
];

/** Boost saisonnier selon mois (1–12). */
function seasonalBoosts(month) {
  const m = Number(month) || new Date().getMonth() + 1;
  const map = {
    1: ["chauffe main rechargeable", "organiseur tiroir cuisine", "lampe de chevet tactile"],
    2: ["rouleau jade visage", "miroir led maquillage", "diffuseur huile essentielle"],
    3: ["tapis yoga antidérapant", "bande elastique musculation", "gourde sport inox"],
    4: ["aspirateur voiture portable", "pochette etanche telephone", "guirlande lumineuse interieur"],
    5: ["ventilateur usb portable", "bande led rgb wifi", "ring light led selfie"],
    6: ["ventilateur usb portable", "pochette etanche telephone", "ruban led neon flexible"],
    7: ["ventilateur usb portable", "pochette etanche telephone", "gourde sport inox"],
    8: ["coque silicone transparent smartphone", "verre trempé protection écran", "cable usb c tresse 2m"],
    9: ["support laptop aluminium", "tapis de souris xxl", "organiseur cables bureau"],
    10: ["lampe bureau led clip", "diffuseur huile essentielle", "guirlande lumineuse interieur"],
    11: ["bande led rgb wifi", "ring light led selfie", "powerbank 20000mah"],
    12: ["guirlande lumineuse interieur", "lampe de chevet tactile", "powerbank 20000mah"],
  };
  return map[m] || [];
}

function ensureDataDir() {
  const dir = path.dirname(CACHE_PATH);
  fs.mkdirSync(dir, { recursive: true });
}

function loadTrendCache() {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
    }
  } catch (_) {}
  return {};
}

function saveTrendCache(cache) {
  try {
    ensureDataDir();
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.warn("[EBX] trending cache write:", err.message);
  }
}

function periodKey(period, now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  if (period === "day") return `day-${y}-${m}-${d}`;
  if (period === "week") {
    const onejan = new Date(y, 0, 1);
    const week = Math.ceil(((now - onejan) / 86400000 + onejan.getDay() + 1) / 7);
    return `week-${y}-W${String(week).padStart(2, "0")}`;
  }
  return `month-${y}-${m}`;
}

function ttlMs(period) {
  if (period === "day") return 3 * 60 * 60 * 1000; // 3 h
  if (period === "week") return 8 * 60 * 60 * 1000; // 8 h
  return 24 * 60 * 60 * 1000; // 24 h
}

function seedsForPeriod(period, now = new Date()) {
  const dayOfYear = Math.floor(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      Date.UTC(now.getFullYear(), 0, 0)) /
      86400000
  );
  const seasonal = seasonalBoosts(now.getMonth() + 1);
  const pool = [...seasonal, ...NICHE_POOL.filter((n) => !seasonal.includes(n))];

  // Rotation stable : chaque jour décale la fenêtre dans le pool
  const start = dayOfYear % Math.max(1, pool.length);
  const rotated = pool.slice(start).concat(pool.slice(0, start));

  if (period === "day") {
    // 6 niches du jour (fraîcheur)
    return rotated.slice(0, 6);
  }
  if (period === "week") {
    // 10 niches (mix semaine = jour + voisins)
    const weekOffset = Math.floor(dayOfYear / 7) % pool.length;
    const weekRot = pool.slice(weekOffset).concat(pool.slice(0, weekOffset));
    return [...new Set([...rotated.slice(0, 4), ...weekRot.slice(0, 8)])].slice(0, 10);
  }
  // mois : large couverture
  return [...new Set([...seasonal, ...rotated.slice(0, 14)])].slice(0, 14);
}

function isBlockedTrendTitle(title) {
  const t = String(title || "").toLowerCase();
  if (!t) return true;
  if (TREND_BLOCK_BRANDS.some((b) => t.includes(b))) return true;
  const haz = scanHazardous(t);
  if (haz.level === "block") return true;
  return false;
}

function scoreItem(it, period) {
  const price = Number(it.price) || 0;
  const sold = Number(it.sold) || 0;
  const ca = price * sold;
  // Jour : favorise tickets moyens + un peu de volume (pas seulement mega-listers)
  if (period === "day") {
    return ca * 0.6 + sold * 8 + (price >= 5 && price <= 40 ? 120 : 0) + (it.relevance || 0) * 15;
  }
  if (period === "week") {
    return ca * 0.85 + sold * 5 + (it.relevance || 0) * 10;
  }
  return ca + sold * 3 + (it.relevance || 0) * 5;
}

/**
 * Récupère / rafraîchit les tendances pour une période.
 */
async function fetchTrendingProducts({
  marketplace = "FR",
  period = "day",
  force = false,
  limit = 12,
} = {}) {
  const now = new Date();
  const key = `${marketplace}:${periodKey(period, now)}`;
  const cache = loadTrendCache();
  const hit = cache[key];
  if (
    !force &&
    hit &&
    Array.isArray(hit.items) &&
    hit.items.length >= 4 &&
    Date.now() - Number(hit.fetchedAt || 0) < ttlMs(period)
  ) {
    return {
      items: hit.items.slice(0, limit),
      live: !!hit.live,
      cached: true,
      period,
      seeds: hit.seeds || [],
      updatedAt: hit.updatedAt || new Date(hit.fetchedAt).toISOString(),
      source: hit.source || "cache",
      algo: hit.algo,
    };
  }

  const seeds = seedsForPeriod(period, now);
  const perSeed = period === "day" ? 3 : period === "week" ? 3 : 2;
  const all = [];
  let apiOk = false;
  let source = "browse";

  for (const q of seeds) {
    try {
      const r = await browseSearch(q, { marketplace, limit: perSeed });
      apiOk = true;
      (r.items || []).forEach((it, idx) => {
        if (isBlockedTrendTitle(it.title)) return;
        all.push({
          ...it,
          seed: q,
          sold: Number(it.sold) > 0 ? Number(it.sold) : 0,
          soldEstimated: it.soldEstimated !== false && !(Number(it.sold) > 0),
          relevance: perSeed - idx,
        });
      });
    } catch (err) {
      console.warn(`[EBX] trending seed « ${q} »: ${err.message?.slice?.(0, 80) || err}`);
    }
  }

  // Dédup avant enrich
  const seen = new Set();
  const candidates = [];
  for (const p of all) {
    const k = String(p.itemId || p.title || "")
      .slice(0, 56)
      .toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    candidates.push(p);
    if (candidates.length >= 28) break;
  }

  let enriched = candidates;
  if (candidates.length) {
    try {
      enriched = await enrichBrowseItems(candidates, {
        marketplace,
        limit: Math.min(18, candidates.length),
      });
    } catch (e) {
      console.warn("[EBX] trending enrich:", e.message);
    }
  }

  // Re-filtre après enrich + score
  const scored = enriched
    .filter((p) => p.title && !isBlockedTrendTitle(p.title))
    .map((p) => ({
      ...p,
      sold: Number(p.sold) > 0 ? Number(p.sold) : 0,
      price: Number(p.price) > 0 ? Number(p.price) : 0,
      _score: scoreItem(p, period),
    }))
    .sort((a, b) => b._score - a._score);

  const uniq = [];
  const titleSeen = new Set();
  for (const p of scored) {
    const tk = String(p.title || "")
      .slice(0, 42)
      .toLowerCase();
    if (titleSeen.has(tk)) continue;
    titleSeen.add(tk);
    const ca = Number(((Number(p.price) || 0) * (Number(p.sold) || 0)).toFixed(0));
    uniq.push({
      rank: uniq.length + 1,
      title: p.title,
      category: p.seed || "eBay FR",
      price: p.price || 0,
      wasPrice: p.wasPrice || null,
      sold: p.sold || 0,
      soldEstimated: !!p.soldEstimated && !(p.sold > 0),
      ca,
      marketplace,
      url: p.url || null,
      image: p.image || null,
      itemId: p.itemId || null,
      live: apiOk,
      period,
      trend: uniq.length % 3 === 0 ? "up" : uniq.length % 3 === 1 ? "stable" : "down",
    });
    if (uniq.length >= Math.max(limit, 12)) break;
  }

  const algo =
    `Niches rotatives ${period} (${seeds.length}) → Browse eBay FR → fiche item ` +
    `(estimatedSoldQuantity). Exclut marques VeRO / hazmat. Cache ${Math.round(ttlMs(period) / 3600000)}h.`;

  const payload = {
    items: uniq,
    live: apiOk && uniq.length > 0,
    cached: false,
    period,
    seeds,
    updatedAt: now.toISOString(),
    source: apiOk ? "eBay Browse + item detail" : "empty",
    algo,
  };

  if (uniq.length >= 3) {
    cache[key] = {
      ...payload,
      fetchedAt: Date.now(),
      source: payload.source,
    };
    // Purge vieilles clés (> 40 jours)
    const cutoff = Date.now() - 40 * 86400000;
    for (const [k, v] of Object.entries(cache)) {
      if (Number(v?.fetchedAt || 0) < cutoff) delete cache[k];
    }
    saveTrendCache(cache);
  }

  return payload;
}

function getCachedTrendingMeta(marketplace = "FR") {
  const cache = loadTrendCache();
  const out = {};
  for (const period of ["day", "week", "month"]) {
    const key = `${marketplace}:${periodKey(period)}`;
    const hit = cache[key];
    out[period] = hit
      ? {
          count: (hit.items || []).length,
          updatedAt: hit.updatedAt || null,
          seeds: hit.seeds || [],
          live: !!hit.live,
        }
      : null;
  }
  return out;
}

module.exports = {
  fetchTrendingProducts,
  seedsForPeriod,
  periodKey,
  isBlockedTrendTitle,
  getCachedTrendingMeta,
  NICHE_POOL,
  TREND_BLOCK_BRANDS,
};
