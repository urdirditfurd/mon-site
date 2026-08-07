/**
 * EBX Business Engine — capacités niveau Business (sans abonnement).
 * Anti-ban, VeRO, SEO scoring, pilotage.
 */

/** Marques / termes VeRO fréquents (liste locale extensible). */
const VERO_BRANDS = [
  "nike",
  "adidas",
  "jordan",
  "stone island",
  "moncler",
  "canada goose",
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
  "hermès",
  "rolex",
  "dior",
  "balenciaga",
  "supreme",
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

/**
 * Produits souvent refusés sur eBay FR (substances dangereuses / PI_HAZ).
 * Liste heuristique — eBay a le dernier mot.
 */
const HAZARDOUS_PATTERNS = [
  /\bslime\b/i,
  /\bbutter\s*stick\b/i,
  /\bbutter\s*slime\b/i,
  /\bputty\b/i,
  /\bfluffy\s*slime\b/i,
  /\bp[aâ]te\s*[aà]\s*modeler\b/i,
  /\bgel\s*(sticky|collant|souple)\b/i,
  /\bsquishy\b.*\b(gel|slime|butter|putty)\b/i,
  /\b(slime|putty|butter)\b.*\bsquishy\b/i,
  /\bnaphthal(?:ene|ine)\b/i,
  /\bboules?\s+de\s+naphthal/i,
  /\banti[\s-]?mites?\b/i,
  /\bpesticide\b/i,
  /\binsecticide\b/i,
  /\bherbicide\b/i,
  /\bacide\s+(sulfurique|chlorhydrique|nitrique)\b/i,
  /\bchloroforme\b/i,
  /\bm[eé]thanol\b.*\b(pur|absolu)\b/i,
  /\bbatter(?:y|ie)s?\s*(lithium|li[\s-]?ion|18650)\b/i,
  /\blithium[\s-]?ion\b/i,
  /\be[\s-]?liquid\b/i,
  /\bcbd\b|\bcannabis\b|\bthc\b/i,
  /\bnitrous|\bprotoxyde\b/i,
];

function scanHazardous(text) {
  const hay = String(text || "");
  const hits = HAZARDOUS_PATTERNS.filter((re) => re.test(hay)).map((re) =>
    String(re).replace(/^\/|\/[a-z]*$/gi, "").slice(0, 40)
  );
  return {
    ok: hits.length === 0,
    hits,
    level: hits.length === 0 ? "clear" : "block",
    message:
      hits.length === 0
        ? "Aucun signal substances dangereuses"
        : `Risque substances dangereuses eBay FR : ${hits.slice(0, 4).join(", ")}. ` +
          `Souvent refusé (erreur 25019 / PI_HAZ). Change de produit. ` +
          `https://www.ebay.fr/pages/help/policies/hazardous-materials.html`,
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
  return rewriteEbayTitle(productName, keywords);
}

/**
 * Titre eBay « discret » : ne copie pas le titre fournisseur mot pour mot.
 * Réordonne les mots-clés, retire bruit Ali/Amazon, ajoute hooks FR.
 */
function rewriteEbayTitle(productName, keywords = []) {
  let raw = String(productName || "Produit")
    .replace(/[\u4e00-\u9fff]+/g, " ") // chinois
    .replace(/\s*[-–—|]\s*(AliExpress|Amazon|Cdiscount|eBay)\b.*$/gi, " ")
    .replace(/\b(aliexpress|amazon|cdiscount|wish|temu|dropship|ebay)\b/gi, " ")
    .replace(/\b[A-Z]{0,3}\d{5,}\b/g, " ") // codes SKU
    .replace(/\([^)]*type[^)]*\)/gi, " ") // (type TPE/TPR) etc.
    .replace(/[|【】\[\]{}()]/g, " ")
    .replace(/\b(garanti|garantie|authentique|authenticité|réplique|replica)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const stop = new Set([
    "for",
    "with",
    "and",
    "the",
    "new",
    "hot",
    "sale",
    "free",
    "shipping",
    "pcs",
    "pc",
    "set",
    "type",
    "tpe",
    "tpr",
  ]);
  const tokens = raw
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !stop.has(t.toLowerCase()))
    .slice(0, 12);

  const extras = (keywords || [])
    .map((k) => String(k).trim())
    .filter(Boolean)
    .filter((k) => !raw.toLowerCase().includes(k.toLowerCase()))
    .slice(0, 3);

  // Structure différente du titre source : type + usage + bénéfice
  const hooks = ["Compatible", "Pratique", "Compact", "Universal", "Premium"];
  const hook = hooks[tokens.join("").length % hooks.length];
  const core = tokens.slice(0, 6).join(" ");
  // Évite d'ajouter "Livraison rapide" / extras bruyants si le titre FR est déjà riche
  const looksFrProduct = /[àâäéèêëïîôùûüç]/i.test(raw) || /jouet|anti-stress|souple|coque|chargeur/i.test(raw);
  const tail = looksFrProduct ? "" : extras.length ? extras.join(" ") : "Livraison rapide";
  let title = `${hook} ${core} ${tail} Neuf`.replace(/\s+/g, " ").trim();

  // Titres FR longs : version courte orientée bénéfice (style EBX)
  if (looksFrProduct && tokens.length >= 3) {
    const shortCore = tokens.slice(0, 5).join(" ");
    title = `${shortCore} Neuf`.replace(/\s+/g, " ").trim();
    if (title.length < 28) title = `${hook} ${title}`;
  }

  // Si trop proche du titre brut, force un reorder
  const sim = similarityRatio(raw.toLowerCase(), title.toLowerCase());
  if (sim > 0.72 && tokens.length > 3) {
    const rotated = [...tokens.slice(2), ...tokens.slice(0, 2)];
    title = `${rotated.slice(0, 6).join(" ")} Qualité Neuf`.replace(/\s+/g, " ").trim();
  }

  if (title.length > 80) title = title.slice(0, 80).replace(/\s+\S*$/, "").trim();
  // Sécurité : pas de parenthèse ouverte résiduelle
  title = title.replace(/\([^)]*$/g, " ").replace(/\s{2,}/g, " ").trim();
  return title || "Produit Compatible Qualité Premium Neuf".slice(0, 80);
}

