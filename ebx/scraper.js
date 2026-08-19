/**
 * EBX Scrapers — extraction réelle de pages produit / eBay
 * Stratégie : fetch HTML + cheerio, avec fallbacks si bloqué (anti-bot).
 */

const cheerio = require("cheerio");
const fs = require("fs");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);
const {
  normalizeListingLang,
  getListingUi,
  localizeSpecsObject,
  copyMatchesLanguage,
  localizeValue,
  scrubTitleForLanguage,
} = require("./listing-i18n");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const BROWSER_HEADERS = {
  "User-Agent": UA,
  "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Cache-Control": "max-age=0",
  "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

async function fetchHtml(url, extraHeaders = {}) {
  const res = await fetch(url, {
    headers: {
      ...BROWSER_HEADERS,
      ...extraHeaders,
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} pour ${url}`);
  return { html: await res.text(), finalUrl: res.url };
}

/** curl.exe — souvent moins bloqué que fetch() Node sur Windows. */
async function fetchHtmlViaCurl(url) {
  const bin = process.platform === "win32" ? "curl.exe" : "curl";
  const { stdout } = await execFileAsync(
    bin,
    [
      "-sL",
      "--max-time",
      "30",
      "-A",
      UA,
      "-H",
      "Accept-Language: fr-FR,fr;q=0.9",
      "-H",
      "Accept: text/html,application/xhtml+xml",
      "-H",
      "Sec-Fetch-Dest: document",
      "-H",
      "Sec-Fetch-Mode: navigate",
      url,
    ],
    { maxBuffer: 12 * 1024 * 1024, windowsHide: true }
  );
  if (!stdout || stdout.length < 500) throw new Error("curl: réponse vide");
  return { html: stdout, finalUrl: url };
}

/**
 * Chrome/Edge installé (playwright-core) — contournement anti-bot Amazon sur Windows.
 * Pas de téléchargement Chromium : utilise le navigateur déjà présent.
 */
function windowsBrowserCandidates() {
  const local = process.env.LOCALAPPDATA || "";
  const pf = process.env["ProgramFiles"] || "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  return [
    { channel: "chrome" },
    { channel: "msedge" },
    { executablePath: `${pf}\\Google\\Chrome\\Application\\chrome.exe` },
    { executablePath: `${pf86}\\Google\\Chrome\\Application\\chrome.exe` },
    { executablePath: `${local}\\Google\\Chrome\\Application\\chrome.exe` },
    { executablePath: `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe` },
    { executablePath: `${pf}\\Microsoft\\Edge\\Application\\msedge.exe` },
    // Pas de channel chromium (exige npx playwright install) — Chrome/Edge système uniquement
  ];
}

function linuxBrowserCandidates() {
  const paths = [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/opt/google/chrome/chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
  ];
  const out = [{ channel: "chrome" }];
  for (const executablePath of paths) {
    if (fs.existsSync(executablePath)) out.push({ executablePath });
  }
  out.push({ channel: "chromium" });
  return out;
}

function browserLaunchCandidates() {
  return process.platform === "win32" ? windowsBrowserCandidates() : linuxBrowserCandidates();
}

async function fetchHtmlViaChrome(url, { waitMs = 3500, extraHeaders = {} } = {}) {
  let chromium;
  try {
    ({ chromium } = require("playwright-core"));
  } catch {
    throw new Error("playwright-core non installé — dans le dossier ebx: npm install");
  }

  const launches = browserLaunchCandidates();

  let lastErr = null;
  for (const opt of launches) {
    let browser;
    try {
      browser = await chromium.launch({
        ...opt,
        headless: true,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--window-size=1365,900",
        ],
      });
      const context = await browser.newContext({
        userAgent: UA,
        locale: "fr-FR",
        viewport: { width: 1365, height: 900 },
        extraHTTPHeaders: { "Accept-Language": "fr-FR,fr;q=0.9", ...extraHeaders },
      });
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      // Attend les cartes produit Amazon
      try {
        await page.waitForSelector('[data-component-type="s-search-result"], #productTitle, #dp', {
          timeout: 12000,
        });
      } catch (_) {
        await new Promise((r) => setTimeout(r, waitMs));
      }
      await new Promise((r) => setTimeout(r, 800));
      const html = await page.content();
      const finalUrl = page.url();
      await browser.close();
      if (html.length < 2000) throw new Error("Chrome: HTML trop court");
      if (isAmazonBlockedHtml(html)) throw new Error("Chrome: captcha Amazon toujours présent");
      const label = opt.channel || opt.executablePath || "browser";
      console.log(`[fetch chrome] OK via ${label} len=${html.length}`);
      return { html, finalUrl };
    } catch (e) {
      lastErr = e;
      try {
        if (browser) await browser.close();
      } catch (_) {}
    }
  }
  throw lastErr || new Error("Chrome/Edge introuvable — installe Google Chrome");
}

/** Essaie fetch → curl → Chrome jusqu'à obtenir une page exploitable. */
async function fetchHtmlResilient(url, { preferChrome = false, extraHeaders = {} } = {}) {
  const attempts = preferChrome
    ? [
        () => fetchHtmlViaChrome(url, { extraHeaders }),
        () => fetchHtml(url, extraHeaders),
        () => fetchHtmlViaCurl(url),
      ]
    : [
        () => fetchHtml(url, extraHeaders),
        () => fetchHtmlViaCurl(url),
        () => fetchHtmlViaChrome(url, { extraHeaders }),
      ];
  let lastErr = null;
  for (const run of attempts) {
    try {
      const out = await run();
      if (out?.html && out.html.length > 800) return out;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error(`fetchHtmlResilient failed: ${url}`);
}

function isAmazonBlockedHtml(html = "") {
  const h = String(html || "").slice(0, 8000);
  return /opfcaptcha|validateCaptcha|api\/challenge|sorry\/index|robot check|enter the characters|automated access/i.test(
    h
  );
}

function absUrl(base, src) {
  if (!src) return null;
  try {
    return new URL(src, base).href;
  } catch {
    return null;
  }
}

function cleanText(t) {
  return String(t || "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Nettoie un texte produit scrapé (Amazon A+ injecte CSS/JS dans le DOM text).
 * Garde uniquement du langage naturel lisible pour eBay / "Pourquoi ce produit".
 */
function sanitizeReadableText(raw, { maxLen = 700 } = {}) {
  let t = String(raw || "");
  if (!t) return "";
  // Blocs CSS / selecteurs / JS fréquents sur Amazon A+
  t = t.replace(/\/\*[\s\S]*?\*\//g, " ");
  t = t.replace(/\{[^{}]*\}/g, " ");
  t = t.replace(/function\s+\w*\s*\([^)]*\)\s*\{[\s\S]*?\}/g, " ");
  t = t.replace(/\b(?:var|let|const|if|else|return|window|document)\b[^.;]{0,80}[;)]/gi, " ");
  t = t.replace(/\.aplus-[\w.-]+/gi, " ");
  t = t.replace(/\.container-[\w.-]+/gi, " ");
  t = t.replace(/\.launchpad-[\w.-]+/gi, " ");
  t = t.replace(/#[\w-]+\s+/g, " ");
  t = t.replace(/\b(?:position|overflow|display|margin|padding|width|height|background|font-size|max-width)\s*:\s*[^;]+;?/gi, " ");
  t = t.replace(/https?:\/\/\S+/gi, " ");
  t = t.replace(/[{};<>]|={2,}/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  // Si ça ressemble encore à du code / CSS, abandonner
  const codeScore =
    (t.match(/\b(?:aplus|function|shoppable|fixed-width|margin-left)\b/gi) || []).length +
    (t.includes("{") || t.includes("}") ? 2 : 0);
  if (codeScore >= 2 || t.length < 40) return "";
  // Phrases trop techniques sans lettres accentuées/mots utiles
  const letters = (t.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
  if (letters / Math.max(t.length, 1) < 0.55) return "";
  return t.slice(0, maxLen);
}

/** Déduplique les images produit (Amazon renvoie souvent 8× la même en tailles différentes) */
function uniqueProductImages(urls, { limit = 8 } = {}) {
  const seen = new Set();
  const out = [];
  for (const raw of urls || []) {
    if (!raw) continue;
    let u = String(raw).trim();
    if (!/^https?:\/\//i.test(u)) continue;
    if (/spinner|grey-pixel|pixel|sprite|transparent-pixel|base64/i.test(u)) continue;
    // Normalise la clé Amazon: /images/I/XXXXX._AC_SL1500_.jpg → XXXXX
    const idMatch = u.match(/\/images\/I\/([A-Za-z0-9%+-]+)/i) || u.match(/\/I\/([A-Za-z0-9%+-]+)/i);
    let key = idMatch ? idMatch[1].split(".")[0].toLowerCase() : u.replace(/\._[^.\/]+_\./g, ".").split("?")[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // Préfère une version hi-res si possible
    if (/media-amazon|ssl-images-amazon/i.test(u)) {
      u = u.replace(/\._[A-Z0-9,_]+(?=\.\w+$)/i, "._AC_SL1500_");
    }
    out.push(u);
    if (out.length >= limit) break;
  }
  return out;
}

function detectSource(url) {
  const u = url.toLowerCase();
  if (u.includes("amazon.")) return "amazon";
  if (u.includes("aliexpress.")) return "aliexpress";
  if (u.includes("ebay.")) return "ebay";
  if (u.includes("cdiscount.")) return "cdiscount";
  return "generic";
}

function parseAmazon($, baseUrl) {
  const title =
    cleanText($("#productTitle").text()) ||
    cleanText($("meta[property='og:title']").attr("content")) ||
    cleanText($("title").text());

  const priceText =
    cleanText($(".a-price .a-offscreen").first().text()) ||
    cleanText($("#corePrice_feature_div .a-offscreen").first().text()) ||
    cleanText($("#corePriceDisplay_desktop_feature_div .a-offscreen").first().text()) ||
    cleanText($("#priceblock_ourprice").text()) ||
    cleanText($("#priceblock_dealprice").text()) ||
    cleanText($("#price_inside_buybox").text()) ||
    cleanText($("input#twister-plus-price-data-price").attr("value")) ||
    cleanText($("[data-a-color='price'] .a-offscreen").first().text());
  let price = parsePrice(priceText);
  if (!(price > 0)) {
    const html = $.root().html() || "";
    const m =
      html.match(/"priceAmount"\s*:\s*([\d.]+)/i) ||
      html.match(/"displayPrice"\s*:\s*"([^"]+)"/i) ||
      html.match(/data-a-color="price"[^>]*>[\s\S]*?a-offscreen[^>]*>([^<]+)/i);
    if (m) price = parsePrice(m[1]);
  }

  const bullets = [];
  $("#feature-bullets li span.a-list-item").each((_, el) => {
    const t = cleanText($(el).text());
    if (t && t.length > 5 && !t.toLowerCase().includes("cliquez ici")) bullets.push(t);
  });

  const images = new Set();
  const og = $("meta[property='og:image']").attr("content");
  if (og) images.add(og);
  $("#imgTagWrapperId img, #landingImage, #main-image, #altImages img, #imageBlock img").each((_, el) => {
    const src =
      $(el).attr("data-old-hires") ||
      $(el).attr("data-a-hires") ||
      $(el).attr("data-src") ||
      $(el).attr("src");
    const u = absUrl(baseUrl, src);
    if (u) images.add(u);
  });
  // dynamic image data
  const dynamic = $("#imgTagWrapperId img, #landingImage").attr("data-a-dynamic-image");
  if (dynamic) {
    try {
      Object.keys(JSON.parse(dynamic)).forEach((k) => images.add(k));
    } catch (_) {}
  }
  // Scripts colorImages / imageGalleryData
  $("script").each((_, el) => {
    const txt = $(el).html() || "";
    if (!/colorImages|hiRes|large"|"main"/.test(txt)) return;
    const re = /https?:\/\/[^"'\\\s]+?\.(?:jpg|jpeg|png|webp)/gi;
    const matches = txt.match(re) || [];
    matches.forEach((u) => {
      if (/media-amazon|ssl-images-amazon/i.test(u)) images.add(u.replace(/\\u002F/g, "/"));
    });
  });

  const description =
    sanitizeReadableText(cleanText($("#productDescription p").text())) ||
    sanitizeReadableText(bullets.slice(0, 3).join(" ")) ||
    sanitizeReadableText(cleanText($("#feature-bullets").text()).slice(0, 800)) ||
    "";

  return {
    source: "amazon",
    title: title || "Produit Amazon",
    price,
    currency: "EUR",
    bullets: bullets.slice(0, 8),
    description:
      description ||
      (bullets[0] ? sanitizeReadableText(bullets.slice(0, 2).join(" ")) : "") ||
      "Produit sélectionné pour sa qualité et son potentiel eBay.",
    images: uniqueProductImages([...images], { limit: 8 }),
    url: baseUrl,
  };
}

function isBlockedSupplierHtml(html = "", title = "") {
  const h = String(html || "");
  const t = String(title || "");
  return (
    /_____tmd_____|punish\?|Captcha Interception|unusual traffic|x5secdata|access denied|robot check/i.test(
      h.slice(0, 8000)
    ) || /captcha|punish|accès refusé|access denied/i.test(t)
  );
}

function extractAliProductId(url = "") {
  const m = String(url).match(/\/item\/(\d{6,})/i) || String(url).match(/[?&]productId=(\d{6,})/i);
  return m ? m[1] : null;
}

function normalizeForMatch(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function queryTokens(query) {
  const stop = new Set(["les", "des", "une", "pour", "avec", "the", "and", "for", "sans", "dans"]);
  return normalizeForMatch(query)
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !stop.has(t));
}

/**
 * Titre injecté du type "poncho — AliExpress" (le mot-clé est dans le titre
 * parce qu'on l'a collé, pas parce que le produit matche).
 */
function isPlaceholderSupplierTitle(title, query) {
  const t = normalizeForMatch(title);
  const q = normalizeForMatch(query);
  if (!t) return true;
  if (!q) return false;
  if (t === q) return true;
  const stripped = t
    .replace(/\b(aliexpress|amazon|cdiscount|ebay)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped || stripped === q) return true;
  return false;
}

/**
 * Titre produit vs mot-clé utilisateur — tous les tokens significatifs doivent matcher.
 * "poncho" ≠ garde-boue moto ; "flintronic" seul ≠ poncho.
 */
function titleMatchesQuery(title, query) {
  const tokens = queryTokens(query);
  if (!tokens.length) return true;
  if (isPlaceholderSupplierTitle(title, query)) return false;
  const t = normalizeForMatch(title);
  if (!t || t.length < 4) return false;
  return tokens.every((tok) => {
    if (t.includes(tok)) return true;
    if (tok.endsWith("s") && tok.length > 3 && t.includes(tok.slice(0, -1))) return true;
    if (!tok.endsWith("s") && t.includes(tok + "s")) return true;
    return false;
  });
}

function marketplaceOf(p) {
  const s = `${p?.source || ""} ${p?.url || ""}`.toLowerCase();
  if (/aliexpress/.test(s)) return "aliexpress";
  if (/amazon/.test(s)) return "amazon";
  if (/cdiscount/.test(s)) return "cdiscount";
  return "";
}

/**
 * 1 meilleure offre par marketplace (Amazon / Ali / Cdiscount), triées par prix.
 * On ne remplace jamais Ali/Cdiscount par un 2e Amazon moins cher.
 * Si un site n'a rien, on complète avec d'autres fiches pour viser 3 cartes.
 */
function rankSupplierOffers(items, query, { limit = 3, priceMin = 0, priceMax = Infinity } = {}) {
  const seen = new Set();
  const filtered = [];
  for (const p of items || []) {
    if (!p?.url) continue;
    const key = String(p.url).split("?")[0].replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) continue;
    if (!titleMatchesQuery(p.title, query)) continue;
    const isAli = marketplaceOf(p) === "aliexpress";
    let price = Number(p.price);
    if (isAli) price = sanitizeAliExpressPrice(price, p.title) || 0;
    else price = sanitizeProductPrice(price, p.title) || 0;
    if (!(price > 0)) continue;
    if (price < priceMin || price > priceMax) continue;
    if (price > 400) continue;
    seen.add(key);
    filtered.push({
      ...p,
      price,
      source: marketplaceOf(p) || String(p.source || "fournisseur").replace(/\+.*/, "") || "fournisseur",
    });
  }
  filtered.sort((a, b) => a.price - b.price);

  const max = Math.max(1, Number(limit) || 3);
  const bySrc = { amazon: [], aliexpress: [], cdiscount: [] };
  for (const p of filtered) {
    const k = marketplaceOf(p);
    if (k && bySrc[k]) bySrc[k].push(p);
  }

  const picked = [];
  const pickedUrls = new Set();
  const take = (p) => {
    if (!p?.url || picked.length >= max) return false;
    const key = String(p.url).split("?")[0].toLowerCase();
    if (pickedUrls.has(key)) return false;
    pickedUrls.add(key);
    picked.push(p);
    return true;
  };

  // 1) meilleure fiche de chaque site (même si plus chère qu'un 2e Amazon)
  for (const src of ["amazon", "aliexpress", "cdiscount"]) {
    if (bySrc[src][0]) take(bySrc[src][0]);
  }
  // 2) si un site est vide, on complète pour viser 3
  if (picked.length < Math.min(max, 3)) {
    for (const p of filtered) {
      if (picked.length >= Math.min(max, 3)) break;
      take(p);
    }
  }
  return picked.sort((a, b) => a.price - b.price);
}

const ALI_CNY_EUR = 0.127;
const ALI_USD_EUR = 0.92;

function detectAliCurrency(text) {
  const s = String(text || "");
  if (/€|\bEUR\b/i.test(s)) return "EUR";
  if (/(?:US\s*)?\$|\bUSD\b/i.test(s) && !/AU\$|C\$|CA\$/i.test(s)) return "USD";
  if (/¥|￥|\bCNY\b|\bRMB\b|CN¥/i.test(s)) return "CNY";
  if (/£|\bGBP\b/i.test(s)) return "GBP";
  return "";
}

/** Convertit un montant AliExpress vers EUR (CNY/USD souvent lus à tort comme euros). */
function aliMoneyToEur(amount, currency = "", formatted = "") {
  const cur = String(currency || detectAliCurrency(formatted) || detectAliCurrency(amount) || "").toUpperCase();
  let n = Number(String(amount).replace(",", "."));
  if (!(n > 0)) {
    n = parsePrice(formatted || amount);
  }
  if (!(n > 0)) return null;
  // Centimes (2147.33 → 21.47 CNY)
  if (n >= 1000) n = n / 100;
  let eur = n;
  if (cur === "CNY" || cur === "RMB") eur = n * ALI_CNY_EUR;
  else if (cur === "USD" || cur === "US") eur = n * ALI_USD_EUR;
  else if (cur === "GBP") eur = n * 1.17;
  else if (!cur && n >= 18) {
    // Montant nu typique CNY (21.47 ¥ ≠ 21.47 €)
    eur = n * ALI_CNY_EUR;
  }
  if (eur < 1.99 || eur > 800) return null;
  return Math.round(eur * 100) / 100;
}

function isPlausibleAliEuro(n) {
  const p = Number(n);
  return p >= 1.99 && p <= 150;
}

/** Médiane des prix Ali plausibles — ignore 1,00 € (leurre / livraison). */
function pickPlausibleAliEuro(values) {
  const band = (values || []).filter((v) => Number(v) >= 1.99 && Number(v) <= 150);
  if (!band.length) return null;
  const sorted = [...band].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const tight = sorted.filter((v) => v >= med * 0.4 && v <= Math.max(med * 3, med + 25));
  const use = tight.length ? tight : sorted;
  return use[Math.floor(use.length / 2)];
}

function extractEuroPricesFromHtml(html) {
  const raw = String(html || "");
  const euros = [];
  const re = /(?:€|EUR)\s*(\d+[.,]\d{2})|(\d+[.,]\d{2})\s*(?:€|EUR)/gi;
  let m;
  while ((m = re.exec(raw)) && euros.length < 40) {
    const ctx = raw.slice(Math.max(0, m.index - 48), m.index + 48);
    if (/livraison|shipping|postage|frais de port|delivery|s&h|port offert/i.test(ctx)) continue;
    const p = aliMoneyToEur(m[1] || m[2], "EUR");
    if (p >= 1.99 && p <= 150) euros.push(p);
  }
  return pickPlausibleAliEuro(euros);
}

const ALI_EUR_COOKIE =
  "aep_usuc_f=site=fra&c_tp=EUR&region=FR&b_locale=fr_FR&ae_u_p_s=2; intl_locale=fr_FR";

/**
 * Résout un prix AliExpress (EUR) via mobile / fiche / Bing — même si la page PC est captcha.
 */
async function fetchAliExpressMeta(productIdOrUrl, titleHint = "") {
  const id = /^\d{6,}$/.test(String(productIdOrUrl || ""))
    ? String(productIdOrUrl)
    : extractAliProductId(productIdOrUrl);
  if (!id) return { price: null, title: "" };

  const tryParseHtml = (html) => {
    const out = { price: null, title: "" };
    if (!html || html.length < 400) return out;
    if (isBlockedSupplierHtml(html)) return out;
    const emb = extractAliExpressEmbedded(html);
    if (emb.title && emb.title.length > 8) out.title = emb.title;
    if (emb.price > 0) out.price = emb.price;
    if (out.price > 0 && out.title) return out;
    const meta =
      html.match(/itemprop=["']price["'][^>]*content=["']([\d.]+)["']/i) ||
      html.match(/content=["']([\d.]+)["'][^>]*itemprop=["']price["']/i);
    if (meta) {
      const p = aliMoneyToEur(meta[1], "EUR");
      if (p >= 1.99) out.price = p;
    }
    if (!(out.price >= 1.99)) {
      const clustered = extractEuroPricesFromHtml(html);
      if (clustered >= 1.99) out.price = clustered;
    }
    const og =
      html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<title>([^<]{8,180})<\/title>/i);
    if (!out.title && og) {
      out.title = cleanText(og[1]).replace(/\s*[-–|]\s*AliExpress.*$/i, "").trim();
    }
    return out;
  };

  let best = { price: null, title: "" };
  const urls = [
    `https://m.aliexpress.com/item/${id}.html`,
    `https://www.aliexpress.com/item/${id}.html`,
    `https://fr.aliexpress.com/item/${id}.html`,
  ];

  for (const url of urls) {
    try {
      const { html } = await fetchHtmlResilient(url, {
        preferChrome: process.platform === "win32",
        extraHeaders: {
          Referer: "https://fr.aliexpress.com/",
          "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
          Cookie: ALI_EUR_COOKIE,
        },
      });
      const parsed = tryParseHtml(html);
      if (parsed.title && parsed.title.length > 8) best.title = parsed.title;
      if (parsed.price > 0) {
        best.price = parsed.price;
        if (best.title) return best;
      }
    } catch (_) {}
  }

  try {
    const via = await scrapeProductViaJina(`https://m.aliexpress.com/item/${id}.html`);
    if (via?.title && String(via.title).length > 8 && !best.title) best.title = cleanText(via.title);
    const p = aliMoneyToEur(via?.price, detectAliCurrency(`${via?.price} ${via?.title}`) || "", String(via?.price || ""));
    if (p > 0) best.price = p;
    if (best.price > 0 && best.title) return best;
  } catch (_) {}

  if (!(best.price > 0)) {
    try {
      const resolved = await resolvePriceViaSearch(`https://fr.aliexpress.com/item/${id}.html`, titleHint);
      if (resolved > 0) best.price = resolved;
    } catch (_) {}
  }

  if (!(best.price > 0)) {
    try {
      const hits = await searchViaDuckDuckGo(`${id} aliexpress € OR EUR OR prix`, {
        limit: 8,
        linkTest: (link) => link.includes(id) || /aliexpress/i.test(link),
      });
      const found = [];
      for (const hit of hits) {
        const blob = `${hit.title || ""} ${hit.snippet || ""}`;
        const euroRe = /(?:€|EUR)\s*(\d+[.,]\d{2})|(\d+[.,]\d{2})\s*(?:€|EUR)/gi;
        let em;
        while ((em = euroRe.exec(blob))) {
          const ok = aliMoneyToEur(em[1] || em[2], "EUR");
          if (ok) found.push(ok);
        }
      }
      const med = pickPlausibleAliEuro(found);
      if (med > 0) best.price = med;
    } catch (_) {}
  }

  return best;
}

async function fetchAliExpressPrice(productIdOrUrl, titleHint = "") {
  const meta = await fetchAliExpressMeta(productIdOrUrl, titleHint);
  return meta.price > 0 ? meta.price : null;
}

/**
 * Mode loop : plusieurs sources jusqu’à un prix EUR plausible.
 * Rejette 1,00 € (leurre / livraison).
 */
async function confirmAliPriceLoop(url, titleHint = "", { attempts = 4, onLog } = {}) {
  const log = (m) => {
    if (typeof onLog === "function") {
      try {
        onLog(m);
      } catch (_) {}
    }
  };
  const samples = [];
  let title = String(titleHint || "");
  const push = (p) => {
    if (isPlausibleAliEuro(p)) samples.push(Number(p));
  };

  for (let i = 0; i < attempts; i++) {
    log(`[aliexpress] loop prix ${i + 1}/${attempts}…`);
    try {
      const meta = await fetchAliExpressMeta(url, title);
      if (meta.title && meta.title.length > 8) title = meta.title;
      push(meta.price);
    } catch (_) {}

    if (samples.length < 2) {
      try {
        push(await resolvePriceViaSearch(url, title));
      } catch (_) {}
    }

    const pick = pickPlausibleAliEuro(samples);
    if (pick && (samples.length >= 2 || (i >= 1 && pick >= 2.5))) {
      log(`[aliexpress] loop OK ${pick.toFixed(2)}€ (${samples.length} échantillon(s))`);
      return { price: pick, title, attempts: i + 1, samples: [...samples] };
    }
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, 260 + i * 140));
    }
  }

  const pick = pickPlausibleAliEuro(samples);
  if (pick) {
    log(`[aliexpress] loop médiane ${pick.toFixed(2)}€`);
    return { price: pick, title, attempts, samples: [...samples] };
  }
  log(`[aliexpress] loop: prix non confirmé`);
  return { price: null, title, attempts, samples: [...samples] };
}

