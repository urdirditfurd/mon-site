/**
 * Moteur tendances eBay multi-marché (FR / US / DE / GB).
 * Browse API + enrichissement ventes + cache disque + rotation niches.
 *
 * eBay ne fournit pas de « top ventes officielles » en API publique :
 * on proxy via niches rotatives + estimatedSoldQuantity + score CA.
 */

const fs = require("fs");
const path = require("path");
const { browseSearch, enrichBrowseItems, normalizeMarketCode } = require("./ebay-browse");
const { scanHazardous } = require("./business-engine");
const { trendingCachePath } = require("./runtime-paths");

const CACHE_PATH = trendingCachePath();

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

/** Pool niches FR. */
const NICHE_POOL_FR = [
  "coque silicone transparent smartphone",
  "verre trempé protection écran",
  "chargeur gan usb-c 65w",
  "cable usb c tresse 2m",
  "support telephone voiture magnetique",
  "powerbank 20000mah",
  "écouteurs bluetooth sans fil",
  "ring light led selfie",
  "bande led rgb wifi",
  "ruban led neon flexible",
  "organiseur tiroir cuisine",
  "crochet mural adhésif",
  "lampe de chevet tactile",
  "diffuseur huile essentielle",
  "tapis de bain antidérapant",
  "eponge maquillage blender",
  "pinceaux maquillage set",
  "miroir led maquillage",
  "rouleau jade visage",
  "bandeau spa maquillage",
  "colle b7000 telephone",
  "kit tournevis precision telephone",
  "ventouse ecran telephone",
  "pate thermique cpu",
  "tapis de souris xxl",
  "support laptop aluminium",
  "organiseur cables bureau",
  "lampe bureau led clip",
  "repose poignet clavier",
  "bande elastique musculation",
  "gourde sport inox",
  "tapis yoga antidérapant",
  "corde à sauter vitesse",
  "aspirateur voiture portable",
  "range documents voiture",
  "chargeur allume cigare usb",
  "jouet chat plume",
  "brosse chien autotoy",
  "gamelle anti glouton",
  "ventilateur usb portable",
  "pochette etanche telephone",
  "chauffe main rechargeable",
  "guirlande lumineuse interieur",
];

/** Pool niches US / GB (anglais). */
const NICHE_POOL_EN = [
  "clear silicone phone case",
  "tempered glass screen protector",
  "gan 65w usb-c charger",
  "braided usb c cable 6ft",
  "magnetic car phone mount",
  "power bank 20000mah",
  "wireless bluetooth earbuds",
  "led ring light selfie",
  "rgb led strip lights wifi",
  "neon led rope light",
  "kitchen drawer organizer",
  "adhesive wall hooks heavy duty",
  "touch bedside lamp",
  "essential oil diffuser",
  "non slip bath mat",
  "makeup sponge blender",
  "makeup brush set",
  "led makeup mirror",
  "jade roller face",
  "spa headband makeup",
  "b7000 glue phone repair",
  "precision screwdriver kit phone",
  "phone screen suction cup",
  "cpu thermal paste",
  "xxl gaming mouse pad",
  "aluminum laptop stand",
  "desk cable organizer",
  "led desk lamp clip",
  "keyboard wrist rest",
  "resistance bands set",
  "stainless steel water bottle",
  "non slip yoga mat",
  "speed jump rope",
  "portable car vacuum",
  "car document holder",
  "cigarette lighter usb charger",
  "cat feather toy",
  "dog self cleaning brush",
  "slow feeder dog bowl",
  "portable usb fan",
  "waterproof phone pouch",
  "rechargeable hand warmer",
  "indoor fairy string lights",
];