function similarityRatio(a, b) {
  if (!a || !b) return 0;
  const ta = new Set(a.split(/\s+/));
  const tb = new Set(b.split(/\s+/));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / Math.max(ta.size, tb.size, 1);
}

/**
 * Prépare un listing discret : titre réécrit + galerie réordonnée
 * (évite de coller photo #1 + titre Ali à l'identique).
 */
function prepareDiscreetListing(scraped = {}, { marginMult = 1.8 } = {}) {
  const bullets = scraped.bullets || [];
  // Mots-clés courts uniquement (évite d'injecter des phrases de bénéfices dans le titre)
  const kwFromBullets = bullets
    .join(" ")
    .split(/[\s,;/|:—-]+/)
    .map((w) => w.trim())
    .filter(
      (w) =>
        w.length > 4 &&
        w.length < 18 &&
        !/matière|durable|compact|taille|surface|cadeau|original|texture|agréable|brand|origin|mainland|china|none|recommend|choice/i.test(
          w
        )
    )
    .slice(0, 4);
  const originalTitle = scraped.title || "Produit";
  const seoTitle = rewriteEbayTitle(originalTitle, kwFromBullets);
  const images = discreetImageOrder(scraped.images || []);
  const product = {
    ...scraped,
    title: seoTitle,
    originalTitle,
    images,
    bullets,
    sections: scraped.sections || [],
    benefits: scraped.benefits || bullets,
    specs: scraped.specs || {},
    short_pitch: scraped.short_pitch || scraped.description || "",
  };
  const cost = Number(scraped.price) || 0;
  return {
    product_name: originalTitle,
    original_title: originalTitle,
    seo_title: seoTitle,
    suggested_price: cost ? Number((cost * marginMult).toFixed(2)) : 29.99,
    images,
    source: scraped.source,
    product,
    discreet: true,
    title_rewritten: seoTitle.toLowerCase() !== String(originalTitle).toLowerCase().slice(0, 80),
  };
}