/** Parse le JSON produit embarqué (runParams / imagePathList / props). */
function extractAliExpressEmbedded(html = "") {
  const out = {
    title: "",
    price: null,
    images: [],
    bullets: [],
    specs: {},
    description: "",
  };
  const raw = String(html || "");
  if (!raw || raw.length < 500) return out;

  const subject =
    raw.match(/"subject"\s*:\s*"((?:\\.|[^"\\]){8,280})"/) ||
    raw.match(/"title"\s*:\s*"((?:\\.|[^"\\]){8,280})"/);
  if (subject) {
    try {
      out.title = cleanText(JSON.parse(`"${subject[1]}"`));
    } catch {
      out.title = cleanText(subject[1].replace(/\\u[\dA-Fa-f]{4}/g, (m) =>
        String.fromCharCode(parseInt(m.slice(2), 16))
      ).replace(/\\"/g, '"'));
    }
  }

  const euros = [];
  const pushEur = (v) => {
    const n = Number(v);
    if (n > 0.4 && n < 800) euros.push(n);
  };

  const formattedRe = [
    /"formatedActivityPrice"\s*:\s*"([^"]+)"/gi,
    /"formatedPrice"\s*:\s*"([^"]+)"/gi,
    /"formatTradePrice"\s*:\s*"([^"]+)"/gi,
    /"salePriceString"\s*:\s*"([^"]+)"/gi,
    /"formatedAmount"\s*:\s*"([^"]+)"/gi,
  ];
  for (const re of formattedRe) {
    let fm;
    while ((fm = re.exec(raw)) && euros.length < 40) {
      const cur = detectAliCurrency(fm[1]);
      if (!cur) continue;
      pushEur(aliMoneyToEur(parsePrice(fm[1]), cur, fm[1]));
    }
  }

  const objRe =
    /"(?:sku(?:Activity)?Amount|minAmount|maxAmount|targetSkuPriceInfo)"\s*:\s*\{([^}]{0,420})\}/gi;
  let om;
  while ((om = objRe.exec(raw)) && euros.length < 50) {
    const block = om[1];
    const formatted =
      (block.match(/formatedAmount"\s*:\s*"([^"]+)"/i) ||
        block.match(/formatedPrice"\s*:\s*"([^"]+)"/i) ||
        [])[1] || "";
    const currency =
      (block.match(/currency(?:Code)?"\s*:\s*"([A-Z]{3})"/i) || [])[1] || detectAliCurrency(formatted + block);
    const value = (block.match(/"value"\s*:\s*"?([\d.]+)/i) || [])[1];
    if (formatted && detectAliCurrency(formatted)) {
      pushEur(aliMoneyToEur(parsePrice(formatted), detectAliCurrency(formatted), formatted));
    } else if (value) {
      pushEur(aliMoneyToEur(value, currency || "CNY"));
    }
  }

  // Prix d'origine vendeur (presque toujours CNY) — ne jamais lire comme EUR
  const multiCur = /"actSkuMultiCurrencyCalPrice"\s*:\s*"?([\d.]+)"?/gi;
  let sm;
  while ((sm = multiCur.exec(raw)) && euros.length < 50) {
    pushEur(aliMoneyToEur(sm[1], "CNY"));
  }

  const eurFmt = euros.filter((p) => p >= 1.99 && p <= 150);
  if (eurFmt.length) out.price = pickPlausibleAliEuro(eurFmt);

  const imgBlock = raw.match(/"imagePathList"\s*:\s*\[([^\]]{20,8000})\]/);
  if (imgBlock) {
    const urls = imgBlock[1].match(/https?:\\?\/\\?\/[^"\\]+/g) || [];
    urls.forEach((u) => {
      const fixed = u.replace(/\\u002F/g, "/").replace(/\\\//g, "/");
      if (/alicdn|aliexpress-media/i.test(fixed)) out.images.push(fixed.startsWith("http") ? fixed : `https:${fixed}`);
    });
  }
  const looseImgs = raw.match(/https?:\\?\/\\?\/ae\d*\.alicdn\.com[^"'\\\s]+?\.(?:jpg|jpeg|png|webp)/gi) || [];
  looseImgs.slice(0, 20).forEach((u) => {
    out.images.push(u.replace(/\\u002F/g, "/").replace(/\\\//g, "/"));
  });

  // Propriétés / specs
  const propRe =
    /"attrName"\s*:\s*"((?:\\.|[^"\\])+)"\s*,\s*"attrValue"\s*:\s*"((?:\\.|[^"\\])+)"/g;
  let pm;
  while ((pm = propRe.exec(raw)) && Object.keys(out.specs).length < 16) {
    let k = pm[1];
    let v = pm[2];
    try {
      k = JSON.parse(`"${k}"`);
      v = JSON.parse(`"${v}"`);
    } catch {
      k = k.replace(/\\"/g, '"');
      v = v.replace(/\\"/g, '"');
    }
    k = cleanText(k);
    v = cleanText(v);
    if (k && v && v.length < 120 && !/undefined|null/i.test(v)) {
      out.specs[k] = v;
      const bullet = `${k} : ${v}`;
      if (bullet.length > 8 && bullet.length < 160) out.bullets.push(bullet);
    }
  }

  const descMatch =
    raw.match(/"productDescription"\s*:\s*"((?:\\.|[^"\\]){20,1200})"/) ||
    raw.match(/"description"\s*:\s*"((?:\\.|[^"\\]){40,1200})"/);
  if (descMatch) {
    try {
      out.description = sanitizeReadableText(JSON.parse(`"${descMatch[1]}"`), { maxLen: 900 });
    } catch {
      out.description = sanitizeReadableText(descMatch[1], { maxLen: 900 });
    }
  }

  return out;
}

function parseAliExpress($, baseUrl, rawHtml = "") {
  const html = rawHtml || $.root().html() || "";
  const embedded = extractAliExpressEmbedded(html);

  const jsonLdTitle = (() => {
    let found = "";
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html() || "{}");
        const node = Array.isArray(data) ? data[0] : data;
        if (node?.name) found = cleanText(node.name);
        if (node?.offers?.price && embedded.price == null) {
          const p = aliMoneyToEur(
            node.offers.price,
            node.offers.priceCurrency || node.offers.priceCurrencyCode || "EUR"
          );
          if (p >= 1.99) embedded.price = p;
        }
        if (node?.image) {
          const imgs = Array.isArray(node.image) ? node.image : [node.image];
          imgs.forEach((u) => embedded.images.push(String(u)));
        }
      } catch (_) {}
    });
    return found;
  })();

  const title =
    embedded.title ||
    cleanText($("h1").first().text()) ||
    cleanText($("meta[property='og:title']").attr("content")) ||
    jsonLdTitle ||
    cleanText($("title").text());

  if (isBlockedSupplierHtml(html, title)) {
    return {
      source: "aliexpress",
      title: "",
      price: null,
      currency: "EUR",
      bullets: [],
      specs: {},
      description: "",
      images: [],
      url: baseUrl,
      blocked: true,
    };
  }

  const priceText =
    cleanText($("[class*='price']").first().text()) ||
    cleanText($("meta[property='og:price:amount']").attr("content"));
  let price = sanitizeAliExpressPrice(embedded.price || parsePrice(priceText), title);

  const images = new Set(embedded.images || []);
  const og = $("meta[property='og:image']").attr("content");
  if (og) images.add(og);
  $("img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || $(el).attr("data-srcset");
    const u = absUrl(baseUrl, String(src || "").split(" ")[0]);
    if (u && /alicdn|aliexpress-media/i.test(u) && u.length > 40) images.add(u.split("?")[0]);
  });

  const bullets = [...(embedded.bullets || [])];
  $("li, .product-property-item, [class*='specification'] span, [class*='Attribute']").each((_, el) => {
    const t = sanitizeReadableText(cleanText($(el).text()), { maxLen: 180 });
    if (t && t.length > 12 && t.length < 180 && !bullets.includes(t)) bullets.push(t);
  });
  const metaDesc = sanitizeReadableText(cleanText($("meta[name='description']").attr("content") || ""), {
    maxLen: 700,
  });
  if (metaDesc) {
    metaDesc.split(/[.;|]/).forEach((part) => {
      const p = part.trim();
      if (p.length > 20 && p.length < 160 && bullets.length < 8) bullets.push(p);
    });
  }

  const specs = { ...(embedded.specs || {}) };
  const description =
    embedded.description ||
    metaDesc ||
    (bullets[0] ? bullets.slice(0, 3).join(". ") : "") ||
    "";

  return {
    source: "aliexpress",
    title: title || "",
    price,
    currency: "EUR",
    bullets: bullets.slice(0, 10),
    specs,
    description,
    images: uniqueProductImages([...images], { limit: 10 }),
    url: baseUrl,
  };
}

/**
 * Fallback quand AliExpress renvoie un captcha : titre + snippet via DDG/Bing,
 * puis images/specs via pages miroir qui réutilisent le même contenu alicdn.
 */
async function scrapeAliExpressViaWebFallback(url) {
  const productId = extractAliProductId(url);
  if (!productId) throw new Error("AliExpress: ID produit introuvable dans l'URL");

  const queries = [
    `${productId} aliexpress`,
    `site:aliexpress.com/item ${productId}`,
    `"${productId}" site:aliexpress.com`,
    `site:fr.aliexpress.com/item ${productId}`,
  ];

  let best = null;
  let englishTitle = "";
  let englishSnippet = "";
  const candidates = [];
  for (const q of queries) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt) await new Promise((r) => setTimeout(r, 400));
        const items = await searchViaDuckDuckGo(q, {
          linkTest: (link) => /aliexpress\.[a-z.]+\/item\/\d+/i.test(link) && link.includes(productId),
          limit: 10,
        });
        for (const hit of items) {
          if (hit?.title && hit.title.length > 12) candidates.push(hit);
        }
        if (candidates.length >= 3) break;
      } catch (err) {
        console.warn("[ali web fallback search]", err.message);
      }
    }
    if (candidates.length >= 3) break;
  }

  // Déduplique par URL
  const byUrl = new Map();
  for (const c of candidates) {
    if (!byUrl.has(c.url)) byUrl.set(c.url, c);
  }
  const uniq = [...byUrl.values()];

  for (const hit of uniq) {
    const sn = cleanText(hit.snippet || "");
    const buyMatch = sn.match(/(?:Buy|Achetez)\s+(.+?)\s+(?:at|sur)\s+Ali(?:Express)?/i);
    if (/fr\.aliexpress/i.test(hit.url) || /[àâäéèêëïîôùûüç]/i.test(hit.title) || /Achetez/i.test(sn)) {
      // candidat FR
    }
    if (buyMatch?.[1] && !/[àâäéèêëïîôùûüç]/i.test(buyMatch[1])) {
      if (buyMatch[1].length > englishTitle.length) {
        englishTitle = cleanText(buyMatch[1]);
        englishSnippet = sn;
      }
    } else if (/[A-Za-z]{4,}/.test(hit.title) && !/[àâäéèêëïîôùûüç]/i.test(hit.title)) {
      const t = cleanText(hit.title).replace(/\s*[-–|]\s*AliExpress.*$/i, "").replace(/\s*\.\.\.\s*$/, "");
      if (t.length > englishTitle.length) englishTitle = t;
    }
  }

  const frHit =
    uniq.find((i) => /fr\.aliexpress/i.test(i.url)) ||
    uniq.find((i) => /[àâäéèêëïîôùûüç]/i.test(i.title)) ||
    uniq.find((i) => /Achetez/i.test(i.snippet || ""));
  best = frHit || uniq[0];

  if (!best?.title) throw new Error("AliExpress: impossible de récupérer le titre (captcha + recherche)");

  // Titre affiché : FR prioritaire (snippet Achetez …), sinon titre résultat
  let title = cleanText(best.title)
    .replace(/\s*[-–|]\s*AliExpress.*$/i, "")
    .replace(/\s*\.\.\.\s*$/, "")
    .trim();
  const frBuy = cleanText(best.snippet || "").match(/Achetez\s+(.+?)\s+sur\s+Ali/i);
  if (frBuy?.[1] && frBuy[1].length > 20) {
    title = cleanText(frBuy[1]);
  } else if ((!/[àâäéèêëïîôùûüç]/i.test(title) || title.length < 20) && englishTitle) {
    title = englishTitle;
  }
  const snippet = cleanText(best.snippet || englishSnippet || "");

  const product = {
    source: "aliexpress+web",
    title,
    price: best.price || null,
    currency: "EUR",
    bullets: [],
    specs: {},
    description: cleanMarketingCopy(snippet).slice(0, 700),
    images: [],
    url,
    live: true,
    web_fallback: true,
  };

  // Probe affiliés type /product/{slug} à partir du titre EN (souvent mêmes images alicdn)
  try {
    const slugBase = (englishTitle || title)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 140);
    const slugVariants = slugBase
      ? [
          slugBase,
          slugBase.replace(/-ali-?express.*$/, ""),
          `${slugBase}-stress-relief`,
          slugBase.split("-").slice(0, 12).join("-"),
        ]
      : [];
    const probeHosts = ["dogsbites.com", "www.dogsbites.com"];
    const probeUrls = [];
    for (const host of probeHosts) {
      for (const slug of [...new Set(slugVariants)].filter(Boolean)) {
        probeUrls.push(`https://${host}/product/${slug}`);
      }
    }
    for (const probe of probeUrls.slice(0, 8)) {
      if (product.images.length >= 5) break;
      try {
        const { html } = await fetchHtml(probe);
        if (html.length < 3000 || isBlockedSupplierHtml(html)) continue;
        if (!/alicdn|aliexpress-media/i.test(html)) continue;
        const loose =
          html.match(
            /https?:\/\/[^"'\\\s>]*(?:alicdn\.com|aliexpress-media\.com)[^"'\\\s>]+\.(?:jpg|jpeg|png|webp)/gi
          ) || [];
        loose.forEach((u) => product.images.push(u.split("?")[0]));
        const $ = cheerio.load(html);
        $("tr").each((_, el) => {
          const cells = $(el).find("th,td");
          if (cells.length >= 2) {
            const k = cleanText($(cells[0]).text());
            const v = cleanText($(cells[1]).text());
            if (k && v && k.length < 60 && v.length < 120 && !product.specs[k]) {
              product.specs[k] = v;
              if (!/brand|origin|choice|chemical|none/i.test(k) && !/^none$/i.test(v)) {
                product.bullets.push(`${k} : ${v}`);
              }
            }
          }
        });
      } catch (_) {}
    }
  } catch (err) {
    console.warn("[ali affiliate probe]", err.message);
  }

  // Enrichir via pages miroir / re-listings (souvent mêmes images alicdn + specs)
  try {
    const titleWords = title
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 7)
      .join(" ");
    const mirrorQueries = [
      englishTitle ? `"${englishTitle.split(/\s+/).slice(0, 8).join(" ")}"` : null,
      `"${titleWords}"`,
      `"${productId}" fidget OR squishy OR product`,
    ].filter(Boolean);
    for (const mirrorQuery of mirrorQueries) {
      if (product.images.length >= 5) break;
      const mirrors = await searchViaDuckDuckGo(mirrorQuery, {
        linkTest: (link) =>
          /^https?:\/\//i.test(link) &&
          !/duckduckgo|bing\.com|google\.|youtube\.|facebook\.|login|privacy/i.test(link),
        limit: 8,
      });
      for (const m of mirrors.slice(0, 6)) {
        try {
          if (/aliexpress\./i.test(m.url)) continue;
          const { html } = await fetchHtml(m.url);
          if (isBlockedSupplierHtml(html) || html.length < 1500) continue;
          const $ = cheerio.load(html);
          $("img").each((_, el) => {
            const src = $(el).attr("src") || $(el).attr("data-src") || $(el).attr("data-lazy-src");
            const u = absUrl(m.url, String(src || "").split(" ")[0]);
            if (
              u &&
              /alicdn|aliexpress-media|media-amazon|ssl-images-amazon|ebayimg/i.test(u) &&
              !/sprite|pixel|icon|logo|spinner/i.test(u)
            ) {
              product.images.push(u.split("?")[0]);
            }
          });
          const loose =
            html.match(
              /https?:\/\/[^"'\\\s>]*(?:alicdn\.com|aliexpress-media\.com|media-amazon\.com|ebayimg\.com)[^"'\\\s>]+\.(?:jpg|jpeg|png|webp)/gi
            ) || [];
          loose.forEach((u) => {
            if (!/sprite|pixel|icon|logo/i.test(u)) product.images.push(u.split("?")[0]);
          });
          $("tr").each((_, el) => {
            const cells = $(el).find("th,td");
            if (cells.length >= 2) {
              const k = cleanText($(cells[0]).text());
              const v = cleanText($(cells[1]).text());
              if (k && v && k.length < 60 && v.length < 120 && !product.specs[k]) {
                product.specs[k] = v;
                if (!/brand|origin|choice|chemical|none/i.test(k) && !/^none$/i.test(v)) {
                  product.bullets.push(`${k} : ${v}`);
                }
              }
            }
          });
          if (product.images.length >= 4) break;
        } catch (_) {}
      }
    }
  } catch (err) {
    console.warn("[ali mirror enrich]", err.message);
  }

  product.images = uniqueProductImages(product.images, { limit: 10 });
  if (!product.bullets.length && snippet) {
    snippet.split(/[.;|]/).forEach((part) => {
      const p = cleanText(part);
      if (p.length > 25 && p.length < 160) product.bullets.push(p);
    });
  }
  product.bullets = product.bullets.slice(0, 10);

  return enrichProductListingCopy(product);
}

function parseEbayItem($, baseUrl) {
  const title =
    cleanText($("h1.x-item-title__mainTitle, h1#itemTitle, h1").first().text()) ||
    cleanText($("meta[property='og:title']").attr("content"));

  const priceText =
    cleanText($("[data-testid='x-price-primary'] span, .x-price-primary span, #prcIsum").first().text()) ||
    cleanText($("meta[itemprop='price']").attr("content"));
  const price = parsePrice(priceText);

  const images = new Set();
  const og = $("meta[property='og:image']").attr("content");
  if (og) images.add(og);
  $("img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src");
    const u = absUrl(baseUrl, src);
    if (u && u.includes("ebayimg") && !u.includes("s-l64")) images.add(u.replace(/s-l\d+/i, "s-l1600"));
  });

  return {
    source: "ebay",
    title: title || "Produit eBay",
    price,
    currency: "EUR",
    bullets: [],
    description: cleanText($("meta[name='description']").attr("content") || "").slice(0, 600),
    images: uniqueProductImages([...images], { limit: 8 }),
    url: baseUrl,
  };
}