/** Pool niches DE. */
const NICHE_POOL_DE = [
  "silikon handyhülle transparent",
  "panzerglas displayschutz",
  "gan 65w usb-c ladegerät",
  "usb c kabel geflochten 2m",
  "magnetische handyhalterung auto",
  "powerbank 20000mah",
  "bluetooth kopfhörer kabellos",
  "led ringlicht selfie",
  "rgb led streifen wifi",
  "neon led lichtschlauch",
  "schubladen organizer küche",
  "klebehaken wand stark",
  "nachttischlampe touch",
  "duftöl diffuser",
  "badematte rutschfest",
  "makeup schwamm blender",
  "makeup pinsel set",
  "led schminkspiegel",
  "jade roller gesicht",
  "spa haarband makeup",
  "b7000 kleber handy reparatur",
  "feinmechanik schraubendreher set",
  "display saugnapf handy",
  "wärmeleitpaste cpu",
  "xxl gaming mauspad",
  "laptop ständer aluminium",
  "kabel organizer schreibtisch",
  "led schreibtischlampe klemme",
  "tastatur handgelenkauflage",
  "fitnessbänder set",
  "edelstahl trinkflasche",
  "yoga matte rutschfest",
  "springseil speed",
  "auto staubsauger tragbar",
  "auto dokumentenmappe",
  "zigarettenanzünder usb ladegerät",
  "katzen spielzeug feder",
  "hunde bürste selbstreinigend",
  "anti schling napf hund",
  "usb ventilator tragbar",
  "wasserdichte handyhülle strand",
  "wiederaufladbarer handwärmer",
  "lichterkette innen",
];

const NICHE_POOL = NICHE_POOL_FR;

function nichePoolForMarket(marketplace = "FR") {
  const m = normalizeMarketCode(marketplace);
  if (m === "US" || m === "GB") return NICHE_POOL_EN;
  if (m === "DE") return NICHE_POOL_DE;
  return NICHE_POOL_FR;
}

/** Boost saisonnier selon mois (1–12) — clés alignées sur le pool actif. */
function seasonalBoosts(month, marketplace = "FR") {
  const m = Number(month) || new Date().getMonth() + 1;
  const market = normalizeMarketCode(marketplace);
  const fr = {
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
  const en = {
    1: ["rechargeable hand warmer", "kitchen drawer organizer", "touch bedside lamp"],
    2: ["jade roller face", "led makeup mirror", "essential oil diffuser"],
    3: ["non slip yoga mat", "resistance bands set", "stainless steel water bottle"],
    4: ["portable car vacuum", "waterproof phone pouch", "indoor fairy string lights"],
    5: ["portable usb fan", "rgb led strip lights wifi", "led ring light selfie"],
    6: ["portable usb fan", "waterproof phone pouch", "neon led rope light"],
    7: ["portable usb fan", "waterproof phone pouch", "stainless steel water bottle"],
    8: ["clear silicone phone case", "tempered glass screen protector", "braided usb c cable 6ft"],
    9: ["aluminum laptop stand", "xxl gaming mouse pad", "desk cable organizer"],
    10: ["led desk lamp clip", "essential oil diffuser", "indoor fairy string lights"],
    11: ["rgb led strip lights wifi", "led ring light selfie", "power bank 20000mah"],
    12: ["indoor fairy string lights", "touch bedside lamp", "power bank 20000mah"],
  };
  const de = {
    1: ["wiederaufladbarer handwärmer", "schubladen organizer küche", "nachttischlampe touch"],
    2: ["jade roller gesicht", "led schminkspiegel", "duftöl diffuser"],
    3: ["yoga matte rutschfest", "fitnessbänder set", "edelstahl trinkflasche"],
    4: ["auto staubsauger tragbar", "wasserdichte handyhülle strand", "lichterkette innen"],
    5: ["usb ventilator tragbar", "rgb led streifen wifi", "led ringlicht selfie"],
    6: ["usb ventilator tragbar", "wasserdichte handyhülle strand", "neon led lichtschlauch"],
    7: ["usb ventilator tragbar", "wasserdichte handyhülle strand", "edelstahl trinkflasche"],
    8: ["silikon handyhülle transparent", "panzerglas displayschutz", "usb c kabel geflochten 2m"],
    9: ["laptop ständer aluminium", "xxl gaming mauspad", "kabel organizer schreibtisch"],
    10: ["led schreibtischlampe klemme", "duftöl diffuser", "lichterkette innen"],
    11: ["rgb led streifen wifi", "led ringlicht selfie", "powerbank 20000mah"],
    12: ["lichterkette innen", "nachttischlampe touch", "powerbank 20000mah"],
  };
  const map = market === "DE" ? de : market === "US" || market === "GB" ? en : fr;
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

function seedsForPeriod(period, now = new Date(), marketplace = "FR") {
  const market = normalizeMarketCode(marketplace);
  const dayOfYear = Math.floor(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      Date.UTC(now.getFullYear(), 0, 0)) /
      86400000
  );
  const nichePool = nichePoolForMarket(market);
  const seasonal = seasonalBoosts(now.getMonth() + 1, market);
  const pool = [...seasonal, ...nichePool.filter((n) => !seasonal.includes(n))];

  // Rotation stable : chaque jour décale la fenêtre dans le pool
  const start = dayOfYear % Math.max(1, pool.length);
  const rotated = pool.slice(start).concat(pool.slice(0, start));

  if (period === "day") {
    return rotated.slice(0, 6);
  }
  if (period === "week") {
    const weekOffset = Math.floor(dayOfYear / 7) % pool.length;
    const weekRot = pool.slice(weekOffset).concat(pool.slice(0, weekOffset));
    return [...new Set([...rotated.slice(0, 4), ...weekRot.slice(0, 8)])].slice(0, 10);
  }
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

function cacheEntryToResult(hit, period, limit, { stale = false } = {}) {
  return {
    items: (hit.items || []).slice(0, limit),
    live: !!hit.live,
    cached: true,
    stale: !!stale,
    period,
    seeds: hit.seeds || [],
    updatedAt: hit.updatedAt || new Date(hit.fetchedAt).toISOString(),
    source: stale ? "cache-stale" : hit.source || "cache",
    algo: hit.algo,
  };
}

/** Snapshot cache immédiat (même expiré) — pour ne jamais bloquer le dashboard. */
function peekTrendingCache({ marketplace = "FR", period = "day", limit = 12 } = {}) {
  const market = normalizeMarketCode(marketplace);
  const key = `${market}:${periodKey(period)}`;
  const hit = loadTrendCache()[key];
  if (!hit?.items?.length) return null;
  const fresh = Date.now() - Number(hit.fetchedAt || 0) < ttlMs(period);
  const result = cacheEntryToResult(hit, period, limit, { stale: !fresh });
  result.marketplace = market;
  return result;
}

const _refreshInFlight = new Map();

function scheduleTrendingRefresh(opts = {}) {
  const marketplace = normalizeMarketCode(opts.marketplace || "FR");
  const period = opts.period || "day";
  const key = `${marketplace}:${periodKey(period)}`;
  if (_refreshInFlight.has(key)) return _refreshInFlight.get(key);
  const p = fetchTrendingProducts({
    ...opts,
    marketplace,
    force: true,
    fast: false,
    maxMs: 45000,
  })
    .catch((err) => {
      console.warn("[EBX] trending background refresh:", err.message);
      return null;
    })
    .finally(() => _refreshInFlight.delete(key));
  _refreshInFlight.set(key, p);
  return p;
}

function withTimeout(promise, ms, label = "timeout") {
  if (!ms || ms <= 0) return promise;
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), ms);
    }),
  ]);
}