/** Place une autre vue en premier si la galerie a plusieurs images. */
function discreetImageOrder(images = []) {
  const list = [...(images || [])].filter(Boolean);
  if (list.length < 2) return list;
  // Hero = 2e image (souvent un autre angle), puis le reste, puis l'originale en fin
  const [first, second, ...rest] = list;
  return [second, ...rest, first];
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

/**
 * Calendrier événementiel FR (style EBX) — dates relatives à l'année courante.
 * Dates en calendrier local (pas d'ISO UTC) pour coller au mois affiché.
 */
function getEventCalendar(now = new Date()) {
  const y = now.getFullYear();
  const pad = (n) => String(n).padStart(2, "0");
  const events = [
    { name: "Soldes d'hiver", month: 1, day: 8, durationDays: 28, niche: "Mode & Accessoires", tip: "Lister coques, textiles, soldes early", icon: "❄️" },
    { name: "Saint-Valentin", month: 2, day: 14, durationDays: 1, niche: "Cadeaux / Déco", tip: "Bijoux fantaisie, déco romantique", icon: "💝" },
    { name: "Fête des grand-mères", month: 3, day: 1, durationDays: 1, niche: "Cadeaux", tip: "Cadeaux pratiques, maison", icon: "🎁" },
    { name: "Journée de la femme", month: 3, day: 8, durationDays: 1, niche: "Beauté & Mode", tip: "Maquillage, soins, accessoires femme", icon: "💐" },
    { name: "Printemps", month: 3, day: 20, durationDays: 1, niche: "Jardin / Déco", tip: "Plantes, déco outdoor, DIY", icon: "🌸" },
    { name: "Pâques", month: 4, day: 5, durationDays: 7, niche: "Maison / Enfants", tip: "Déco, jouets, paniers", icon: "🥚" },
    { name: "Fête des mères", month: 5, day: 25, durationDays: 1, niche: "Beauté & Maison", tip: "Soins, déco, bijoux", icon: "💐" },
    { name: "Fête des pères", month: 6, day: 15, durationDays: 1, niche: "High-Tech / Outils", tip: "Gadgets, outils, tech", icon: "🛠️" },
    { name: "Soldes d'été", month: 6, day: 24, durationDays: 28, niche: "Mode & Sport", tip: "Été outdoor, plage, sport", icon: "☀️" },
    { name: "Assomption", month: 8, day: 15, durationDays: 1, niche: "Voyage / Maison", tip: "Bagages, plage, déco été", icon: "⭐" },
    { name: "Rentrée scolaire", month: 9, day: 1, durationDays: 14, niche: "Bureau / High-Tech", tip: "Fournitures, sacs, laptop stands", icon: "📚" },
    { name: "Automne", month: 9, day: 22, durationDays: 1, niche: "Mode / Maison", tip: "Pulls, déco automne, bougies", icon: "🍂" },
    { name: "Halloween", month: 10, day: 31, durationDays: 1, niche: "Déguisements / Déco", tip: "Costumes, LED, déco", icon: "🎃" },
    { name: "Black Friday", month: 11, day: 27, durationDays: 4, niche: "High-Tech", tip: "Électronique, volume max", icon: "🖤" },
    { name: "Cyber Monday", month: 12, day: 1, durationDays: 1, niche: "High-Tech", tip: "Accessoires tech", icon: "💻" },
    { name: "Noël", month: 12, day: 25, durationDays: 1, niche: "Cadeaux", tip: "Lister dès novembre, stock tampon", icon: "🎄" },
  ];

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return events
    .map((e) => {
      const start = new Date(y, e.month - 1, e.day);
      const end = new Date(y, e.month - 1, e.day + (e.durationDays || 1) - 1);
      const prep = new Date(y, e.month - 1, e.day - 21);
      const msDay = 86400000;
      const daysUntil = Math.round((start - today) / msDay);
      let phase = "upcoming";
      if (today >= start && today <= end) phase = "live";
      else if (today >= prep && today < start) phase = "prep";
      else if (today > end) phase = "passed";
      return {
        ...e,
        year: y,
        date: `${y}-${pad(e.month)}-${pad(e.day)}`,
        endDate: `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`,
        endMonth: end.getMonth() + 1,
        endDay: end.getDate(),
        daysUntil,
        phase,
        label:
          phase === "live"
            ? "En cours"
            : phase === "prep"
              ? `Préparer (−${Math.abs(daysUntil)} j)`
              : phase === "passed"
                ? "Passé"
                : `Dans ${daysUntil} j`,
      };
    })
    .sort((a, b) => a.month - b.month || a.day - b.day);
}

/** Niches tendances FR — mix seed + signal classements. */
function getTrendingNiches(rankings = []) {
  const base = [
    { name: "High-Tech & Smartphones", growth: 24, caLabel: "2.5M €", examples: ["chargeur GaN", "coque MagSafe", "écouteurs TWS"], icon: "📱" },
    { name: "Mode & Sneakers", growth: 18, caLabel: "1.8M €", examples: ["sac bandoulière", "lunettes UV", "ceinture"], icon: "👟" },
    { name: "Maison & Déco", growth: 15, caLabel: "1.2M €", examples: ["bande LED", "organiseur", "déco murale"], icon: "🏠" },
    { name: "Beauté & Soins", growth: 21, caLabel: "980k €", examples: ["éponge maquillage", "pinceaux", "miroir LED"], icon: "💄" },
    { name: "Bricolage & Outils", growth: 12, caLabel: "740k €", examples: ["colle B7000", "kit réparation", "outil multifonction"], icon: "🔧" },
    { name: "Sport & Outdoor", growth: 9, caLabel: "620k €", examples: ["bande résistance", "gourde", "tapis yoga"], icon: "🏋️" },
    { name: "Gaming & Setup", growth: 14, caLabel: "890k €", examples: ["tapis XXL", "support manette", "lumière RGB"], icon: "🎮" },
    { name: "Animaux", growth: 11, caLabel: "410k €", examples: ["jouet chat", "harnais", "gamelle"], icon: "🐾" },
  ];

  const catHits = {};
  for (const r of rankings) {
    const c = String(r.category || r.seed || "").trim();
    if (!c) continue;
    catHits[c] = (catHits[c] || 0) + 1;
  }

  return base
    .map((n) => {
      const boost = Object.entries(catHits).some(([k]) =>
        k.toLowerCase().includes(n.name.toLowerCase().slice(0, 4))
      )
        ? 4
        : 0;
      return {
        ...n,
        growth: n.growth + boost,
        signal: boost ? "live" : "seasonal",
      };
    })
    .sort((a, b) => b.growth - a.growth);
}

/** Top vendeurs FR (style EBX dashboard) — seed stable + léger jitter. */
function getTopSellers(marketplace = "FR") {
  const base = [
    { name: "jennifer87aiello", feedback: 100, sales: 450 },
    { name: "techdeals-fr", feedback: 99.6, sales: 2150 },
    { name: "maison_deco_pro", feedback: 99.2, sales: 1280 },
    { name: "gadgetzone24", feedback: 98.9, sales: 980 },
    { name: "beauty_flash_eu", feedback: 99.8, sales: 760 },
    { name: "bricolage_express", feedback: 97.5, sales: 540 },
    { name: "sneakerlab_fr", feedback: 99.1, sales: 1890 },
    { name: "ledworld_shop", feedback: 98.4, sales: 1120 },
  ];
  const day = new Date().getDate();
  return base
    .map((s, i) => ({
      ...s,
      marketplace,
      sales: s.sales + ((day + i * 7) % 40),
      live: true,
    }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 6);
}

/**
 * Estimation du CA marché eBay FR « aujourd'hui » (style ticker EBX).
 *
 * Important : eBay ne publie PAS de GMV temps réel via API publique.
 * EBX affiche un ticker marketing (~150k–300k € / jour FR) — on reproduit
 * une estimation cohérente (progression journée + échantillon tendances),
 * pas le CA de TA boutique (celui-ci reste dans `revenue`).
 */
function getMarketPulse(trending = [], now = new Date(), marketplace = "FR") {
  const market = String(marketplace || "FR")
    .toUpperCase()
    .replace(/^EBAY_/, "");
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const secondsToday = Math.max(0, (now - startOfDay) / 1000);
  const daySeed = now.getFullYear() * 372 + (now.getMonth() + 1) * 31 + now.getDate();
  // Cibles GMV ticker (estimations UX, pas API officielle)
  const targets = {
    FR: 280000,
    DE: 320000,
    GB: 250000,
    US: 900000,
  };
  const base = targets[market] || targets.FR;
  const dailyTarget = base + (daySeed % Math.round(base * 0.4));
  const progress = Math.min(0.98, 0.25 + 0.75 * (secondsToday / 86400));
  const sampleBoost = (trending || []).reduce((s, t) => {
    const price = Number(t.price) || 0;
    const sold = Number(t.sold) || 0;
    return s + Math.min(8000, price * Math.min(sold, 200) * 0.002);
  }, 0);
  const jitter = ((now.getMinutes() * 37 + now.getSeconds()) % 2000) / 100;
  const marketRevenue = Number((dailyTarget * progress + sampleBoost + jitter).toFixed(2));
  const tick = Number((8 + ((now.getSeconds() * 13 + now.getMilliseconds()) % 7000) / 100).toFixed(2));
  const currency = market === "US" || market === "GB" ? (market === "US" ? "USD" : "GBP") : "EUR";
  const labels = {
    FR: "estimation CA marché eBay FR aujourd'hui",
    DE: "Schätzung eBay DE Marktumsatz heute",
    GB: "estimated eBay UK market GMV today",
    US: "estimated eBay US market GMV today",
  };
  return {
    marketRevenue,
    tick,
    marketplace: market,
    currency,
    source: `estimate_${market.toLowerCase()}`,
    label: labels[market] || labels.FR,
    note: "Pas une API eBay officielle — ticker estimé (parité UX EBX). Ton CA boutique est séparé.",
  };
}

/** Heuristique escalade SAV (si IA incertaine / sujet sensible). */
function shouldEscalateSav(text) {
  const t = String(text || "").toLowerCase();
  const triggers = [
    "remboursement",
    "refund",
    "avocat",
    "police",
    "arnaque",
    "fraude",
    "paypal claim",
    "ouverture de litige",
    "litige",
    "retourné",
    "jamais reçu",
    "contrefaçon",
    "vero",
    "menace",
    "tribunal",
  ];
  const hit = triggers.find((x) => t.includes(x));
  return { escalate: Boolean(hit), reason: hit ? `Mot-clé sensible: ${hit}` : "" };
}

function draftSavReplyTemplate({ buyer, subject, body, product } = {}) {
  const name = buyer ? String(buyer) : "Bonjour";
  const soft = shouldEscalateSav(`${subject} ${body}`);
  if (soft.escalate) {
    return {
      draft: `${name},\n\nMerci pour votre message concernant « ${product || "votre commande"} ». Nous avons bien noté votre demande et un conseiller va vous répondre sous 24h avec une solution précise.\n\nCordialement,\nService client`,
      escalate: true,
      reason: soft.reason,
      confidence: 0.35,
    };
  }
  return {
    draft: `${name},\n\nMerci pour votre message. Nous avons bien reçu votre demande${
      subject ? ` (« ${String(subject).slice(0, 60)} »)` : ""
    }.\n\nPouvez-vous nous indiquer votre numéro de commande eBay afin que nous puissions vérifier l'expédition et vous répondre précisément ?\n\nCordialement,\nService client`,
    escalate: false,
    reason: "",
    confidence: 0.7,
  };
}

module.exports = {
  getTopSellers,
  getMarketPulse,
  sleep,
  antiBanDelay,
  scanVero,
  scanHazardous,
  scoreSeoTitle,
  buildAiTitle,
  rewriteEbayTitle,
  prepareDiscreetListing,
  discreetImageOrder,
  estimateMargin,
  buildPilotageFeed,
  getEventCalendar,
  getTrendingNiches,
  shouldEscalateSav,
  draftSavReplyTemplate,
  VERO_BRANDS,
};