function parseGeneric($, baseUrl) {
  const title =
    cleanText($("meta[property='og:title']").attr("content")) ||
    cleanText($("h1").first().text()) ||
    cleanText($("title").text());
  const images = new Set();
  const og = $("meta[property='og:image']").attr("content");
  if (og) images.add(absUrl(baseUrl, og));
  return {
    source: "generic",
    title: title || "Produit",
    price: parsePrice($("meta[property='product:price:amount']").attr("content")),
    currency: "EUR",
    bullets: [],
    description: cleanText($("meta[name='description']").attr("content") || "").slice(0, 600),
    images: uniqueProductImages([...images].filter(Boolean), { limit: 8 }),
    url: baseUrl,
  };
}

function parseCdiscount($, baseUrl) {
  const title =
    cleanText($("h1").first().text()) ||
    cleanText($("meta[property='og:title']").attr("content")) ||
    cleanText($("title").text());

  const priceText =
    cleanText($("[itemprop='price']").attr("content")) ||
    cleanText($("meta[itemprop='price']").attr("content")) ||
    cleanText($(".fpPrice, .price, [class*='Price'], [data-price]").first().text()) ||
    cleanText($("meta[property='product:price:amount']").attr("content")) ||
    cleanText($("[class*='price']").first().text());
  let price = sanitizeProductPrice(parsePrice(priceText), title);
  if (!price) {
    // JSON embarqué Cdiscount
    const html = $.root().html() || "";
    const m =
      html.match(/"price"\s*:\s*"?([\d.,]+)"?/i) ||
      html.match(/"priceValue"\s*:\s*"?([\d.,]+)"?/i) ||
      html.match(/data-price=["']([\d.,]+)/i);
    if (m) price = sanitizeProductPrice(parsePrice(m[1]), title);
  }

  const images = new Set();
  const og = $("meta[property='og:image']").attr("content");
  if (og) images.add(absUrl(baseUrl, og));
  $("img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || $(el).attr("data-srcset");
    const u = absUrl(baseUrl, String(src || "").split(" ")[0]);
    if (u && /cdiscount|cdscdn|media/i.test(u) && u.length > 30) images.add(u.split("?")[0]);
  });

  return {
    source: "cdiscount",
    title: title || "Produit Cdiscount",
    price,
    currency: "EUR",
    bullets: [],
    description: cleanText($("meta[name='description']").attr("content") || "").slice(0, 600),
    images: uniqueProductImages([...images], { limit: 8 }),
    url: baseUrl,
  };
}

function parsePrice(text) {
  if (text == null || text === "") return null;
  const raw = String(text);

  // Fourchette eBay FR/EN : « 25,99 à 99,99 EUR » → prix affiché = minimum (à partir de)
  const range = raw.match(
    /(\d+[.,]\d{2})\s*(?:€|(?:\bEUR\b)|\$)?\s*(?:à|a|to|-|–|—)\s*(\d+[.,]\d{2})\s*(?:€|(?:\bEUR\b)|\$)?/i
  );
  if (range) {
    const a = Number(range[1].replace(",", "."));
    const b = Number(range[2].replace(",", "."));
    if (a > 0 && b > 0 && a < 100000 && b < 100000) return Math.min(a, b);
  }

  // Montants avec devise — \bEUR\b pour ne PAS matcher « largeur »
  const withCurrency =
    raw.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|(?:\bEUR\b)|\$|(?:\bUSD\b))/i) ||
    raw.match(/(?:€|(?:\bEUR\b)|\$|(?:\bUSD\b))\s*(\d+(?:[.,]\d{1,2})?)/i);
  if (withCurrency) {
    const n = Number(withCurrency[1].replace(",", "."));
    if (n > 0 && n < 100000) return n;
  }
  // Décimales type prix (pas 15mL / 8 mm / 24 V)
  const decimal = raw.match(
    /(?<![A-Za-z/])(\d+[.,]\d{2})(?!\s*(?:ml|mL|g|kg|mm|cm|m\b|v\b|w\b|mah|leds?|k\b))/i
  );
  if (decimal) {
    const n = Number(decimal[1].replace(",", "."));
    if (n > 0 && n < 5000) return n;
  }
  return null;
}

/**
 * Prix carte eBay : ignore livraison, fourchettes → min, barré/promo → prix bas.
 */
function parseEbayCardPrice(text) {
  const raw = String(text || "");
  if (!raw.trim()) return null;
  const noShip = raw
    .replace(/\+?\s*\d+[.,]\d{2}\s*(?:€|(?:\bEUR\b))?\s*(?:de\s+)?(?:livraison|shipping|postage|frais)/gi, " ")
    .replace(/livraison\s*(?:gratuite|free)?/gi, " ");
  const range = noShip.match(
    /(\d+[.,]\d{2})\s*(?:€|(?:\bEUR\b))?[\s\S]{0,12}?(?:à|a|to|-|–|—)[\s\S]{0,12}?(\d+[.,]\d{2})/i
  );
  if (range) {
    const a = Number(range[1].replace(",", "."));
    const b = Number(range[2].replace(",", "."));
    if (a > 0 && b > 0) return Math.min(a, b);
  }
  const all = extractAllPrices(noShip);
  if (all.length >= 2) return Math.min(...all);
  if (all.length === 1) return all[0];
  return parsePrice(noShip);
}

/** Extrait tous les montants €/$ d'un texte. */
function extractAllPrices(text) {
  const raw = String(text || "");
  const out = [];
  const re =
    /(\d+[.,]\d{2})\s*(?:€|(?:\bEUR\b)|\$|(?:\bUSD\b))|(?:€|(?:\bEUR\b)|\$|(?:\bUSD\b))\s*(\d+[.,]\d{2})|(\d+)\s*(?:€|(?:\bEUR\b))\b/gi;
  let m;
  while ((m = re.exec(raw))) {
    const n = Number(String(m[1] || m[2] || m[3]).replace(",", "."));
    if (n > 0.5 && n < 5000) out.push(n);
  }
  return out;
}

/**
 * Rejette les faux prix issus de dimensions du titre (ex. 8€ ← « 8 mm », 24€ ← « 24 V »).
 */
function isLikelyDimensionFalsePrice(price, title = "") {
  if (!(price > 0) || !title) return false;
  const n = Number(price);
  if (n !== Math.round(n)) return false; // 27.19 OK
  const t = String(title);
  const unitRe = new RegExp(
    `\\b${Math.round(n)}\\s*(?:mm|cm|m|V|W|Watte?s?|K|LEDs?|pcs?|pièces?|x)\\b`,
    "i"
  );
  if (unitRe.test(t)) return true;
  // « 3000K » / « 2m » collés sans espace
  if (new RegExp(`\\b${Math.round(n)}(?:mm|cm|m|V|W|K)\\b`, "i").test(t)) return true;
  return false;
}

function sanitizeProductPrice(price, title = "") {
  const n = Number(price);
  if (!(n > 0) || n < 0.5 || n > 5000) return null;
  if (isLikelyDimensionFalsePrice(n, title)) return null;
  return n;
}

/**
 * AliExpress renvoie parfois des centimes (212585 → 21.26 €) lus comme euros (2125.85 €).
 * On ramène dans une plage dropship crédible.
 */
function normalizeAliExpressEuroPrice(price) {
  return aliMoneyToEur(price);
}

function sanitizeAliExpressPrice(price, title = "", currency = "") {
  const eur = aliMoneyToEur(price, currency, String(price || ""));
  if (!(eur > 0)) return null;
  return sanitizeProductPrice(eur, title);
}

function medianPrice(values) {
  const arr = (values || []).filter((v) => v > 0).sort((a, b) => a - b);
  if (!arr.length) return null;
  return arr[Math.floor(arr.length / 2)];
}

/**
 * Résout un prix fiable via Bing pour une URL produit précise (médiane, anti faux-positifs dimensions).
 */
async function resolvePriceViaSearch(url, title = "") {
  const u = String(url || "");
  const t = String(title || "");
  const queries = [];
  const aliId = (u.match(/aliexpress\.[a-z.]+\/item\/(\d+)/i) || [])[1];
  const asin = (u.match(/amazon\.[a-z.]+\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i) || [])[1];
  if (aliId) {
    queries.push(`${aliId} aliexpress`);
    queries.push(`"${aliId}" € OR EUR OR prix`);
    queries.push(`site:fr.aliexpress.com/item/${aliId}`);
  } else if (asin) {
    queries.push(`${asin} site:amazon.fr`);
    queries.push(`"${asin}" €`);
  } else if (/cdiscount\.com/i.test(u)) {
    const path = u.split("?")[0].split("/").pop() || "";
    queries.push(`site:cdiscount.com ${path}`);
    if (t.length > 20) queries.push(`site:cdiscount.com ${t.slice(0, 50)} prix`);
  } else {
    return null;
  }

  const found = [];
  for (const q of queries.slice(0, 3)) {
    try {
      const hits = await searchViaBingRss(q, {
        limit: 8,
        linkTest: aliId
          ? (link) => link.includes(aliId)
          : asin
            ? (link) => link.includes(asin)
            : /cdiscount\.com/i.test(u)
              ? (link) => /cdiscount\.com/i.test(link)
              : undefined,
      });
      for (const hit of hits) {
        const blob = `${hit.title || ""} ${hit.snippet || ""}`;
        for (const p of extractAllPrices(blob)) {
          const ok = aliId
            ? sanitizeAliExpressPrice(p, t || hit.title)
            : sanitizeProductPrice(p, t || hit.title);
          if (ok) found.push(ok);
        }
      }
    } catch (_) {}
  }
  return medianPrice(found);
}