/**
 * Récupère / rafraîchit les tendances pour une période.
 * @param {object} opts
 * @param {boolean} [opts.fast] — skip enrich item (rapide, pour dashboard)
 * @param {number} [opts.maxMs] — coupe le live après N ms et renvoie cache/stale/vide
 * @param {boolean} [opts.preferCache] — renvoie cache frais sans recall eBay
 */
async function fetchTrendingProducts({
  marketplace = "FR",
  period = "day",
  force = false,
  limit = 12,
  fast = false,
  maxMs = 0,
  preferCache = false,
} = {}) {
  const now = new Date();
  marketplace = normalizeMarketCode(marketplace);
  const key = `${marketplace}:${periodKey(period, now)}`;
  const cache = loadTrendCache();
  const hit = cache[key];

  if (
    !force &&
    hit &&
    Array.isArray(hit.items) &&
    hit.items.length >= 3 &&
    Date.now() - Number(hit.fetchedAt || 0) < ttlMs(period)
  ) {
    const r = cacheEntryToResult(hit, period, limit, { stale: false });
    r.marketplace = marketplace;
    return r;
  }

  if (preferCache && hit?.items?.length) {
    if (!force) scheduleTrendingRefresh({ marketplace, period, limit });
    const r = cacheEntryToResult(hit, period, limit, {
      stale: Date.now() - Number(hit.fetchedAt || 0) >= ttlMs(period),
    });
    r.marketplace = marketplace;
    return r;
  }

  const livePromise = (async () => {
    const seeds = seedsForPeriod(period, now, marketplace).slice(0, fast ? 4 : undefined);
    const perSeed = fast ? 2 : period === "day" ? 3 : period === "week" ? 3 : 2;
    const all = [];
    let apiOk = false;

    // Parallèle (évite 6× latence séquentielle qui bloque le dashboard)
    const settled = await Promise.allSettled(
      seeds.map((q) => browseSearch(q, { marketplace, limit: perSeed }))
    );
    settled.forEach((res, i) => {
      const q = seeds[i];
      if (res.status !== "fulfilled") {
        console.warn(
          `[EBX] trending seed « ${q} »: ${res.reason?.message?.slice?.(0, 80) || res.reason}`
        );
        return;
      }
      apiOk = true;
      (res.value.items || []).forEach((it, idx) => {
        if (isBlockedTrendTitle(it.title)) return;
        all.push({
          ...it,
          seed: q,
          sold: Number(it.sold) > 0 ? Number(it.sold) : 0,
          soldEstimated: it.soldEstimated !== false && !(Number(it.sold) > 0),
          relevance: perSeed - idx,
        });
      });
    });

    const seen = new Set();
    const candidates = [];
    for (const p of all) {
      const k = String(p.itemId || p.title || "")
        .slice(0, 56)
        .toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      candidates.push(p);
      if (candidates.length >= (fast ? 12 : 28)) break;
    }

    let enriched = candidates;
    if (!fast && candidates.length) {
      try {
        enriched = await enrichBrowseItems(candidates, {
          marketplace,
          limit: Math.min(12, candidates.length),
        });
      } catch (e) {
        console.warn("[EBX] trending enrich:", e.message);
      }
    }

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
        category: p.seed || `eBay ${marketplace}`,
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
      `Niches rotatives ${period} (${seeds.length}) → Browse eBay ${marketplace}` +
      (fast ? " (mode rapide)" : " → fiche item (estimatedSoldQuantity)") +
      `. Exclut VeRO/hazmat. Cache ${Math.round(ttlMs(period) / 3600000)}h.`;

    const payload = {
      items: uniq,
      live: apiOk && uniq.length > 0,
      cached: false,
      stale: false,
      period,
      marketplace,
      seeds,
      updatedAt: now.toISOString(),
      source: apiOk ? (fast ? "eBay Browse fast" : "eBay Browse + item detail") : "empty",
      algo,
    };

    if (uniq.length >= 3) {
      const next = loadTrendCache();
      next[key] = { ...payload, fetchedAt: Date.now(), source: payload.source };
      const cutoff = Date.now() - 40 * 86400000;
      for (const [k, v] of Object.entries(next)) {
        if (Number(v?.fetchedAt || 0) < cutoff) delete next[k];
      }
      saveTrendCache(next);
    }

    return payload;
  })();

  try {
    return await withTimeout(livePromise, maxMs, "trending-timeout");
  } catch (err) {
    if (hit?.items?.length) {
      console.warn(`[EBX] trending timeout/fail → cache: ${err.message}`);
      scheduleTrendingRefresh({ marketplace, period, limit });
      return cacheEntryToResult(hit, period, limit, { stale: true });
    }
    // Pas de cache : laisse le live finir en fond, renvoie vide pour fallback mock UI
    if (/timeout/i.test(err.message)) {
      livePromise.catch(() => {});
      scheduleTrendingRefresh({ marketplace, period, limit });
    }
    throw err;
  }
}

function getCachedTrendingMeta(marketplace = "FR") {
  const market = normalizeMarketCode(marketplace);
  const cache = loadTrendCache();
  const out = {};
  for (const period of ["day", "week", "month"]) {
    const key = `${market}:${periodKey(period)}`;
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
  peekTrendingCache,
  scheduleTrendingRefresh,
  seedsForPeriod,
  periodKey,
  isBlockedTrendTitle,
  getCachedTrendingMeta,
  nichePoolForMarket,
  normalizeMarketCode,
  NICHE_POOL,
  NICHE_POOL_FR,
  NICHE_POOL_EN,
  NICHE_POOL_DE,
  TREND_BLOCK_BRANDS,
};