async function scrapeProductViaJina(url) {
  const endpoint = `https://r.jina.ai/${url}`;
  const res = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      "User-Agent": UA,
    },
  });
  if (!res.ok) throw new Error(`Jina HTTP ${res.status}`);
  const payload = await res.json();
  const data = payload.data || payload;
  const title = cleanText(data.title || "").split(":")[0].trim();
  const content = data.content || data.text || "";
  if (
    isBlockedSupplierHtml(content, title) ||
    /Captcha Interception|unusual traffic/i.test(title) ||
    /Captcha Interception|unusual traffic/i.test(content.slice(0, 2000))
  ) {
    throw new Error("Jina: page captcha / bloquée");
  }
  const images = [];
  const imgMatches = content.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/g);
  for (const m of imgMatches) {
    const src = m[1];
    if (/media-amazon|ssl-images-amazon|alicdn|ebayimg|cdiscount|cdscdn/i.test(src)) images.push(src);
  }
  const bullets = [];
  for (const line of content.split("\n")) {
    const t = cleanText(line.replace(/^[\-*•]\s*/, ""));
    if (t.length > 25 && t.length < 180 && /[a-zA-ZÀ-ÿ]/.test(t)) {
      if (/about this item|skip to|acheter|buy now|ajouter|captcha|unusual traffic/i.test(t)) continue;
      bullets.push(t);
    }
    if (bullets.length >= 6) break;
  }
  const priceMatch =
    content.match(/(\d+[.,]\d{2})\s*€/) ||
    content.match(/€\s*(\d+[.,]\d{2})/) ||
    content.match(/(?:price|prix|EUR)\s*[:=]?\s*(\d+[.,]\d{2})/i);
  const price = priceMatch ? parsePrice(priceMatch[1] + " €") : null;

  if (!title || title.length < 3) throw new Error("Jina: titre introuvable");

  return enrichProductListingCopy({
    source: detectSource(url) + "+jina",
    title,
    price,
    currency: "EUR",
    bullets,
    description: cleanText(data.description || bullets.slice(0, 2).join(" ")).slice(0, 600),
    images: uniqueProductImages(images, { limit: 8 }),
    url,
    live: true,
  });
}

function isWeakProductTitle(title = "") {
  const t = cleanText(title);
  if (!t || t.length < 8) return true;
  if (/^(aliexpress|amazon(?:\.[a-z]+)?|cdiscount|ebay|produit(?:\s+aliexpress)?)$/i.test(t)) return true;
  if (/^\d{6,}$/.test(t)) return true; // ID numérique seul
  if (/robot|captcha|sign in|error page|accès refusé|interception|not found|page introuvable/i.test(t)) {
    return true;
  }
  return false;
}

/** Scraping trop pauvre → on force les fallbacks (titre générique / 0 image / 0 bullet). */
function isThinProduct(product = {}) {
  if (!product || isWeakProductTitle(product.title)) return true;
  const imgs = (product.images || []).filter(isRealProductImage);
  const bullets = product.bullets || [];
  const desc = cleanText(product.description || "");
  const genericDesc = /accessoire led|modèle neuf, prêt|produit sélectionné pour sa qualité/i.test(desc);
  if (imgs.length === 0 && bullets.length === 0) return true;
  if (imgs.length === 0 && (desc.length < 40 || genericDesc)) return true;
  return false;
}

async function scrapeProduct(url) {
  const source = detectSource(url);
  let directProduct = null;

  // 1) Tentative fetch (Node → curl → Chrome si Amazon)
  try {
    let html;
    let finalUrl;
    try {
      ({ html, finalUrl } = await fetchHtmlResilient(url, {
        preferChrome: source === "amazon" || (source === "aliexpress" && process.platform === "win32"),
        extraHeaders: {
          Referer:
            source === "amazon"
              ? "https://www.amazon.fr/"
              : source === "aliexpress"
                ? "https://fr.aliexpress.com/"
                : undefined,
          ...(source === "aliexpress"
            ? { Cookie: ALI_EUR_COOKIE, "Accept-Language": "fr-FR,fr;q=0.9" }
            : {}),
        },
      }));
    } catch (e) {
      throw e;
    }
    if (isBlockedSupplierHtml(html) || (source === "amazon" && isAmazonBlockedHtml(html))) {
      throw new Error("Page fournisseur bloquée (captcha)");
    }
    const $ = cheerio.load(html);

    let product;
    switch (source) {
      case "amazon":
        product = parseAmazon($, finalUrl);
        break;
      case "aliexpress":
        product = parseAliExpress($, finalUrl, html);
        break;
      case "cdiscount":
        product = parseCdiscount($, finalUrl);
        break;
      case "ebay":
        product = parseEbayItem($, finalUrl);
        break;
      default:
        product = parseGeneric($, finalUrl);
    }

    if (product.blocked) throw new Error("Page AliExpress captcha / punish");

    if (!isWeakProductTitle(product.title)) {
      product.images = (product.images || []).filter(isRealProductImage);
      product.price =
        source === "aliexpress"
          ? sanitizeAliExpressPrice(product.price, product.title)
          : sanitizeProductPrice(product.price, product.title);
      product.live = true;
      directProduct = enrichProductListingCopy(product);
      // Prix manquant → résolution Bing (médiane, anti faux 8mm→8€)
      if (!(directProduct.price > 0)) {
        try {
          if (source === "aliexpress") {
            const aliP = await fetchAliExpressPrice(url, directProduct.title);
            if (aliP > 0) {
              directProduct.price = aliP;
              directProduct.price_resolved = true;
            }
          }
          if (!(directProduct.price > 0)) {
            const resolved = await resolvePriceViaSearch(url, directProduct.title);
            if (resolved > 0) {
              directProduct.price = resolved;
              directProduct.price_resolved = true;
            }
          }
        } catch (_) {}
      }
      // AliExpress souvent en shell JS : titre OK mais 0 image → enrichir via web
      if (!(source === "aliexpress" && isThinProduct(directProduct))) {
        return directProduct;
      }
      console.warn("[scrape direct] produit AliExpress trop pauvre → fallback web");
    }
  } catch (err) {
    console.warn("[scrape direct]", err.message);
  }

  // 2) Fallback Jina reader (contourne beaucoup d'anti-bots)
  try {
    const viaJina = await scrapeProductViaJina(url);
    if (!isWeakProductTitle(viaJina.title)) {
      viaJina.images = (viaJina.images || []).filter(isRealProductImage);
      viaJina.price =
        source === "aliexpress"
          ? sanitizeAliExpressPrice(viaJina.price, viaJina.title)
          : sanitizeProductPrice(viaJina.price, viaJina.title);
      if (!(viaJina.price > 0)) {
        try {
          const resolved = await resolvePriceViaSearch(url, viaJina.title);
          if (resolved > 0) {
            viaJina.price = resolved;
            viaJina.price_resolved = true;
          }
        } catch (_) {}
      }
      if (!(source === "aliexpress" && isThinProduct(viaJina))) {
        return viaJina;
      }
      if (!directProduct || (viaJina.images || []).length > (directProduct.images || []).length) {
        directProduct = viaJina;
      }
      console.warn("[scrape jina] produit trop pauvre → fallback web");
    }
  } catch (err) {
    console.warn("[scrape jina]", err.message);
  }

  // 3) AliExpress : recherche web (titre FR + images alicdn miroirs)
  if (source === "aliexpress") {
    try {
      const viaWeb = await scrapeAliExpressViaWebFallback(url);
      viaWeb.images = (viaWeb.images || []).filter(isRealProductImage);
      viaWeb.price = sanitizeProductPrice(viaWeb.price, viaWeb.title);
      if (!(viaWeb.price > 0)) {
        try {
          const resolved = await resolvePriceViaSearch(url, viaWeb.title);
          if (resolved > 0) {
            viaWeb.price = resolved;
            viaWeb.price_resolved = true;
          }
        } catch (_) {}
      }
      // Merge : garde le meilleur titre / images / prix
      if (directProduct) {
        const merged = enrichProductListingCopy({
          ...directProduct,
          ...viaWeb,
          title: !isWeakProductTitle(viaWeb.title) ? viaWeb.title : directProduct.title,
          price: viaWeb.price || directProduct.price || null,
          images: [...(viaWeb.images || []), ...(directProduct.images || [])],
          bullets: [...(viaWeb.bullets || []), ...(directProduct.bullets || [])],
          specs: { ...(directProduct.specs || {}), ...(viaWeb.specs || {}) },
          description: viaWeb.description || directProduct.description,
        });
        merged.images = uniqueProductImages(merged.images, { limit: 10 });
        if (!(merged.price > 0)) {
          try {
            const resolved = await resolvePriceViaSearch(url, merged.title);
            if (resolved > 0) merged.price = resolved;
          } catch (_) {}
        }
        return merged;
      }
      return viaWeb;
    } catch (err) {
      console.warn("[scrape ali web]", err.message);
    }
  }

  if (directProduct && !isWeakProductTitle(directProduct.title)) {
    return directProduct;
  }

  throw new Error(`Impossible d'extraire le produit (${source}) — essayez une autre URL`);
}

/**
 * Enrichit un produit scrapé avec sections, bénéfices et specs utilisables
 * dans le Description Builder (sans noms de marketplace / marge).
 * @param {object} product
 * @param {{ language?: string }} [opts]
 */
function enrichProductListingCopy(product = {}, opts = {}) {
  const language = normalizeListingLang(opts.language || product.language || "fr");
  const L = getListingUi(language);

  const title = scrubTitleForLanguage(
    cleanText(product.title || (language === "de" ? "Produkt" : language === "en" ? "Product" : "Produit")),
    language
  );
  // Inclut originalTitle / description pour détecter la catégorie même après réécriture SEO
  const t = `${title} ${product.originalTitle || product.original_title || ""} ${product.description || ""} ${
    product.short_pitch || ""
  }`.toLowerCase();
  const existingSpecs =
    product.specs && typeof product.specs === "object" && !Array.isArray(product.specs)
      ? { ...product.specs }
      : {};
  const bullets = [...(product.bullets || [])].map((b) => cleanText(b)).filter(Boolean);

  const pick = (...candidates) => candidates.find((c) => c && String(c).trim()) || "";

  // Inférences légères à partir du titre (complètent le scrape, ne inventent pas une autre catégorie)
  const material = pick(
    existingSpecs.Matériau,
    existingSpecs.Material,
    existingSpecs.Materiau,
    existingSpecs.Material,
    /silicone|silikon/i.test(t) && (language === "de" ? "Silikon" : "Silicone"),
    /tpe|tpr|thermoplastic/i.test(t) && "TPE / TPR",
    /pu\b|polyurethane|mousse|foam/i.test(t) && (language === "de" ? "PU-Schaum" : language === "en" ? "PU foam" : "Mousse PU"),
    /coton|cotton|baumwolle/i.test(t) && (language === "de" ? "Baumwolle" : language === "en" ? "Cotton" : "Coton"),
    /abs\b|plastique|plastic|kunststoff/i.test(t) &&
      (language === "de" ? "Kunststoff" : language === "en" ? "Plastic" : "Plastique"),
    /métal|metal|alu|acier|steel|metall/i.test(t) && (language === "de" ? "Metall" : language === "en" ? "Metal" : "Métal"),
    /bois|wood|holz/i.test(t) && (language === "de" ? "Holz" : language === "en" ? "Wood" : "Bois")
  );
  const dimMatch =
    title.match(/(\d+[.,]?\d*)\s*[x×*]\s*(\d+[.,]?\d*)\s*[x×*]?\s*(\d+[.,]?\d*)?\s*(cm|mm)/i) ||
    title.match(/(\d+[.,]?\d*)\s*(cm|mm)\b/i);
  let dimensions = existingSpecs.Dimensions || existingSpecs.Size || existingSpecs.Taille || existingSpecs.Abmessungen || "";
  if (!dimensions && dimMatch) {
    dimensions = dimMatch[0].replace(/\*/g, "×").replace(/,/g, ".");
  }
  const weight = existingSpecs.Poids || existingSpecs.Weight || existingSpecs.Gewicht || "";
  const age = existingSpecs["Recommend Age"] || existingSpecs.Âge || existingSpecs.Age || "";

  const isFidget = /fidget|squishy|anti-?stress|décompression|decompression|squeeze|anxiety|souple|élastique|elastique|beurre|butter|fromage|cheese/i.test(
    t
  );
  const isLed = /led|rgb|lumière|lumiere|neopixel|ws2812|licht/i.test(t);
  const isPhone = /coque|iphone|samsung|chargeur|cable|câble|usb|magsafe|phone case|handyhülle|ladegerät/i.test(t);

  const specs = {
    [L.conditionLabel]: L.conditionNew,
    [L.brandLabel]:
      existingSpecs.Brand || existingSpecs["Brand Name"] || existingSpecs.Marque || existingSpecs.Marke || L.unbranded,
    ...existingSpecs,
  };
  if (material) specs[L.materialLabel] = specs[L.materialLabel] || specs.Matériau || material;
  if (dimensions) specs[L.dimsLabel] = specs[L.dimsLabel] || specs.Dimensions || dimensions;
  if (weight) specs.Poids = specs.Poids || weight;
  if (age || existingSpecs["Recommend Age"]) {
    specs["Âge recommandé"] = age || existingSpecs["Recommend Age"];
  }
  if (isFidget) {
    specs[L.typeLabel] =
      specs[L.typeLabel] && !/crystal soil/i.test(String(specs[L.typeLabel] || specs.Type || ""))
        ? specs[L.typeLabel] || specs.Type
        : language === "de"
          ? "Anti-Stress / Fidget Spielzeug"
          : language === "en"
            ? "Stress relief / fidget toy"
            : "Jouet anti-stress / fidget";
    specs[L.usageLabel] =
      specs[L.usageLabel] ||
      specs.Usage ||
      (language === "de"
        ? "Stressabbau, Fokus, sensorische Manipulation"
        : language === "en"
          ? "Stress relief, focus, sensory play"
          : "Soulagement du stress, focus, manipulation sensorielle");
    if (!specs[L.materialLabel] && !specs.Matériau) {
      specs[L.materialLabel] =
        language === "de"
          ? "Weiches elastisches Material (TPE/TPR)"
          : language === "en"
            ? "Soft elastic material (TPE/TPR)"
            : "Matière souple élastique (type TPE/TPR)";
    }
    if (!specs[L.dimsLabel] || /format compact/i.test(String(specs[L.dimsLabel] || specs.Dimensions || ""))) {
      specs[L.dimsLabel] =
        language === "de" ? "Ca. 12–15 cm" : language === "en" ? "Approx. 12–15 cm" : "Environ 12–15 cm";
    }
  } else if (isLed) {
    specs[L.typeLabel] =
      specs[L.typeLabel] ||
      specs.Type ||
      (language === "de" ? "LED-Beleuchtung" : language === "en" ? "LED lighting" : "Éclairage LED");
  } else if (isPhone) {
    specs[L.typeLabel] =
      specs[L.typeLabel] ||
      specs.Type ||
      (language === "de" ? "Handy-Zubehör" : language === "en" ? "Mobile accessory" : "Accessoire mobile");
  }
  delete specs.Choice;
  delete specs["High-concerned chemical"];
  if (/crystal soil/i.test(String(specs.Type || ""))) delete specs.Type;
  if (/^none$/i.test(String(specs.Marque || ""))) specs[L.brandLabel] = L.unbranded;
  if (/^none$/i.test(String(specs["Brand Name"] || ""))) delete specs["Brand Name"];
  if (/^none$/i.test(String(specs.Brand || ""))) delete specs.Brand;
  if (specs["Brand Name"] && (specs.Marque || specs[L.brandLabel])) delete specs["Brand Name"];
  if (specs["Recommend Age"] && specs["Âge recommandé"]) delete specs["Recommend Age"];
  if (/mainland china/i.test(String(specs.Origin || ""))) {
    specs.Origine = language === "de" ? "Import" : language === "en" ? "Import" : "Import";
    delete specs.Origin;
  }

  const localizedSpecs = localizeSpecsObject(specs, language);

  // EN/DE : ne pas réutiliser la description fournisseur (souvent FR/EN) — forcer les templates.
  // FR : on garde le scrape s'il est déjà en français et de bonne qualité.
  const forceLocalized =
    language === "en" ||
    language === "de" ||
    opts.forceLanguage === true ||
    (Boolean(opts.language) &&
      !copyMatchesLanguage(
        `${product.short_pitch || ""} ${product.description || ""} ${(product.sections || [])
          .map((s) => s?.body || "")
          .join(" ")}`,
        language
      ));

  const fidgetPitch =
    language === "de"
      ? "Weiches Anti-Stress-Spielzeug zum Drücken und Dehnen — lustiges Design, ideal zum Entspannen im Alltag."
      : language === "en"
        ? "Soft stress-relief toy to squeeze and stretch — fun design, ideal to unwind every day."
        : "Jouet anti-stress souple à presser et étirer — design amusant, idéal pour relâcher la tension au quotidien.";

  let shortPitch = "";
  if (!forceLocalized) {
    shortPitch = cleanMarketingCopy(product.short_pitch || product.description || "");
  }
  if (
    !shortPitch ||
    shortPitch.length < 40 ||
    forceLocalized ||
    /trouvez plus|find more|transport maritime/i.test(shortPitch) ||
    !copyMatchesLanguage(shortPitch, language)
  ) {
    shortPitch = isFidget ? fidgetPitch : L.shortPitchFallback(stripSupplierProvenance(title));
  }

  let sections = [];
  if (!forceLocalized && Array.isArray(product.sections)) {
    sections = product.sections.filter(
      (s) => s?.body && copyMatchesLanguage(`${s.heading || ""} ${s.body}`, language)
    );
  }
  if (!sections.length) {
    if (isFidget) {
      const mat =
        localizedSpecs[L.materialLabel] ||
        material ||
        (language === "de" ? "Elastisches Material" : language === "en" ? "Elastic material" : "Matière élastique");
      sections =
        language === "en"
          ? [
              {
                heading: "Soft and durable material",
                body: `${mat} feels pleasant to the touch, designed to be pressed, stretched and reshaped without tearing easily. Slow return for a satisfying feel.`,
              },
              {
                heading: "Fun, realistic design",
                body: /beurre|butter|fromage|cheese/i.test(t)
                  ? "Butter / cheese stick inspired shape: quirky look, perfect for desk, home or a fun gift."
                  : "Careful, original design that catches the eye while staying discreet to handle.",
              },
              {
                heading: "Everyday stress relief",
                body: "Ideal to channel stress, improve focus or keep your hands busy — quiet, portable and ready to use.",
              },
            ]
          : language === "de"
            ? [
                {
                  heading: "Weiches und widerstandsfähiges Material",
                  body: `${mat} angenehm anzufassen, zum Drücken, Dehnen und Umformen ohne leichtes Reißen. Langsames Zurückfedern für ein befriedigendes Gefühl.`,
                },
                {
                  heading: "Lustiges, realistisches Design",
                  body: /beurre|butter|fromage|cheese/i.test(t)
                    ? "Form inspiriert von Butter-/Käseportion: verspielter Look für Büro, Zuhause oder als Geschenk."
                    : "Sorgfältiges, originales Design, das auffällt und dennoch dezent zu handhaben ist.",
                },
                {
                  heading: "Stressabbau im Alltag",
                  body: "Ideal zum Stressabbau, für mehr Fokus oder einfach zum Beschäftigen der Hände — leise, tragbar und sofort einsatzbereit.",
                },
              ]
            : [
                {
                  heading: "Matière souple et résistante",
                  body: `${mat} agréable au toucher, conçue pour être pressée, étirée et remodelée sans se déchirer facilement. Retour lent à la forme pour une sensation satisfaisante.`,
                },
                {
                  heading: "Design amusant et réaliste",
                  body: /beurre|butter|fromage|cheese/i.test(t)
                    ? "Forme inspirée d'un bâton de beurre / fromage : look décalé, parfait pour le bureau, la maison ou un cadeau original."
                    : "Design soigné et original qui attire l'œil tout en restant discret à manipuler.",
                },
                {
                  heading: "Soulagement du stress au quotidien",
                  body: "Idéal pour canaliser le stress, améliorer la concentration ou simplement s'occuper les mains — silencieux, portable et prêt à l'emploi.",
                },
              ];
    } else {
      // Ne pas coller la description fournisseur brute si elle n'est pas dans la langue cible
      const descRaw = cleanMarketingCopy(sanitizeReadableText(product.description, { maxLen: 500 }) || "");
      const desc =
        !forceLocalized && descRaw && copyMatchesLanguage(descRaw, language) ? descRaw : "";
      sections = [
        {
          heading: L.sectionDesc,
          body: desc || L.sectionDescBody(title),
        },
        {
          heading: L.sectionPros,
          body:
            !forceLocalized && bullets.length
              ? bullets.slice(0, 3).join(" · ")
              : L.sectionProsBody,
        },
        {
          heading: L.sectionWhy,
          body: L.sectionWhyBody,
        },
      ];
    }
  }

  let benefits = [];
  if (!forceLocalized && Array.isArray(product.benefits)) {
    benefits = product.benefits
      .map((b) => cleanText(b))
      .filter((b) => b && copyMatchesLanguage(b, language));
  }
  if (!benefits.length) {
    if (isFidget) {
      const matLabel = material || localizedSpecs[L.materialLabel] || L.materialLabel;
      benefits =
        language === "en"
          ? [
              `${matLabel} — durable and pleasant to the touch`,
              localizedSpecs[L.dimsLabel]
                ? `Compact size: ${localizedSpecs[L.dimsLabel]}`
                : "Compact and portable format",
              "Pleasant texture, slow-rise feel",
              "Helps reduce stress and anxiety",
              "Washable surface, hygienic",
              "Original gift (teens / adults) — not edible",
            ]
          : language === "de"
            ? [
                `${matLabel} — langlebig und angenehm anzufassen`,
                localizedSpecs[L.dimsLabel]
                  ? `Kompakte Größe: ${localizedSpecs[L.dimsLabel]}`
                  : "Kompaktes, tragbares Format",
                "Angenehme Textur, langsames Zurückfedern",
                "Hilft, Stress und Unruhe zu reduzieren",
                "Abwaschbare Oberfläche, hygienisch",
                "Originelles Geschenk (Teens / Erwachsene) — nicht essbar",
              ]
            : [
                `${matLabel} — durable et agréable au toucher`,
                localizedSpecs[L.dimsLabel] || specs.Dimensions
                  ? `Taille compacte : ${localizedSpecs[L.dimsLabel] || specs.Dimensions}`
                  : "Format compact et portable",
                "Texture agréable, retour lent (slow-rise)",
                "Aide à réduire le stress et l'anxiété",
                "Surface lavable à l'eau, hygiénique",
                "Cadeau original (ados / adultes) — non comestible",
              ];
    } else {
      const localizedBullets = bullets
        .map((b) => cleanText(b))
        .filter((b) => b && (!forceLocalized || copyMatchesLanguage(b, language)));
      benefits = localizedBullets.slice(0, 6);
      if (benefits.length < 3) {
        benefits = [
          ...benefits,
          material ? L.benefitMaterial(localizeValue(material, language)) : L.benefitMaterials,
          L.benefitNew,
          L.benefitDaily,
          L.benefitShip,
        ].filter(Boolean);
      }
    }
  }
  benefits = [...new Set(benefits)].slice(0, 8);

  let mergedBullets = benefits.slice(0, 8);
  if (!forceLocalized && bullets.length >= 3) {
    const filtered = bullets.filter((b) => copyMatchesLanguage(b, language) || language === "fr").slice(0, 8);
    if (filtered.length >= 3) mergedBullets = filtered;
  }

  let description = forceLocalized ? "" : cleanMarketingCopy(product.description || "");
  if (
    !description ||
    description.length < 50 ||
    forceLocalized ||
    !copyMatchesLanguage(description, language) ||
    /trouvez plus|find more|sur pour|achetez |transport maritime|free shipping|10000\d{3}/i.test(description)
  ) {
    description = sections.map((s) => s.body).filter(Boolean).join(" ") || shortPitch;
  }

  return {
    ...product,
    title,
    short_pitch: shortPitch,
    description,
    bullets: mergedBullets.length ? mergedBullets : benefits.slice(0, 8),
    benefits,
    sections,
    specs: localizedSpecs,
    language,
  };
}

function isRealProductImage(src) {
  if (!src || typeof src !== "string") return false;
  const u = src.trim();
  // Cache local EBX
  if (/^\/media\/[a-z0-9._-]+\.(jpg|jpeg|png|webp|gif)$/i.test(u)) return true;
  if (!/^https?:\/\//i.test(u)) return false;
  if (/picsum\.photos|placeholder\.com|via\.placeholder|placehold\.it|lorempixel|lorem\.picsum/i.test(u)) {
    return false;
  }
  // Miniatures eBay (40×40, $_1, s-l64…) — refusées par Gallery / règlement photo
  try {
    const { isTinyOrPlaceholderImageUrl } = require("./image-cache");
    if (isTinyOrPlaceholderImageUrl(u)) return false;
  } catch (_) {
    if (/ebayimg\.com.*\$_(?:0|1|2)\./i.test(u) || /ebayimg\.com.*s-l(?:64|96|140)/i.test(u)) {
      return false;
    }
    if (/\/s\/NDBYNDA=/i.test(u)) return false;
  }
  return true;
}

/**
 * Recherche eBay via DuckDuckGo HTML (fallback si eBay 403 / API absente)
 */
async function scrapeEbayViaDuckDuckGo(query, { marketplace = "FR", limit = 20 } = {}) {
  const site = marketplace === "US" ? "ebay.com" : "ebay.fr";
  const attempts = [
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`site:${site} ${query}`)}`,
    `https://www.bing.com/search?q=${encodeURIComponent(`site:${site} ${query}`)}&count=20`,
  ];

  const items = [];
  const seen = new Set();

  for (const url of attempts) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html",
          "Accept-Language": "fr-FR,fr;q=0.9",
        },
      });
      if (!res.ok) continue;
      const html = await res.text();
      const $ = cheerio.load(html);
      $("a").each((_, el) => {
        if (items.length >= limit) return;
        const root = $(el);
        let link = root.attr("href") || "";
        const uddg = link.match(/uddg=([^&]+)/);
        if (uddg) link = decodeURIComponent(uddg[1]);
        const title = cleanText(root.text());
        if (!title || title.length < 12) return;
        if (!/ebay\.(fr|com|co\.uk)/i.test(link) && !/^\/?ebay\./i.test(link)) {
          // relative ebay.fr/itm/...
          if (!/ebay\.(fr|com)/i.test(title) && !/itm\/\d+/.test(link)) return;
        }
        if (!link.startsWith("http")) {
          if (/ebay\.(fr|com)/i.test(link)) link = "https://www." + link.replace(/^\/+/, "");
          else if (/\/itm\/\d+/.test(link)) link = `https://www.${site}${link.startsWith("/") ? "" : "/"}${link}`;
        }
        if (!/ebay\.(fr|com|co\.uk)/i.test(link)) return;
        if (!/\/itm\//i.test(link) && !/\/sch\//i.test(link)) return;
        const cleanLink = (link.match(/https?:\/\/(?:www\.)?ebay\.[a-z.]+\/itm\/\d+/) || [link.split("&")[0]])[0];
        if (!cleanLink.includes("http")) return;
        if (seen.has(cleanLink) || /duckduckgo|bing\.com|microsoft|privacy/i.test(title)) return;
        seen.add(cleanLink);
        items.push({
          title: title.slice(0, 180),
          price: parsePrice(title) || null,
          url: cleanLink.startsWith("http") ? cleanLink : `https://${cleanLink}`,
          sold: Math.round(5 + Math.random() * 40),
          image: null,
          seller: "",
        });
      });
      if (items.length >= 3) break;
    } catch (_) {}
  }

  if (!items.length) throw new Error("DDG/Bing: aucun résultat eBay");
  try {
    const { rememberSearch } = require("./live-cache");
    rememberSearch(query, items);
  } catch (_) {}
  return { query, marketplace, url: attempts[0], items: items.slice(0, limit), live: true, source: "search-fallback" };
}

async function scrapeEbayViaJina(query, { marketplace = "FR", limit = 20 } = {}) {
  const domain = marketplace === "US" ? "www.ebay.com" : "www.ebay.fr";
  const url = `https://${domain}/sch/i.html?_nkw=${encodeURIComponent(query)}&_ipg=60`;

  let content = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        "User-Agent": UA,
        Accept: "text/plain",
        "X-Return-Format": "markdown",
      },
    });
    if (!res.ok) throw new Error(`Jina eBay HTTP ${res.status}`);
    content = await res.text();
    if (!/Error Page \| eBay|Something went wrong/i.test(content) && content.length > 5000) break;
    await new Promise((r) => setTimeout(r, 1200));
  }

  const items = [];
  const seen = new Set();

  // Pattern riche: lien itm + bloc prix (+ vendus optionnel)
  const re =
    /\[([^\]]{8,180}?)(?:\s*La page s'ouvre[^\]]*)?\]\((https:\/\/www\.ebay\.[a-z.]+\/itm\/\d+[^)]*)\)([\s\S]{0,320}?)(?=\[|\n\n|$)/gi;
  let m;
  while ((m = re.exec(content)) && items.length < limit) {
    const title = cleanText(m[1]).replace(/La page s'ouvre.*$/i, "").trim();
    const cleanLink = m[2].match(/https:\/\/www\.ebay\.[a-z.]+\/itm\/\d+/)?.[0] || m[2];
    if (/shop on ebay/i.test(title) || seen.has(cleanLink)) continue;
    seen.add(cleanLink);
    const blob = m[3] || "";
    const soldMatch = blob.match(/(\d[\d\s.]*)\s*vendus?/i);
    items.push({
      title,
      price: parseEbayCardPrice(blob),
      url: cleanLink,
      sold: soldMatch ? Number(String(soldMatch[1]).replace(/\s|\./g, "")) : 0,
      image: null,
      seller: "",
    });
  }

  // Pattern image carousel: ![Image N: TITLE](ebayimg) linked to /itm/
  if (items.length < 3) {
    const imgRe =
      /!\[Image\s*\d+:\s*([^\]]{8,160})\]\((https:\/\/i\.ebayimg\.com[^)]+)\)\]\((https:\/\/www\.ebay\.[a-z.]+\/itm\/\d+)/gi;
    while ((m = imgRe.exec(content)) && items.length < limit) {
      const title = cleanText(m[1]);
      const cleanLink = m[3];
      if (/shop on ebay/i.test(title) || seen.has(cleanLink)) continue;
      seen.add(cleanLink);
      items.push({ title, price: null, url: cleanLink, sold: 0, image: m[2], seller: "" });
    }
  }

  if (!items.length) throw new Error("Jina eBay: aucun item");
  return { query, marketplace, url, items, live: true, source: "ebay+jina" };
}

async function scrapeEbaySearch(query, { marketplace = "FR", limit = 20 } = {}) {
  const domain = marketplace === "US" ? "www.ebay.com" : "www.ebay.fr";
  const url = `https://${domain}/sch/i.html?_nkw=${encodeURIComponent(query)}&_ipg=60&rt=nc`;
  try {
    const { html, finalUrl } = await fetchHtml(url);
    const $ = cheerio.load(html);
    const items = [];

    $(".s-item").each((_, el) => {
      if (items.length >= limit) return;
      const root = $(el);
      const title = cleanText(root.find(".s-item__title").text()).replace(/^Nouvel objet\s*/i, "");
      if (!title || /shop on ebay/i.test(title)) return;
      const price = parseEbayCardPrice(root.find(".s-item__price").first().text());
      const link = absUrl(finalUrl, root.find("a.s-item__link").attr("href"));
      const soldText = cleanText(root.find(".s-item__hotness, .s-item__quantitySold, .s-item__dynamic").text());
      const soldMatch = soldText.match(/(\d[\d\s.]*)\s*(vendu|sold)/i);
      const sold = soldMatch ? Number(soldMatch[1].replace(/\s|\./g, "")) : 0;
      const img = absUrl(finalUrl, root.find("img").attr("src") || root.find("img").attr("data-src"));
      const seller = cleanText(root.find(".s-item__seller-info-text").text());
      items.push({ title, price, url: link, sold, image: img, seller });
    });

    if (items.length) {
      try {
        const { rememberSearch } = require("./live-cache");
        rememberSearch(query, items);
      } catch (_) {}
      return { query, marketplace, url: finalUrl, items, live: true, source: "ebay-html" };
    }
  } catch (err) {
    console.warn("[ebay html]", err.message);
  }

  try {
    return await scrapeEbayViaJina(query, { marketplace, limit });
  } catch (err) {
    console.warn("[ebay jina]", err.message);
  }

  try {
    return await scrapeEbayViaDuckDuckGo(query, { marketplace, limit });
  } catch (err) {
    console.warn("[ebay ddg]", err.message);
  }

  try {
    const { recallSearch } = require("./live-cache");
    const cached = recallSearch(query, { limit });
    if (cached?.items?.length) return { ...cached, marketplace };
  } catch (_) {}

  throw new Error("Recherche eBay indisponible");
}

/**
 * Analyse vendeur eBay via recherche vendeur + page membres si possible
 */
async function scrapeEbaySeller(sellerName, { marketplace = "FR" } = {}) {
  const domain = marketplace === "US" ? "www.ebay.com" : "www.ebay.fr";
  let items = [];

  // 1) Boutique eBay directe
  const storeUrl = `https://${domain}/sch/i.html?_ssn=${encodeURIComponent(sellerName)}&store_cat=0&_ipg=60`;
  try {
    const { html, finalUrl } = await fetchHtml(storeUrl);
    const $ = cheerio.load(html);
    $(".s-item").each((_, el) => {
      if (items.length >= 24) return;
      const root = $(el);
      const title = cleanText(root.find(".s-item__title").text()).replace(/^Nouvel objet\s*/i, "");
      if (!title || /shop on ebay/i.test(title)) return;
      const price = parseEbayCardPrice(root.find(".s-item__price").first().text());
      const link = absUrl(finalUrl, root.find("a.s-item__link").attr("href"));
      const soldText = cleanText(root.find(".s-item__hotness, .s-item__quantitySold, .s-item__dynamic").text());
      const soldMatch = soldText.match(/(\d[\d\s.]*)\s*(vendu|sold)/i);
      const sold = soldMatch ? Number(soldMatch[1].replace(/\s|\./g, "")) : 0;
      const image = absUrl(finalUrl, root.find("img").attr("src") || root.find("img").attr("data-src"));
      items.push({ title, price: price || 0, url: link, sold, image });
    });
  } catch (err) {
    console.warn("[seller store]", err.message);
  }

  // 2) Recherche seller via fallback search engines
  if (items.length < 3) {
    try {
      const search = await scrapeEbaySearch(sellerName, { marketplace, limit: 24 });
      items = (search.items || []).filter((i) => i.title);
    } catch (err) {
      console.warn("[seller search]", err.message);
    }
  }

  // 3) Recherche ciblée "sellername site:ebay"
  if (items.length < 3) {
    try {
      const fb = await scrapeEbayViaDuckDuckGo(`${sellerName} vendeur`, { marketplace, limit: 20 });
      items = fb.items;
    } catch (err) {
      console.warn("[seller ddg]", err.message);
    }
  }

  if (!items.length) throw new Error(`Vendeur ${sellerName} introuvable`);

  // Prix manquants (souvent via DDG/Bing) → estimation réaliste
  items = items.map((i, idx) => ({
    ...i,
    price: i.price && i.price > 0 ? i.price : Number((6 + ((idx * 7) % 25) + (i.sold || 0) * 0.02).toFixed(2)),
  }));

  const prices = items.map((i) => i.price).filter((p) => typeof p === "number" && p > 0);
  const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 12;
  const totalSold = items.reduce((a, b) => a + (b.sold || 0), 0) || Math.round(items.length * 4);
  const revenue = Number(((totalSold || items.length * 3) * (avgPrice || 15) * 0.35).toFixed(2));
  const bestsellers = [...items]
    .sort((a, b) => (b.sold || 0) - (a.sold || 0))
    .slice(0, 8)
    .map((i) => ({
      title: i.title,
      price: i.price || 0,
      sold: i.sold || Math.round(5 + Math.random() * 30),
      url: i.url || `https://${domain}/sch/i.html?_nkw=${encodeURIComponent(i.title)}`,
      image: i.image || null,
    }));

  return {
    seller: sellerName,
    revenue,
    activeListings: items.length,
    avgPrice: Number(avgPrice.toFixed(2)),
    sellThrough: Math.min(85, Math.round((totalSold / Math.max(items.length, 1)) * 10) || 15),
    successfulSales: totalSold || Math.round(items.length * 2.5),
    totalSold,
    followers: Math.max(5, Math.round(items.length * 1.7)),
    bestsellers,
    location: marketplace === "US" ? "United States" : "France",
    source: "live-search",
    live: true,
  };
}

/**
 * Classements : requêtes "best seller" / catégories populaires
 */
async function scrapeRankings({ marketplace = "FR" } = {}) {
  const seeds = [
    "coque iphone",
    "verre trempé",
    "colle b7000",
    "bande led",
    "chargeur usb c",
  ];
  const all = [];
  for (const q of seeds) {
    try {
      const { items } = await scrapeEbaySearch(q, { marketplace, limit: 4 });
      items.forEach((it) => all.push({ ...it, seed: q }));
    } catch (_) {}
  }
  const uniq = [];
  const seen = new Set();
  for (const it of all.sort((a, b) => (b.sold || 0) - (a.sold || 0))) {
    const key = it.title.slice(0, 40).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(it);
    if (uniq.length >= 12) break;
  }

  return uniq.map((p, i) => ({
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
  }));
}

/**
 * Analyse de mots-clés à partir des titres eBay réels
 */
function buildKeywordAnalysisFromItems(query, items) {
  const freq = new Map();
  const stop = new Set([
    "the", "and", "for", "with", "de", "la", "le", "les", "des", "et", "en", "un", "une", "du", "au", "aux", "pour", "sur", "new", "neuf", "lot",
  ]);

  for (const item of items) {
    const words = item.title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stop.has(w));
    const uniq = [...new Set(words)];
    for (const w of uniq) {
      const cur = freq.get(w) || { keyword: w, count: 0, sales: 0 };
      cur.count += 1;
      cur.sales += item.sold || 1;
      freq.set(w, cur);
    }
    // bigrams
    for (let i = 0; i < words.length - 1; i++) {
      const bi = `${words[i]} ${words[i + 1]}`;
      const cur = freq.get(bi) || { keyword: bi, count: 0, sales: 0 };
      cur.count += 1;
      cur.sales += item.sold || 1;
      freq.set(bi, cur);
    }
  }

  const ranked = [...freq.values()].sort((a, b) => b.count - a.count || b.sales - a.sales);
  const keywords = ranked
    .filter((k) => !k.keyword.includes(" "))
    .slice(0, 12)
    .map((k) => ({ keyword: k.keyword, searches: k.count * 120, sales: k.sales }));
  const longTail = ranked
    .filter((k) => k.keyword.includes(" "))
    .slice(0, 12)
    .map((k) => ({ keyword: k.keyword, searches: k.count * 40, sales: k.sales }));
  const generic = [
    { keyword: "qualité premium", searches: 5000, sales: 120 },
    { keyword: "livraison rapide", searches: 4200, sales: 98 },
    { keyword: "neuf", searches: 9000, sales: 210 },
    { keyword: "garantie", searches: 3100, sales: 75 },
  ];

  // Inject query itself
  if (!keywords.find((k) => k.keyword === query.toLowerCase())) {
    keywords.unshift({ keyword: query.toLowerCase(), searches: items.length * 200, sales: items.reduce((a, i) => a + (i.sold || 1), 0) });
  }

  return {
    query,
    analyzedListings: items.length,
    keywords,
    longTail,
    generic,
    live: true,
    sampleTitles: items.slice(0, 5).map((i) => i.title),
  };
}

/**
 * Parse HTML résultats Amazon → items {title,url,price,image}
 */
function parseAmazonSearchHtml(html, finalUrl, query, limit = 5) {
  const $ = cheerio.load(html);
  const items = [];
  const seen = new Set();

  const pushItem = (title, link, price, image) => {
    if (!title || title.length < 8 || !link) return;
    const asin = (String(link).match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i) || [])[1];
    const key = asin || String(link).split("?")[0];
    if (seen.has(key)) return;
    if (/sign in|compte|panier|prime|deliver to|results for/i.test(title)) return;
    seen.add(key);
    const canonical = asin ? `https://www.amazon.fr/dp/${asin}` : String(link).split("?")[0];
    items.push({
      title: title.slice(0, 180),
      url: canonical,
      price: price > 0 ? price : null,
      image: image || null,
      source: "amazon",
      priceFromMarketplaceCard: !!(price > 0),
    });
  };

  $("[data-component-type='s-search-result']").each((_, el) => {
    if (items.length >= limit) return;
    const root = $(el);
    const asin = String(root.attr("data-asin") || "").trim();
    if (!asin || asin.length < 8) return;
    const title = cleanText(
      root.find("h2").first().text() ||
        root.find("span.a-size-base-plus, span.a-size-medium, span.a-text-normal").first().text()
    );
    const href =
      root.find('a[href*="/dp/"]').first().attr("href") ||
      root.find('a[href*="/gp/product/"]').first().attr("href") ||
      "";
    const link = href ? absUrl(finalUrl, href) : `https://www.amazon.fr/dp/${asin}`;
    const price = parsePrice(
      root.find(".a-price .a-offscreen").first().text() ||
        root.find(".a-price").first().text() ||
        root.find("[data-a-color='price']").first().text()
    );
    const image = root.find("img.s-image").attr("src") || root.find("img").first().attr("src");
    pushItem(title, link, price, image);
  });

  if (!items.length) {
    const asins = [
      ...new Set(
        (html.match(/data-asin="([A-Z0-9]{10})"/g) || []).map((m) => m.match(/([A-Z0-9]{10})/)[1])
      ),
    ];
    for (const asin of asins.slice(0, limit * 2)) {
      if (items.length >= limit) break;
      const idx = html.indexOf(`data-asin="${asin}"`);
      const slice = html.slice(idx, idx + 2500);
      const titleMatch =
        slice.match(/<h2[^>]*>[\s\S]*?<span[^>]*>([^<]{12,160})<\/span>/i) ||
        slice.match(/<h2[^>]*>([^<]{12,160})<\/h2>/i);
      const title = cleanText(titleMatch?.[1] || `${query} — Amazon ${asin}`);
      const priceMatch = slice.match(/a-offscreen[^>]*>([^<]*\d+[.,]\d{2}[^<]*)</i);
      const price = parsePrice(priceMatch?.[1] || "");
      pushItem(title, `https://www.amazon.fr/dp/${asin}`, price, null);
    }
  }
  return items.slice(0, limit);
}

/**
 * Recherche produits fournisseurs (Amazon FR search page)
 */
async function scrapeAmazonSearch(query, { limit = 5, onLog = null } = {}) {
  const log = (msg) => {
    console.log(msg);
    if (typeof onLog === "function") {
      try {
        onLog(msg);
      } catch (_) {}
    }
  };
  const url = `https://www.amazon.fr/s?k=${encodeURIComponent(query)}`;
  const preferChrome = process.platform === "win32";

  // 1) Sur Windows : Chrome d'abord (Node fetch = captcha quasi certain)
  try {
    log(`[amazon] Recherche "${query}" (${preferChrome ? "Chrome→curl→fetch" : "fetch→curl→Chrome"})…`);
    const { html, finalUrl } = await fetchHtmlResilient(url, {
      preferChrome,
      extraHeaders: { Referer: "https://www.amazon.fr/" },
    });
    const blocked = isAmazonBlockedHtml(html);
    const cardCount = (html.match(/data-component-type="s-search-result"/g) || []).length;
    log(`[amazon] HTML len=${html.length} cards=${cardCount} captcha=${blocked ? "oui" : "non"}`);
    if (!blocked) {
      const items = parseAmazonSearchHtml(html, finalUrl, query, limit);
      if (items.length) {
        log(`[amazon] ✓ ${items.length} résultat(s) trouvés`);
        return items;
      }
      log(`[amazon] Page OK mais 0 carte parsée — essai Chrome forcé…`);
    } else {
      log(`[amazon] Captcha détecté — essai Chrome forcé…`);
    }
    try {
      const viaChrome = await fetchHtmlViaChrome(url, { waitMs: 4000 });
      const items = parseAmazonSearchHtml(viaChrome.html, viaChrome.finalUrl, query, limit);
      if (items.length) {
        log(`[amazon] ✓ Chrome: ${items.length} résultat(s)`);
        return items;
      }
      log(`[amazon] Chrome OK mais 0 produit parsé`);
    } catch (e) {
      log(`[amazon] Chrome échec: ${e.message}`);
    }
  } catch (err) {
    log(`[amazon] fetch/curl échec: ${err.message}`);
    try {
      const viaChrome = await fetchHtmlViaChrome(url, { waitMs: 4000 });
      const items = parseAmazonSearchHtml(viaChrome.html, viaChrome.finalUrl, query, limit);
      if (items.length) {
        log(`[amazon] ✓ Chrome: ${items.length} résultat(s)`);
        return items;
      }
    } catch (e) {
      log(`[amazon] Chrome échec: ${e.message}`);
    }
  }

  // 2) Variante sans accents
  const asciiQ = String(query || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (asciiQ && asciiQ.toLowerCase() !== String(query).toLowerCase()) {
    try {
      log(`[amazon] Retry sans accents: "${asciiQ}"`);
      const altUrl = `https://www.amazon.fr/s?k=${encodeURIComponent(asciiQ)}`;
      const via = await fetchHtmlResilient(altUrl, { preferChrome: true });
      if (!isAmazonBlockedHtml(via.html)) {
        const items = parseAmazonSearchHtml(via.html, via.finalUrl, asciiQ, limit);
        if (items.length) {
          log(`[amazon] ✓ ${items.length} résultat(s) (sans accents)`);
          return items;
        }
      }
    } catch (e) {
      log(`[amazon] Retry accents: ${e.message}`);
    }
  }

  // 3) Jina
  try {
    log(`[amazon] Fallback Jina…`);
    const content = await fetchJinaContent(url);
    const items = [];
    const re = /\[([^\]]{8,140})\]\((https:\/\/www\.amazon\.[a-z.]+\/[^\s)]+)\)/g;
    let m;
    const seen = new Set();
    while ((m = re.exec(content)) && items.length < limit) {
      const title = cleanText(m[1]);
      let link = m[2].split(")")[0].split(" ")[0];
      if (seen.has(link) || /sign in|account|panier|prime|deliver to|filters|keyboard|skip to/i.test(title)) continue;
      const asin = (link.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i) || [])[1];
      if (!asin && !/\/dp\//i.test(link)) continue;
      seen.add(link);
      items.push({
        title,
        url: asin ? `https://www.amazon.fr/dp/${asin}` : link,
        price: null,
        image: null,
        source: "amazon+jina",
      });
    }
    if (items.length) {
      log(`[amazon] ✓ Jina: ${items.length}`);
      return items;
    }
  } catch (err) {
    log(`[amazon] Jina: ${err.message}`);
  }

  // 4) Bing / DDG — plusieurs formulations
  try {
    log(`[amazon] Fallback Bing/DDG…`);
    const queries = [
      `${query} site:amazon.fr/dp`,
      `${query} site:amazon.fr`,
      `"${query}" amazon.fr`,
      `${query} amazon.fr €`,
    ];
    let ddg = [];
    for (const sq of queries) {
      ddg = await searchViaDuckDuckGo(sq, {
        limit: limit + 2,
        linkTest: (link) => /amazon\.[a-z.]+\/(?:.*\/)?(?:dp|gp\/product)\//i.test(link),
      });
      if (ddg.length) break;
    }
    if (ddg.length) {
      log(`[amazon] ✓ Bing/DDG: ${ddg.length} lien(s)`);
      return ddg.map((i) => {
        const asin = (String(i.url).match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i) || [])[1];
        return {
          ...i,
          url: asin ? `https://www.amazon.fr/dp/${asin}` : i.url,
          source: "amazon+ddg",
        };
      });
    }
  } catch (err) {
    log(`[amazon] Bing/DDG: ${err.message}`);
  }

  log(
    `[amazon] ✗ ÉCHEC total — installe Google Chrome (pas Playwright) ou utilise Import Manuel avec une URL amazon.fr/dp/...`
  );
  return [];
}

async function fetchJinaContent(url) {
  const attempts = [
    { headers: { Accept: "application/json", "User-Agent": UA } },
    { headers: { Accept: "text/plain", "User-Agent": UA } },
    { url: `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`, headers: { "User-Agent": UA } },
  ];
  let lastErr = null;
  for (const opt of attempts) {
    try {
      const target = opt.url || `https://r.jina.ai/${url}`;
      const res = await fetch(target, { headers: opt.headers });
      if (!res.ok) {
        lastErr = new Error(`Jina ${res.status}`);
        continue;
      }
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const payload = await res.json();
        const text = String(payload.data?.content || payload.data?.text || "");
        if (text.length > 80) return text;
      } else {
        const text = await res.text();
        if (text.length > 80) return text;
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Jina unavailable");
}

async function searchViaBingRss(query, { linkTest, limit = 8 } = {}) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/rss+xml,application/xml,text/xml,*/*" },
    });
    if (res.ok) {
      const xml = await res.text();
      const $ = cheerio.load(xml, { xmlMode: true });
      const items = [];
      const seen = new Set();
      $("item").each((_, el) => {
        if (items.length >= limit) return;
        const title = cleanText($(el).find("title").first().text());
        let link = cleanText($(el).find("link").first().text());
        const snippet = cleanText($(el).find("description").first().text());
        if (!title || title.length < 8 || !link) return;
        if (typeof linkTest === "function" && !linkTest(link)) return;
        link = link.split("#")[0];
        if (seen.has(link)) return;
        if (/tracking|privacy|sitemap|intellectual property/i.test(title)) return;
        seen.add(link);
        items.push({
          title: title.slice(0, 180),
          url: link,
          price: parsePrice(title) || parsePrice(snippet) || null,
          image: null,
          snippet,
        });
      });
      if (items.length) return items;
    }
  } catch (_) {}

  // Fallback HTML Bing (RSS souvent vide / bloqué)
  return searchViaBingHtml(query, { linkTest, limit });
}

async function searchViaBingHtml(query, { linkTest, limit = 8 } = {}) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=30&setlang=fr-FR`;
  let html = "";
  try {
    ({ html } = await fetchHtmlViaCurl(url));
  } catch (_) {
    try {
      ({ html } = await fetchHtml(url));
    } catch (_) {
      return [];
    }
  }
  if (!html || html.length < 500) return [];
  const $ = cheerio.load(html);
  const items = [];
  const seen = new Set();

  const push = (title, link, snippet = "") => {
    if (items.length >= limit) return;
    if (!title || title.length < 8 || !link) return;
    if (typeof linkTest === "function" && !linkTest(link)) return;
    link = String(link).split("#")[0].split("&")[0];
    // Normalise Ali item URLs
    const aliId = (link.match(/\/item\/(\d{6,})/i) || [])[1];
    if (aliId) link = `https://fr.aliexpress.com/item/${aliId}.html`;
    const asin = (link.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i) || [])[1];
    if (asin) link = `https://www.amazon.fr/dp/${asin}`;
    if (seen.has(link)) return;
    if (/bing\.com|microsoft|privacy|login|duckduckgo/i.test(title)) return;
    seen.add(link);
    const price = parsePrice(title) || parsePrice(snippet) || extractAllPrices(`${title} ${snippet}`)[0] || null;
    items.push({
      title: title.slice(0, 180),
      url: link,
      price: price > 0 ? price : null,
      image: null,
      snippet: cleanText(snippet).slice(0, 240),
    });
  };

  $("li.b_algo, .b_algo").each((_, el) => {
    const root = $(el);
    const a = root.find("h2 a").first();
    push(
      cleanText(a.text() || root.find("h2").text()),
      a.attr("href") || "",
      root.find(".b_caption p, .b_lineclamp2, .b_snippet").text()
    );
  });

  if (items.length < limit) {
    $("a[href]").each((_, el) => {
      if (items.length >= limit) return;
      const a = $(el);
      const href = a.attr("href") || "";
      if (!/aliexpress\.|amazon\.|cdiscount\./i.test(href)) return;
      push(cleanText(a.text()) || cleanText(a.attr("aria-label")), href, "");
    });
  }
  return items.slice(0, limit);
}

async function searchViaDuckDuckGo(siteQuery, { linkTest, limit = 5 } = {}) {
  // 1) Bing RSS — plus stable que le HTML DDG/Bing (souvent captcha)
  try {
    const rss = await searchViaBingRss(siteQuery, { linkTest, limit });
    if (rss.length) return rss;
  } catch (err) {
    console.warn("[bing rss]", err.message);
  }

  const attempts = [
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(siteQuery)}`,
    `https://www.bing.com/search?q=${encodeURIComponent(siteQuery)}&count=20`,
  ];
  const items = [];
  const seen = new Set();
  for (const url of attempts) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "fr-FR,fr;q=0.9" },
      });
      if (!res.ok) continue;
      const html = await res.text();
      if (/anomaly|challenge|unusual traffic|captcha/i.test(html.slice(0, 2500))) continue;
      const $ = cheerio.load(html);

      // DuckDuckGo result blocks
      $(".result, .b_algo, li.b_algo").each((_, el) => {
        if (items.length >= limit) return;
        const root = $(el);
        const a = root.find("a.result__a, h2 a, a").first();
        let link = a.attr("href") || "";
        const uddg = link.match(/uddg=([^&]+)/);
        if (uddg) link = decodeURIComponent(uddg[1]);
        let title = cleanText(a.text() || root.find("h2").text());
        const snippet = cleanText(root.find(".result__snippet, .b_caption p, .b_lineclamp2").text());
        if (!title || title.length < 8) return;
        if (!linkTest(link)) return;
        link = link.split("&")[0].split("#")[0];
        if (seen.has(link)) return;
        if (/duckduckgo|bing\.com|microsoft|privacy|login|^https?:\/\/[^\/]+\/?$/i.test(title)) return;
        if (/^cdiscount\.com$|^amazon\.|^aliexpress/i.test(title)) {
          // titre = nom de domaine → utiliser snippet
          if (snippet.length > 15) title = snippet.slice(0, 120);
          else return;
        }
        seen.add(link);
        const price = parsePrice(title) || parsePrice(snippet) || null;
        items.push({
          title: title.slice(0, 160),
          url: link,
          price,
          image: null,
          snippet,
        });
      });

      // Fallback: raw anchors
      if (!items.length) {
        $("a").each((_, el) => {
          if (items.length >= limit) return;
          const root = $(el);
          let link = root.attr("href") || "";
          const uddg = link.match(/uddg=([^&]+)/);
          if (uddg) link = decodeURIComponent(uddg[1]);
          const title = cleanText(root.text());
          if (!title || title.length < 15) return;
          if (!linkTest(link)) return;
          link = link.split("&")[0].split("#")[0];
          if (seen.has(link) || /duckduckgo|bing\.com|microsoft|privacy|login/i.test(title)) return;
          seen.add(link);
          items.push({
            title: title.slice(0, 160),
            url: link,
            price: parsePrice(title) || null,
            image: null,
          });
        });
      }
      if (items.length >= limit) break;
    } catch (_) {}
  }
  return items.filter((i) => i.title.length > 12).slice(0, limit);
}

function extractPricesNear(text, index, window = 120) {
  const slice = text.slice(Math.max(0, index - 40), index + window);
  const prices = [];
  for (const n of extractAllPrices(slice)) {
    if (n && n >= 0.5 && n < 5000) prices.push(n);
  }
  // Also decimals near the link without currency
  const re = /(\d+[.,]\d{2})(?!\s*(?:mm|cm|m\b|V\b|W\b|K\b|leds?))/gi;
  let m;
  while ((m = re.exec(slice))) {
    const n = parsePrice(m[1] + " €");
    if (n && n >= 0.5 && n < 5000) prices.push(n);
  }
  return prices;
}

/**
 * Recherche AliExpress — Bing/DDG d'abord (HTML Ali souvent captcha), puis enrichissement prix.
 */
async function scrapeAliExpressSearch(query, { limit = 5, onLog = null, fast = false } = {}) {
  const log = (msg) => {
    console.log(msg);
    if (typeof onLog === "function") {
      try {
        onLog(msg);
      } catch (_) {}
    }
  };
  const q = String(query || "").trim();
  const linkTest = (link) => /aliexpress\.[a-z.]+\/item\/\d+/i.test(String(link || ""));
  const byId = new Map();

  const absorb = (list, sourceTag) => {
    for (const i of list || []) {
      if (!i?.url || !linkTest(i.url)) continue;
      const id = extractAliProductId(i.url);
      if (!id) continue;
      const url = `https://fr.aliexpress.com/item/${id}.html`;
      const prev = byId.get(id);
      let title = cleanText(i.title || "").replace(/\s*[-–|]\s*AliExpress.*$/i, "").trim();
      if (isPlaceholderSupplierTitle(title, q)) title = "";
      else if (title && title.length > 8 && !titleMatchesQuery(title, q)) continue;
      const rawPrice = i.price > 0 ? i.price : null;
      const price = rawPrice ? sanitizeAliExpressPrice(rawPrice, title) : null;
      if (!prev) {
        byId.set(id, {
          title: title || "",
          url,
          price,
          image: i.image || null,
          source: sourceTag,
          snippet: i.snippet || "",
          priceFromMarketplaceCard: !!(price > 0),
        });
      } else {
        if (price > 0 && !(prev.price > 0)) prev.price = price;
        if (title.length > String(prev.title || "").length) prev.title = title;
      }
    }
  };

  // 1) Bing / DDG EN PREMIER — fiable pour obtenir des /item/{id}
  const searchQueries = [
    `site:fr.aliexpress.com/item ${q}`,
    `site:aliexpress.com/item ${q}`,
    `${q} aliexpress`,
    `${q} site:aliexpress.com €`,
    `"${q}" aliexpress.fr`,
  ];
  log(`[aliexpress] Recherche Bing/DDG "${q}"…`);
  for (const sq of searchQueries) {
    if (byId.size >= limit) break;
    try {
      const hits = await searchViaDuckDuckGo(sq, { limit: limit + 4, linkTest });
      absorb(hits, "aliexpress+bing");
      log(`[aliexpress] ${sq.slice(0, 40)}… → ${hits.length} lien(s) (total ${byId.size})`);
    } catch (e) {
      log(`[aliexpress] search fail: ${e.message}`);
    }
  }

  // 2) HTML / Jina wholesale si encore vide
  if (byId.size < 2) {
    const urls = [
      `https://fr.aliexpress.com/w/wholesale-${encodeURIComponent(q.replace(/\s+/g, "-"))}.html`,
      `https://www.aliexpress.com/w/wholesale-${encodeURIComponent(q.replace(/\s+/g, "-"))}.html`,
    ];
    for (const url of urls) {
      try {
        const { html } = await fetchHtml(url, {
          Referer: "https://fr.aliexpress.com/",
          Cookie: ALI_EUR_COOKIE,
        });
        if (html.length < 5000 || isBlockedSupplierHtml(html)) continue;
        const re = /aliexpress\.[a-z.]+\/item\/(\d{6,})/gi;
        let m;
        const seen = new Set();
        while ((m = re.exec(html)) && seen.size < limit) {
          if (seen.has(m[1])) continue;
          seen.add(m[1]);
          absorb(
            [
              {
                title: "",
                url: `https://fr.aliexpress.com/item/${m[1]}.html`,
                price: pickPlausibleAliEuro(
                  (extractPricesNear(html, m.index, 280) || [])
                    .map((p) => aliMoneyToEur(p, "EUR"))
                    .filter(Boolean)
                ),
              },
            ],
            "aliexpress"
          );
        }
        if (byId.size) {
          log(`[aliexpress] HTML wholesale → ${byId.size} item(s)`);
          break;
        }
      } catch (e) {
        log(`[aliexpress] wholesale: ${e.message}`);
      }
    }
  }

  let items = [...byId.values()].slice(0, Math.max(limit, 6));
  if (!items.length) {
    log(`[aliexpress] ✗ aucun item trouvé`);
    return [];
  }

  // 3) Loop confirmation du prix pour CHAQUE fiche (rejette 1,00 €)
  log(`[aliexpress] Loop prix + titre pour ${items.length} produit(s)…`);
  for (let i = 0; i < items.length; i++) {
    try {
      const looped = await confirmAliPriceLoop(items[i].url, items[i].title || q, {
        attempts: fast ? 1 : 3,
        onLog: log,
      });
      if (looped.title && looped.title.length > 8) items[i].title = looped.title;
      if (looped.price >= 1.99) {
        items[i].price = looped.price;
        items[i].priceConfirmed = true;
        items[i].priceFromMarketplaceCard = true;
        log(`[aliexpress] ✓ ${looped.price.toFixed(2)}€ — ${String(items[i].title).slice(0, 40)}`);
        continue;
      }
    } catch (_) {}
    const snippetOk = sanitizeAliExpressPrice(items[i].price, items[i].title);
    if (snippetOk >= 1.99) {
      items[i].price = snippetOk;
      items[i].priceConfirmed = true;
      continue;
    }
    items[i].price = null;
    const fromSnippet = extractAllPrices(`${items[i].title} ${items[i].snippet || ""}`)
      .map((n) => sanitizeAliExpressPrice(n, items[i].title))
      .find((n) => n >= 1.99);
    if (fromSnippet >= 1.99) {
      items[i].price = fromSnippet;
      items[i].priceConfirmed = true;
      log(`[aliexpress] ✓ prix snippet ${fromSnippet.toFixed(2)}€`);
    }
  }

  items = items.filter((i) => {
    if (!i.url) return false;
    if (!i.title || i.title.length < 8) return false;
    return titleMatchesQuery(i.title, q);
  });

  // Garde ceux avec prix en tête
  items.sort((a, b) => {
    const ap = a.price > 0 ? 0 : 1;
    const bp = b.price > 0 ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return (a.price || 999) - (b.price || 999);
  });

  const priced = items.filter((i) => i.price > 0).length;
  log(`[aliexpress] ✓ ${items.length} produit(s), ${priced} avec prix`);
  return items.slice(0, limit);
}

/**
 * Recherche Cdiscount — HTML direct puis Jina puis DuckDuckGo.
 */
async function scrapeCdiscountSearch(query, { limit = 5, onLog = null } = {}) {
  const log = (msg) => {
    console.log(msg);
    if (typeof onLog === "function") {
      try {
        onLog(msg);
      } catch (_) {}
    }
  };
  const slug = encodeURIComponent(String(query || "").trim());
  const url = `https://www.cdiscount.com/search/10/${slug}.html#_his_`;
  log(`[cdiscount] Recherche "${query}"…`);

  try {
    const { html, finalUrl } = await fetchHtml(url, {
      Referer: "https://www.cdiscount.com/",
    });
    const $ = cheerio.load(html);
    const items = [];
    $("a[href]").each((_, el) => {
      if (items.length >= limit * 3) return;
      const root = $(el);
      const href = root.attr("href") || "";
      const link = absUrl(finalUrl, href);
      if (!link || !/cdiscount\.com/i.test(link)) return;
      if (/\/search\/|connexion|panier|aide|cgu|espace-perso|mentions/i.test(link)) return;
      // fiches produit typiques
      if (!/\/f-\d+|\/mp-\d+|-\d+\.html/i.test(link)) return;
      const title = cleanText(root.attr("title") || root.text());
      if (!title || title.length < 10) return;
      const parent = root.closest("li, article, div");
      const price = parsePrice(
        parent.find("[class*='price'], [class*='Price'], .stPrice, [itemprop='price']").first().text() ||
          parent.text()
      );
      const image = parent.find("img").attr("src") || parent.find("img").attr("data-src");
      items.push({
        title: title.slice(0, 160),
        url: link.split("?")[0],
        price,
        image: image ? absUrl(finalUrl, image) : null,
        source: "cdiscount",
        priceFromMarketplaceCard: !!(price > 0),
      });
    });
    const uniq = [];
    const seen = new Set();
    for (const it of items) {
      if (seen.has(it.url)) continue;
      seen.add(it.url);
      uniq.push(it);
      if (uniq.length >= limit) break;
    }
    if (uniq.length) {
      log(`[cdiscount] ✓ ${uniq.length} résultat(s) HTML`);
      return uniq;
    }
    log(`[cdiscount] HTML 0 fiche — fallback Jina/Bing`);
  } catch (err) {
    console.warn("[cdiscount search direct]", err.message);
  }

  try {
    const content = await fetchJinaContent(url);
    const items = [];
    const seen = new Set();
    const re = /\[([^\]]{8,160})\]\((https:\/\/www\.cdiscount\.com\/[^\s)]+\.html[^\s)]*)\)/gi;
    let m;
    while ((m = re.exec(content)) && items.length < limit) {
      const title = cleanText(m[1]);
      const link = m[2].split(")")[0].split(" ")[0].replace(/&amp;/g, "&");
      if (seen.has(link) || /search\/10|connexion|panier/i.test(link)) continue;
      if (/voir plus|filtre|livraison|ajouter/i.test(title)) continue;
      seen.add(link);
      const near = extractPricesNear(content, m.index);
      items.push({
        title,
        url: link,
        price: near[0] || null,
        image: null,
        source: "cdiscount+jina",
      });
    }
    for (let i = 0; i < Math.min(items.length, 2); i++) {
      if (items[i].price) continue;
      try {
        const detail = await scrapeProduct(items[i].url);
        if (detail.price) items[i].price = detail.price;
        if (detail.title?.length > 8) items[i].title = detail.title;
        if (detail.images?.[0]) items[i].image = detail.images[0];
      } catch (_) {}
    }
    if (items.length) return items.slice(0, limit);
  } catch (err) {
    console.warn("[cdiscount search jina]", err.message);
  }

  try {
    const ddg = await searchViaDuckDuckGo(`site:cdiscount.com ${query}`, {
      limit,
      linkTest: (link) => /cdiscount\.com\/.+\.html/i.test(link) && !/search\/10/i.test(link),
    });
    const items = ddg.map((i) => ({ ...i, source: "cdiscount+ddg" }));
    for (let i = 0; i < Math.min(items.length, 2); i++) {
      try {
        const detail = await scrapeProduct(items[i].url);
        if (detail.price) items[i].price = detail.price;
        if (detail.title?.length > 8) items[i].title = detail.title;
        if (detail.images?.[0]) items[i].image = detail.images[0];
      } catch (_) {}
    }
    return items;
  } catch (err) {
    console.warn("[cdiscount ddg]", err.message);
    return [];
  }
}

/**
 * Compare Amazon / AliExpress / Cdiscount EN PARALLÈLE.
 * 1 meilleure offre pertinente par site (pas 3 Amazon).
 */
async function findCheapestSupplier(
  query,
  { sources = ["amazon", "aliexpress", "cdiscount"], limit = 3, onLog = null, priceMin = 0, priceMax = Infinity, fast = false } = {}
) {
  const log = (m) => {
    if (typeof onLog === "function") {
      try {
        onLog(m);
      } catch (_) {}
    }
  };
  const want = (sources.includes("auto") ? ["amazon", "aliexpress", "cdiscount"] : sources).filter((s) =>
    /^(amazon|aliexpress|cdiscount)$/i.test(s)
  );
  const perSourceLimit = 5;

  const scrapeOne = async (name) => {
    try {
      if (name === "amazon") return (await scrapeAmazonSearch(query, { limit: perSourceLimit, onLog })) || [];
      if (name === "aliexpress") return (await scrapeAliExpressSearch(query, { limit: fast ? 3 : perSourceLimit, onLog, fast })) || [];
      return (await scrapeCdiscountSearch(query, { limit: perSourceLimit, onLog })) || [];
    } catch (e) {
      log(`[${name}] échec: ${e.message}`);
      return [];
    }
  };

  log(`[SOURCE] Recherche parallèle ${want.join(" + ")}…`);
  const settled = await Promise.all(
    want.map(async (name) => ({ name, items: await scrapeOne(name) }))
  );

  if (!fast) {
    for (const row of settled) {
      if ((row.items || []).length) continue;
      log(`[SOURCE] ${row.name}: 0 résultat — nouvel essai`);
      row.items = await scrapeOne(row.name);
    }
  }

  const pools = [];
  for (const row of settled) {
    const n = (row.items || []).length;
    log(`[SOURCE] ${row.name}: ${n} candidat(s) brut(s)`);
    for (const i of row.items || []) {
      pools.push({ ...i, source: i.source || row.name });
    }
  }

  const byKey = new Map();
  for (const p of pools) {
    if (!p?.url) continue;
    if (/cdiscount\.com\/[^?]*(?:\/r-|\/f-\d+-nav)/i.test(p.url)) continue;
    const key = String(p.url).split("?")[0].replace(/\/$/, "").toLowerCase();
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, p);
      continue;
    }
    const score = (x) => (x.price > 0 ? 10 : 0) + Math.min(String(x.title || "").length, 40) / 10;
    if (score(p) > score(prev)) byKey.set(key, { ...prev, ...p, price: p.price || prev.price });
    else if (!prev.price && p.price) byKey.set(key, { ...prev, price: p.price });
  }
  const uniq = [...byKey.values()].filter((p) => {
    const title = String(p.title || "");
    if (!title || title.length < 8) return true;
    if (/^cdiscount\.com$|^amazon\.|^aliexpress/i.test(title)) return true;
    if (isPlaceholderSupplierTitle(title, query)) return true;
    return titleMatchesQuery(title, query);
  });

  // Enrichir PRIX/TITRE par site (4 fiches max chacun) — Ali n'est plus évincé par Amazon
  const buckets = { amazon: [], aliexpress: [], cdiscount: [] };
  for (const p of uniq) {
    const k = marketplaceOf(p);
    if (k) buckets[k].push(p);
  }
  for (const src of want) {
    if (fast) break;
    const list = buckets[src] || [];
    const need = list
      .filter((p) => {
        if (!p?.url || /wholesale-|\/search\/|SearchText=|\/r-/i.test(p.url)) return false;
        const titleOk = p.title && p.title.length >= 12 && titleMatchesQuery(p.title, query);
        const priceOk = src === "aliexpress" ? isPlausibleAliEuro(p.price) : p.price > 0;
        return !titleOk || !priceOk;
      })
      .slice(0, 4);
    for (const item of need) {
      try {
        if (src === "aliexpress") {
          const looped = await confirmAliPriceLoop(item.url, item.title, { attempts: fast ? 1 : 3, onLog: log });
          if (looped.price >= 1.99) {
            item.price = looped.price;
            item.priceConfirmed = true;
          } else {
            item.price = null;
          }
          if (looped.title && looped.title.length > 8) item.title = looped.title;
          if (item.price >= 1.99 && item.title) continue;
        }
        const detail = await scrapeProduct(item.url);
        if (detail.price > 0) {
          item.price = detail.price;
          item.priceConfirmed = true;
        }
        if (detail.title && detail.title.length > 12 && !/^produit |^cdiscount\.com$/i.test(detail.title)) {
          item.title = detail.title;
        }
        if (detail.images?.[0]) item.image = detail.images[0];
      } catch (_) {}
    }
  }

  for (const p of uniq) {
    const isAli = marketplaceOf(p) === "aliexpress";
    if (p.price > 0) {
      const cleaned = isAli ? sanitizeAliExpressPrice(p.price, p.title) : sanitizeProductPrice(p.price, p.title);
      p.price = isAli && !isPlausibleAliEuro(cleaned) ? null : cleaned || null;
    }
  }

  const ranked = rankSupplierOffers(uniq, query, {
    limit: 3,
    priceMin,
    priceMax,
  });
  const pricedCount = uniq.filter((p) => p.price > 0 && titleMatchesQuery(p.title, query)).length;
  const summary = ["amazon", "aliexpress", "cdiscount"]
    .map((src) => {
      const hit = ranked.find((p) => marketplaceOf(p) === src);
      return hit ? `${src} ${Number(hit.price).toFixed(2)}€` : `${src} —`;
    })
    .join(" · ");
  log(`[SOURCE] Meilleure offre par site: ${summary}`);

  return {
    best: ranked[0] || null,
    candidates: ranked.slice(0, 3),
    compared: pricedCount,
  };
}

function buildHtmlFromProduct(product, themeColor = "#667eea", opts = {}) {
  const language = normalizeListingLang(opts.language || product?.language || "fr");
  const L = getListingUi(language);
  const enriched = enrichProductListingCopy(product || {}, { language });
  const imgs = (enriched.images || []).filter(isRealProductImage).slice(0, 8);

  const placeholder = `<div style="background:#f4f4f5;border-radius:14px;padding:48px 16px;text-align:center;color:#71717a;font-size:13px;">${escapeHtml(
    L.imagePlaceholder
  )}</div>`;
  const imgTag = (src, maxH = 280) =>
    `<img src="${escapeHtml(src)}" alt="${escapeHtml(enriched.title)}" style="width:100%;border-radius:14px;max-height:${maxH}px;object-fit:cover;" />`;

  const displayTitle = stripSupplierProvenance(enriched.title);
  const shortPitch =
    cleanMarketingCopy(enriched.short_pitch || "") ||
    cleanMarketingCopy(sanitizeReadableText(enriched.description, { maxLen: 220 })) ||
    L.shortPitchFallback(displayTitle);

  const sections = (enriched.sections || []).slice(0, 3);
  const sectionHtml = sections
    .map((sec, idx) => {
      const heading = escapeHtml(sec.heading || `Point ${idx + 1}`);
      const body = escapeHtml(cleanMarketingCopy(sec.body || ""));
      const sideImg = imgs[idx + 1] ? imgTag(imgs[idx + 1], 160) : "";
      return `<div style="display:grid;grid-template-columns:${sideImg ? "1.4fr 1fr" : "1fr"};gap:12px;margin-bottom:14px;align-items:center;">
      <div style="background:#fafafe;border-radius:12px;padding:14px;border:1px solid #eee;">
        <h3 style="font-size:14px;margin:0 0 8px;color:${themeColor};">${heading}</h3>
        <p style="font-size:13px;line-height:1.7;color:#444;margin:0;">${body}</p>
      </div>
      ${sideImg ? `<div>${sideImg}</div>` : ""}
    </div>`;
    })
    .join("\n");

  const hero = imgs[0] ? imgTag(imgs[0], 300) : placeholder;

  const benefitItems = (enriched.benefits || enriched.bullets || [])
    .map((b) => cleanMarketingCopy(String(b).replace(/^\s*source\s*:\s*/i, "").trim()))
    .filter(
      (b) =>
        b &&
        !/^source\s*:/i.test(b) &&
        !/^(AliExpress|Amazon(?:\.[a-z]+)?|Cdiscount|eBay)\s*[\d.]*$/i.test(b) &&
        !/potentiel de marge|politique ebay/i.test(b)
    )
    .slice(0, 8);
  const bulletHtml = benefitItems.length
    ? benefitItems.map((b) => `<li style="margin:0 0 6px;">✔ ${escapeHtml(b)}</li>`).join("")
    : `<li style="margin:0 0 6px;">✔ ${escapeHtml(L.defaultBenefit1)}</li>
       <li style="margin:0 0 6px;">✔ ${escapeHtml(L.defaultBenefit2)}</li>
       <li style="margin:0 0 6px;">✔ ${escapeHtml(L.defaultBenefit3)}</li>`;

  const specs = enriched.specs && typeof enriched.specs === "object" ? enriched.specs : {};
  const specRows = Object.entries(specs)
    .filter(([k, v]) => k && v && !/^source$/i.test(k) && !/aliexpress|amazon|cdiscount/i.test(String(v)))
    .slice(0, 16)
    .map(
      ([k, v]) =>
        `<div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid #f0f0f5;">
        <span style="color:#666;">${escapeHtml(k)}</span>
        <strong style="text-align:right;color:#222;">${escapeHtml(String(v))}</strong>
      </div>`
    )
    .join("");

  const galleryExtra =
    imgs.length > 4
      ? `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px;">
      ${imgs
        .slice(4, 7)
        .map((src) => imgTag(src, 120))
        .join("")}
    </div>`
      : "";

  const rawHtml = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:100%;color:#1a1a2e;background:#fff;" lang="${language}">
  <div style="background:linear-gradient(135deg,${themeColor} 0%,#1e1b4b 100%);border-radius:16px;padding:26px 20px;text-align:center;color:#fff;margin-bottom:18px;">
    <div style="display:inline-flex;gap:8px;margin-bottom:10px;">
      <span style="background:rgba(255,255,255,.2);padding:4px 10px;border-radius:999px;font-size:11px;">${escapeHtml(L.badgePremium)}</span>
      <span style="background:rgba(255,255,255,.2);padding:4px 10px;border-radius:999px;font-size:11px;">${escapeHtml(L.badgeNew)}</span>
      <span style="background:rgba(255,255,255,.2);padding:4px 10px;border-radius:999px;font-size:11px;">${escapeHtml(L.badgeQuality)}</span>
    </div>
    <h1 style="font-size:20px;margin:0 0 8px;line-height:1.35;">${escapeHtml(displayTitle)}</h1>
    <p style="font-size:13px;opacity:.9;margin:0;">${escapeHtml(shortPitch.slice(0, 160))}</p>
  </div>

  <div style="margin-bottom:16px;">${hero}</div>

  <div style="margin-bottom:8px;">
    <h2 style="font-size:15px;margin:0 0 12px;color:${themeColor};">${escapeHtml(L.discover)}</h2>
    ${sectionHtml || `<p style="font-size:13px;line-height:1.75;color:#444;">${escapeHtml(shortPitch)}</p>`}
  </div>

  ${galleryExtra}

  <div style="background:#fafafe;border-radius:12px;padding:16px;margin-bottom:16px;border:1px solid #eee;">
    <h2 style="font-size:15px;margin:0 0 10px;color:${themeColor};">${escapeHtml(L.why)}</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
      <div style="background:#fff;border-radius:10px;padding:12px;text-align:center;border:1px solid #f0f0f5;"><div style="font-size:18px;">✦</div><p style="font-size:11px;font-weight:600;margin:4px 0 0;">${escapeHtml(L.whyQuality)}</p></div>
      <div style="background:#fff;border-radius:10px;padding:12px;text-align:center;border:1px solid #f0f0f5;"><div style="font-size:18px;">✦</div><p style="font-size:11px;font-weight:600;margin:4px 0 0;">${escapeHtml(L.whyPractical)}</p></div>
      <div style="background:#fff;border-radius:10px;padding:12px;text-align:center;border:1px solid #f0f0f5;"><div style="font-size:18px;">✦</div><p style="font-size:11px;font-weight:600;margin:4px 0 0;">${escapeHtml(L.whyReady)}</p></div>
    </div>
  </div>

  <div style="margin-bottom:16px;">
    <h2 style="font-size:15px;margin:0 0 8px;color:${themeColor};">${escapeHtml(L.benefits)}</h2>
    <ul style="margin:0;padding-left:18px;font-size:13px;color:#444;line-height:1.6;">${bulletHtml}</ul>
  </div>

  <div style="border-radius:12px;border:1px solid #e8e8f0;overflow:hidden;margin-bottom:16px;">
    <div style="background:${themeColor};color:#fff;padding:10px 16px;font-size:13px;font-weight:600;">${escapeHtml(L.specs)}</div>
    <div style="padding:12px 16px;font-size:12px;color:#555;line-height:1.6;">
      ${specRows || `<div><strong>${escapeHtml(L.conditionLabel)} :</strong> ${escapeHtml(L.conditionNew)}</div>`}
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
    <div style="background:#f8fafc;border-radius:12px;padding:14px;"><p style="font-size:12px;font-weight:700;margin:0 0 4px;">${escapeHtml(L.content)}</p><p style="font-size:11px;color:#666;margin:0;">${escapeHtml(L.contentBody)}</p></div>
    <div style="background:#f8fafc;border-radius:12px;padding:14px;"><p style="font-size:12px;font-weight:700;margin:0 0 4px;">${escapeHtml(L.selection)}</p><p style="font-size:11px;color:#666;margin:0;">${escapeHtml(L.selectionBody)}</p></div>
    <div style="background:#f8fafc;border-radius:12px;padding:14px;"><p style="font-size:12px;font-weight:700;margin:0 0 4px;">${escapeHtml(L.returns)}</p><p style="font-size:11px;color:#666;margin:0;">${escapeHtml(L.returnsBody)}</p></div>
    <div style="background:#f8fafc;border-radius:12px;padding:14px;"><p style="font-size:12px;font-weight:700;margin:0 0 4px;">${escapeHtml(L.support)}</p><p style="font-size:11px;color:#666;margin:0;">${escapeHtml(L.supportBody)}</p></div>
  </div>

  <div style="background:linear-gradient(135deg,${themeColor} 0%,#1e1b4b 100%);border-radius:12px;padding:18px;text-align:center;color:#fff;">
    <p style="font-size:15px;font-weight:700;margin:0 0 4px;">${escapeHtml(L.cta)}</p>
    <p style="font-size:11px;opacity:.85;margin:0;">${escapeHtml(L.ctaSub)}</p>
  </div>
</div>`;
  return sanitizeListingHtml(rawHtml);
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Compte les <img> avec URL produit réelle (hors placeholders). */
function countRealImagesInHtml(html) {
  const urls = [];
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    if (isRealProductImage(m[1])) urls.push(m[1]);
  }
  return urls.length;
}

/**
 * Injecte des images produit en tête du HTML si aucune <img> réelle.
 * Évite les listings IA / scrub picsum sans galerie → erreur publish eBay.
 */
function injectProductImagesIntoHtml(html, images = []) {
  const srcs = (images || []).filter(isRealProductImage).slice(0, 6);
  if (!srcs.length) return String(html || "");
  if (countRealImagesInHtml(html) > 0) return String(html || "");

  const gallery = `
  <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:12px;margin:16px 0;">
    <div><img src="${escapeHtml(srcs[0])}" alt="Produit" style="width:100%;border-radius:14px;max-height:280px;object-fit:cover;" /></div>
    <div>${srcs
      .slice(1, 3)
      .map(
        (src) =>
          `<img src="${escapeHtml(src)}" alt="" style="width:100%;border-radius:12px;margin-bottom:8px;max-height:130px;object-fit:cover;" />`
      )
      .join("\n")}</div>
  </div>`;

  const raw = String(html || "");
  // Remplace le placeholder « Image produit à ajouter » si présent
  if (/Image produit à ajouter/i.test(raw)) {
    return raw.replace(
      /<div[^>]*>[\s\S]*?Image produit à ajouter[\s\S]*?<\/div>/i,
      gallery
    );
  }
  if (/<div/i.test(raw)) {
    return raw.replace(/<div/i, `${gallery}<div`);
  }
  return gallery + raw;
}

/**
 * Nettoie le paragraphe « Pourquoi Ce Produit ? » dans un HTML listing déjà stocké
 * (CSS/JS Amazon A+ collé par erreur).
 */
function scrubWhySectionInHtml(html) {
  const raw = String(html || "");
  if (!raw) return raw;
  const re =
    /(<h2[^>]*>\s*Pourquoi Ce Produit\s*\?[^<]*<\/h2>[\s\S]*?<\/div>\s*)<p([^>]*)>([\s\S]*?)<\/p>/i;
  const m = raw.match(re);
  if (!m) {
    // fallback : tout paragraphe qui contient du CSS aplus
    return raw.replace(/<p([^>]*)>([\s\S]*?)<\/p>/gi, (full, attrs, body) => {
      const plain = body.replace(/<[^>]+>/g, " ");
      if (!/\.aplus-|function\s+\w+|margin-left|shoppable/i.test(plain)) return full;
      const cleaned = sanitizeReadableText(plain);
      const fallback =
        cleaned ||
        "Produit sélectionné pour sa qualité et sa demande eBay.";
      return `<p${attrs}>${escapeHtml(fallback)}</p>`;
    });
  }
  const body = m[3].replace(/<[^>]+>/g, " ");
  if (!/\.aplus-|function\s+\w+|\{|shoppable|margin-left/i.test(body) && sanitizeReadableText(body)) {
    return raw; // déjà propre
  }
  const cleaned =
    sanitizeReadableText(body) ||
    "Produit sélectionné pour sa qualité et sa demande eBay.";
  return raw.replace(re, `$1<p$2>${escapeHtml(cleanMarketingCopy(cleaned))}</p>`);
}

/** Retire la provenance fournisseur du titre affiché (ex. « - AliExpress 15 »). */
function stripSupplierProvenance(title) {
  return String(title || "")
    .replace(/\s*[-–—|/]\s*(AliExpress|Amazon(?:\.[a-z]+)?|Cdiscount|eBay)\s*[\d.]*\s*$/gi, "")
    .replace(/\s*\((AliExpress|Amazon(?:\.[a-z]+)?|Cdiscount|eBay)[^)]*\)\s*$/gi, "")
    .replace(/\b(AliExpress|Amazon(?:\.[a-z]+)?|Cdiscount|eBay)\s*[\d.]+\s*$/gi, "")
    .replace(/\b(AliExpress|Amazon(?:\.[a-z]+)?|Cdiscount|eBay)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*[-–—|,;]+\s*$/g, "")
    .trim();
}

/** Nettoie les formulations marketing indésirables dans un texte. */
function cleanMarketingCopy(text) {
  return String(text || "")
    .replace(
      /Produit sélectionné pour sa qualité,\s*sa demande eBay et son potentiel de marge\.?/gi,
      "Produit sélectionné pour sa qualité et sa demande eBay."
    )
    .replace(/\s*et son potentiel de marge\.?/gi, ".")
    .replace(/\s*,\s*et son potentiel de marge/gi, "")
    .replace(/^\s*source\s*:\s*/gim, "")
    // Snippets moteurs de recherche / marketplace
    .replace(/\b(?:achetez|buy|compra|koop)\s+.{0,220}?\b(?:sur|at|bei|en)\s+aliexpress\b.{0,220}/gi, "")
    .replace(/\bat\s+aliexpress\b.{0,120}/gi, "")
    .replace(/\bsur\s+aliexpress\b.{0,120}/gi, "")
    .replace(/\b(?:aliexpress|amazon(?:\.[a-z]+)?|cdiscount|ebay)\b/gi, " ")
    .replace(/\bFind more.{0,160}$/gi, "")
    .replace(/\bTrouvez plus.{0,160}$/gi, "")
    .replace(/\bAppréciez Transport.{0,200}$/gi, "")
    .replace(/\bEnjoy Free Shipping.{0,200}$/gi, "")
    .replace(/\bVente à durée limitée.{0,100}$/gi, "")
    .replace(/\bLimited Time Sale.{0,100}$/gi, "")
    .replace(/\bFacile à rendre\b/gi, "")
    .replace(/\bEasy Return\b/gi, "")
    .replace(/\b\d{5,}\b/g, " ") // IDs / codes bruités des snippets
    .replace(/\s{2,}/g, " ")
    .replace(/\s*[-–—|,;]+\s*$/g, "")
    .trim();
}

/**
 * Post-traitement HTML listing : titre sans provenance, sans « potentiel de marge »,
 * sans lignes « Source : » dans les caractéristiques.
 */
function sanitizeListingHtml(html) {
  let h = String(html || "");
  if (!h) return h;
  h = h.replace(
    /Produit sélectionné pour sa qualité,\s*sa demande eBay et son potentiel de marge\.?/gi,
    "Produit sélectionné pour sa qualité et sa demande eBay."
  );
  h = h.replace(/\s*et son potentiel de marge\.?/gi, ".");
  // Lignes / cellules « Source : … »
  h = h.replace(
    /<(?:div|li|p|tr|td|span)([^>]*)>\s*(?:<strong>\s*)?Source\s*:?\s*(?:<\/strong>)?\s*[^<]*(?:<\/(?:div|li|p|tr|td|span)>)?/gi,
    ""
  );
  h = h.replace(/(?:<br\s*\/?>\s*)?Source\s*:\s*[^<\n]+/gi, "");
  // Termes qui déclenchent souvent le filtre eBay 25019
  h = h.replace(/>\s*Garanti\s*</gi, ">Qualité<");
  h = h.replace(/>\s*Garantie\s*</gi, ">Qualité<");
  h = h.replace(/Satisfaction garantie/gi, "Satisfaction client");
  h = h.replace(/Authenticité/gi, "Sélection");
  h = h.replace(/Authentique/gi, "Sélectionné");
  // Titre h1 sans AliExpress / Amazon / …
  h = h.replace(/<h1([^>]*)>([\s\S]*?)<\/h1>/gi, (_, attrs, inner) => {
    const plain = String(inner).replace(/<[^>]+>/g, " ");
    const cleaned = stripSupplierProvenance(plain);
    return `<h1${attrs}>${escapeHtml(cleaned)}</h1>`;
  });
  return h;
}

module.exports = {
  browserLaunchCandidates,
  scrapeProduct,
  scrapeEbaySearch,
  scrapeEbaySeller,
  scrapeRankings,
  scrapeAmazonSearch,
  scrapeAliExpressSearch,
  scrapeCdiscountSearch,
  findCheapestSupplier,
  fetchAliExpressPrice,
  fetchAliExpressMeta,
  confirmAliPriceLoop,
  isPlausibleAliEuro,
  titleMatchesQuery,
  rankSupplierOffers,
  isPlaceholderSupplierTitle,
  pickPlausibleAliEuro,
  aliMoneyToEur,
  detectAliCurrency,
  sanitizeAliExpressPrice,
  normalizeAliExpressEuroPrice,
  searchViaBingRss,
  parsePrice,
  parseEbayCardPrice,
  resolvePriceViaSearch,
  sanitizeProductPrice,
  buildKeywordAnalysisFromItems,
  buildHtmlFromProduct,
  enrichProductListingCopy,
  injectProductImagesIntoHtml,
  countRealImagesInHtml,
  detectSource,
  isRealProductImage,
  sanitizeReadableText,
  scrubWhySectionInHtml,
  stripSupplierProvenance,
  cleanMarketingCopy,
  sanitizeListingHtml,
};
