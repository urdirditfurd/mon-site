/**
 * EBX — eBay API Integration (Sandbox)
 *
 * Prérequis :
 *   1. Créer un compte sur https://developer.ebay.com
 *   2. Créer une application Sandbox → récupérer Client ID + Client Secret
 *   3. Remplir le .env avec les valeurs
 *
 * Ce module utilise l'API REST eBay (Inventory API + OAuth2).
 * En Sandbox, les listings ne sont pas réels — parfait pour tester.
 */

const https = require("https");
const { URL } = require("url");
const { loadEbayEnv, cleanEnvToken } = require("./load-env");
loadEbayEnv();

function env(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function isProduction() {
  return env("EBAY_ENV", "sandbox").toLowerCase() === "production";
}

function ebayRefreshToken() {
  if (isProduction()) {
    return cleanEnvToken(process.env.EBAY_REFRESH_TOKEN_PROD || process.env.EBAY_REFRESH_TOKEN);
  }
  return cleanEnvToken(process.env.EBAY_REFRESH_TOKEN);
}

function ebayUserToken() {
  return cleanEnvToken(process.env.EBAY_USER_TOKEN);
}

function ebayClientId() {
  if (isProduction()) {
    return cleanEnvToken(process.env.EBAY_PROD_CLIENT_ID || process.env.EBAY_CLIENT_ID);
  }
  return cleanEnvToken(process.env.EBAY_CLIENT_ID);
}

function ebayClientSecret() {
  if (isProduction()) {
    return cleanEnvToken(process.env.EBAY_PROD_CLIENT_SECRET || process.env.EBAY_CLIENT_SECRET);
  }
  return cleanEnvToken(process.env.EBAY_CLIENT_SECRET);
}

function ebayApiBase() {
  if (isProduction()) {
    return env("EBAY_API_BASE", "https://api.ebay.com");
  }
  return env("EBAY_API_BASE", "https://api.sandbox.ebay.com");
}

function ebayAuthUrl() {
  if (isProduction()) {
    return env("EBAY_AUTH_URL", "https://api.ebay.com/identity/v1/oauth2/token");
  }
  return env("EBAY_AUTH_URL", "https://api.sandbox.ebay.com/identity/v1/oauth2/token");
}

function ebayTradingUrl() {
  return isProduction() ? "https://api.ebay.com/ws/api.dll" : "https://api.sandbox.ebay.com/ws/api.dll";
}

function ebayFulfillmentPolicyId() {
  if (isProduction()) {
    return env("EBAY_FULFILLMENT_POLICY_ID_PROD") || env("EBAY_FULFILLMENT_POLICY_ID");
  }
  return env("EBAY_FULFILLMENT_POLICY_ID");
}

function ebayPaymentPolicyId() {
  if (isProduction()) {
    return env("EBAY_PAYMENT_POLICY_ID_PROD") || env("EBAY_PAYMENT_POLICY_ID");
  }
  return env("EBAY_PAYMENT_POLICY_ID");
}

function ebayReturnPolicyId() {
  if (isProduction()) {
    return env("EBAY_RETURN_POLICY_ID_PROD") || env("EBAY_RETURN_POLICY_ID");
  }
  return env("EBAY_RETURN_POLICY_ID");
}

function ebaySiteId() {
  // SiteID Trading API
  switch (env("EBAY_MARKETPLACE_ID", "EBAY_US")) {
    case "EBAY_FR":
      return "71";
    case "EBAY_GB":
      return "3";
    case "EBAY_DE":
      return "77";
    case "EBAY_IT":
      return "101";
    case "EBAY_ES":
      return "186";
    case "EBAY_US":
    default:
      return "0";
  }
}

let cachedToken = null;
let tokenExpiry = 0;

function describeAuthState() {
  return {
    env: isProduction() ? "production" : "sandbox",
    hasClientId: Boolean(ebayClientId()),
    hasClientSecret: Boolean(ebayClientSecret()),
    refreshLen: ebayRefreshToken().length,
    userLen: ebayUserToken().length,
  };
}

/**
 * Obtient un access token.
 * Priorité :
 *   1. EBAY_REFRESH_TOKEN → access token auto (~18 mois, recommandé)
 *   2. EBAY_USER_TOKEN collé depuis le portail (~2h, dépannage uniquement)
 */
async function getAccessToken() {
  loadEbayEnv();

  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const refresh = ebayRefreshToken();
  const clientId = ebayClientId();
  const clientSecret = ebayClientSecret();

  if (refresh.length >= 40) {
    if (!clientId || !clientSecret) {
      throw new Error("EBAY_CLIENT_ID et EBAY_CLIENT_SECRET requis pour utiliser EBAY_REFRESH_TOKEN");
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch(ebayAuthUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refresh,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`eBay OAuth refresh failed (${res.status}): ${err}`);
    }

    const data = await res.json();
    cachedToken = data.access_token;
    tokenExpiry = Date.now() + (Number(data.expires_in || 7200) - 60) * 1000;
    return cachedToken;
  }

  const userToken = ebayUserToken();
  if (userToken.length >= 80) {
    return userToken;
  }

  const state = describeAuthState();
  throw new Error(
    [
      "Impossible d'obtenir un access token eBay.",
      `REFRESH_TOKEN=${state.refreshLen} car. | USER_TOKEN=${state.userLen} car.`,
      state.refreshLen === 0
        ? "→ EBAY_REFRESH_TOKEN manquant dans .env — npm run oauth"
        : "→ EBAY_REFRESH_TOKEN trop court — vérifie les guillemets / npm run oauth",
      "Puis ARRÊTE le serveur et relance: node server.js",
    ].join("\n")
  );
}

function ebayMarketplaceLocale() {
  // Inventory Sandbox US exige en-US. Ne pas dériver de Windows FR.
  const market = env("EBAY_MARKETPLACE_ID", "EBAY_US");
  switch (market) {
    case "EBAY_FR":
      return "fr-FR";
    case "EBAY_GB":
      return "en-GB";
    case "EBAY_DE":
      return "de-DE";
    case "EBAY_IT":
      return "it-IT";
    case "EBAY_ES":
      return "es-ES";
    case "EBAY_US":
      return "en-US";
    default:
      return "en-US";
  }
}

/**
 * HTTP eBay Sell via https natif.
 * Évite que fetch/undici injecte Accept-Language: fr sous Windows FR (erreur 25709).
 */
function ebayHttpsRequest(method, urlString, { token, body, contentLanguage = false } = {}) {
  const locale = ebayMarketplaceLocale();
  const url = new URL(urlString);
  const payload = body == null ? null : typeof body === "string" ? body : JSON.stringify(body);

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Accept-Language": locale,
    "User-Agent": "EBX-Dropshipping/1.0",
    Connection: "close",
  };

  if (payload != null) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(payload);
  }
  if (contentLanguage || payload != null) {
    headers["Content-Language"] = locale;
  }

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode || 0,
            ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
            text,
            json: () => {
              try {
                return text ? JSON.parse(text) : null;
              } catch {
                return { raw: text };
              }
            },
            locale,
          });
        });
      }
    );
    req.on("error", reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

async function ensureInventoryLocation(token) {
  const key = process.env.EBAY_MERCHANT_LOCATION_KEY || "default";
  const getUrl = `${ebayApiBase()}/sell/inventory/v1/location/${key}`;

  const existing = await ebayHttpsRequest("GET", getUrl, { token });
  if (existing.status === 200) return key;

  const createUrl = `${ebayApiBase()}/sell/inventory/v1/location/${key}`;
  const body = {
    name: "EBX Warehouse",
    merchantLocationStatus: "ENABLED",
    location: {
      address: {
        addressLine1: "2121 41st Ave",
        city: "San Francisco",
        stateOrProvince: "CA",
        postalCode: "94116",
        country: "US",
      },
    },
    locationTypes: ["WAREHOUSE"],
  };

  const res = await ebayHttpsRequest("POST", createUrl, {
    token,
    body,
    contentLanguage: true,
  });

  if (res.status !== 204 && res.status !== 200 && res.status !== 201 && res.status !== 409) {
    throw new Error(`Inventory location error (${res.status}) [locale=${res.locale}]: ${res.text}`);
  }

  return key;
}

function extractImageUrls(html) {
  const urls = [];
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const src = m[1];
    if (!/^https?:\/\//i.test(src)) continue;
    if (/picsum\.photos|placeholder\.com|via\.placeholder|placehold\.it|lorempixel/i.test(src)) continue;
    if (!urls.includes(src)) urls.push(src);
  }
  return urls;
}

async function downloadImageBuffer(imageUrl) {
  const res = await fetch(imageUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      Referer: "https://www.amazon.fr/",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`download image HTTP ${res.status}`);
  const contentType = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
  if (!/^image\//i.test(contentType) && !/octet-stream/i.test(contentType)) {
    throw new Error(`pas une image (${contentType})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 500) throw new Error("image trop petite");
  if (buf.length > 12 * 1024 * 1024) throw new Error("image trop lourde (>12MB)");
  return { buf, contentType: /^image\//i.test(contentType) ? contentType : "image/jpeg" };
}

/**
 * Héberge une image sur eBay Picture Services (EPS) — corrige "Gallery picture".
 * Amazon bloque souvent eBay → on télécharge nous-mêmes puis on upload en binaire.
 */
async function uploadImageToEbayEps(token, imageUrl, index = 0) {
  const { buf, contentType } = await downloadImageBuffer(imageUrl);
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  const boundary = `----EBX${Date.now()}${index}`;
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<UploadSiteHostedPicturesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Version>1399</Version>
  <WarningLevel>High</WarningLevel>
  <PictureName>ebx_${index}</PictureName>
</UploadSiteHostedPicturesRequest>`;

  const preamble =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="XML Payload"\r\n` +
    `Content-Type: text/xml; charset=UTF-8\r\n\r\n` +
    `${xml}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="image"; filename="ebx_${index}.${ext}"\r\n` +
    `Content-Type: ${contentType}\r\n` +
    `Content-Transfer-Encoding: binary\r\n\r\n`;
  const closing = `\r\n--${boundary}--\r\n`;
  const body = Buffer.concat([Buffer.from(preamble, "utf8"), buf, Buffer.from(closing, "utf8")]);

  const tradingUrl = new URL(ebayTradingUrl());
  const responseText = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: tradingUrl.protocol,
        hostname: tradingUrl.hostname,
        port: 443,
        path: tradingUrl.pathname,
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
          "X-EBAY-API-IAF-TOKEN": token,
          "X-EBAY-API-CALL-NAME": "UploadSiteHostedPictures",
          "X-EBAY-API-SITEID": ebaySiteId(),
          "X-EBAY-API-COMPATIBILITY-LEVEL": "1399",
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });

  const ack = (responseText.match(/<Ack>([^<]+)<\/Ack>/i) || [])[1] || "";
  const fullUrl =
    (responseText.match(/<FullURL>([^<]+)<\/FullURL>/i) || [])[1] ||
    (responseText.match(/<SiteHostedPictureDetails>[\s\S]*?<FullURL>([^<]+)<\/FullURL>/i) || [])[1];
  if (!/Success|Warning/i.test(ack) || !fullUrl) {
    const shortErr = (responseText.match(/<ShortMessage>([^<]+)<\/ShortMessage>/i) || [])[1] || "";
    const longErr = (responseText.match(/<LongMessage>([^<]+)<\/LongMessage>/i) || [])[1] || "";
    throw new Error(`EPS upload fail (${ack || "no-ack"}): ${shortErr || longErr || responseText.slice(0, 220)}`);
  }
  return fullUrl.replace(/&amp;/g, "&");
}

/** Convertit les URLs Amazon/etc. en URLs hébergées eBay (EPS). */
async function hostImagesForGallery(token, sourceUrls) {
  const hosted = [];
  for (let i = 0; i < Math.min(sourceUrls.length, 8); i++) {
    const src = sourceUrls[i];
    try {
      // Déjà hébergée chez eBay
      if (/ebayimg\.com|ebaystatic\.com/i.test(src)) {
        hosted.push(src);
        continue;
      }
      const eps = await uploadImageToEbayEps(token, src, i);
      console.log(`[EBX] Image EPS ${i + 1}/${sourceUrls.length}: OK`);
      hosted.push(eps);
    } catch (err) {
      console.warn(`[EBX] Image EPS ${i + 1} skip: ${err.message}`);
    }
  }
  return hosted;
}

async function createOrReplaceInventoryItem(token, sku, listing, aspects = {}) {
  const url = `${ebayApiBase()}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`;
  const title = (listing.seo_title || "EBX Product").slice(0, 80);
  const sourceImages = extractImageUrls(listing.html_description).slice(0, 8);
  if (!sourceImages.length) {
    throw new Error(
      "Aucune image produit dans le listing HTML. Rouvre Description Builder / Auto-Snipe avec une vraie image avant de publier."
    );
  }

  console.log(`[EBX] Hébergement galerie EPS (${sourceImages.length} image(s))…`);
  const imageUrls = await hostImagesForGallery(token, sourceImages);
  if (!imageUrls.length) {
    throw new Error(
      "Impossible d'héberger les images sur eBay (Gallery). Vérifie que les images source sont accessibles."
    );
  }

  // product.description Inventory API : max 4000 car. (erreur 25718)
  const rawDesc = String(listing.html_description || title);
  const plain = rawDesc
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
  const shortDesc = (plain || title).slice(0, 4000);

  const mergedAspects = {
    Brand: ["Unbranded"],
    ...aspects,
  };

  const body = {
    availability: {
      shipToLocationAvailability: { quantity: 10 },
    },
    condition: "NEW",
    product: {
      title,
      description: shortDesc,
      aspects: mergedAspects,
      imageUrls,
    },
  };

  const res = await ebayHttpsRequest("PUT", url, {
    token,
    body,
    contentLanguage: true,
  });

  if (res.status !== 204 && res.status !== 200) {
    throw new Error(`Inventory API error (${res.status}) [locale=${res.locale}]: ${res.text}`);
  }

  return { sku, status: "inventory_created", imageUrls };
}

function categoryTreeIdForMarketplace(marketplaceId) {
  switch (marketplaceId) {
    case "EBAY_GB":
      return "3";
    case "EBAY_CA":
      return "2";
    case "EBAY_AU":
      return "15";
    case "EBAY_FR":
      return "71";
    case "EBAY_DE":
      return "77";
    case "EBAY_IT":
      return "101";
    case "EBAY_ES":
      return "186";
    case "EBAY_US":
      return "0";
    default:
      return "0";
  }
}

/**
 * Suggère une catégorie feuille via Taxonomy API (évite erreur 25005 non-leaf).
 */
async function suggestLeafCategoryId(token, title) {
  const marketplaceId = env("EBAY_MARKETPLACE_ID", "EBAY_US");
  const treeId = categoryTreeIdForMarketplace(marketplaceId);
  const q = encodeURIComponent(String(title || "electronics").slice(0, 80));
  const url = `${ebayApiBase()}/commerce/taxonomy/v1/category_tree/${treeId}/get_category_suggestions?q=${q}`;

  try {
    const res = await ebayHttpsRequest("GET", url, { token });
    if (!res.ok) {
      console.warn(`[EBX] Taxonomy suggest HTTP ${res.status}: ${res.text.slice(0, 180)}`);
      return null;
    }
    const data = res.json();
    const first = data?.categorySuggestions?.[0]?.category?.categoryId;
    if (first) {
      console.log(
        `[EBX] Catégorie suggérée: ${first} (${data.categorySuggestions[0].category.categoryName || "?"})`
      );
      return String(first);
    }
  } catch (err) {
    console.warn("[EBX] Taxonomy suggest fail:", err.message);
  }
  return null;
}

async function resolveCategoryId(token, title) {
  // 175672 = ancienne valeur d'exemple NON-LEAF → toujours ignorer
  const fromEnv = env("EBAY_CATEGORY_ID");
  const badDefaults = new Set(["175672", "0", "1"]);

  if (fromEnv && badDefaults.has(fromEnv)) {
    console.warn(
      `[EBX] EBAY_CATEGORY_ID=${fromEnv} ignoré (catégorie non-feuille). Suggestion Taxonomy…`
    );
  } else if (fromEnv) {
    console.log(`[EBX] Catégorie .env: ${fromEnv}`);
    return fromEnv;
  }

  const suggested = await suggestLeafCategoryId(token, title);
  if (suggested) return suggested;

  console.warn("[EBX] Taxonomy indisponible — fallback catégorie 9355");
  return "9355";
}

/**
 * Aspects requis pour une catégorie (Taxonomy get_item_aspects_for_category).
 */
async function fetchRequiredAspectNames(token, categoryId) {
  const marketplaceId = env("EBAY_MARKETPLACE_ID", "EBAY_US");
  const treeId = categoryTreeIdForMarketplace(marketplaceId);
  const url =
    `${ebayApiBase()}/commerce/taxonomy/v1/category_tree/${treeId}` +
    `/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`;

  try {
    const res = await ebayHttpsRequest("GET", url, { token });
    if (!res.ok) {
      console.warn(`[EBX] Aspects catégorie HTTP ${res.status}`);
      return [];
    }
    const data = res.json();
    const aspects = data?.aspects || [];
    return aspects
      .filter((a) => a?.aspectConstraint?.aspectRequired)
      .map((a) => ({
        name: a.localizedAspectName || a.aspectName,
        values: (a.aspectValues || []).map((v) => v.localizedValue || v.value).filter(Boolean),
      }))
      .filter((a) => a.name);
  } catch (err) {
    console.warn("[EBX] fetchRequiredAspectNames:", err.message);
    return [];
  }
}

function guessAspectValue(aspectName, title, allowedValues) {
  const name = String(aspectName || "").toLowerCase();
  const t = String(title || "");
  const tl = t.toLowerCase();

  const pickAllowed = (...candidates) => {
    if (!allowedValues?.length) return candidates[0] || "Yes";
    for (const c of candidates) {
      const hit = allowedValues.find((v) => String(v).toLowerCase() === String(c).toLowerCase());
      if (hit) return hit;
    }
    // partial match
    for (const c of candidates) {
      const hit = allowedValues.find((v) => String(v).toLowerCase().includes(String(c).toLowerCase()));
      if (hit) return hit;
    }
    return allowedValues[0];
  };

  if (/internet\s*connectivity|connectivity|network|wifi|wi-?fi/.test(name)) {
    if (/cellular|5g|4g|lte|wifi\s*\+\s*cellular|wi-?fi\s*\+\s*cell/i.test(t)) {
      return pickAllowed("Wi-Fi + Cellular", "WiFi + Cellular", "Cellular", "5G");
    }
    return pickAllowed("Wi-Fi", "WiFi", "Wireless", "Yes");
  }
  if (/^brand$|marque/.test(name)) {
    const brands = ["Apple", "Samsung", "Google", "Sony", "Microsoft", "Amazon", "Lenovo", "HP", "Dell"];
    for (const b of brands) {
      if (new RegExp(`\\b${b}\\b`, "i").test(t)) return pickAllowed(b);
    }
    return pickAllowed("Unbranded", "Does not apply", "Generic");
  }
  if (/storage|capacity|capacite/.test(name)) {
    const m = t.match(/\b(32|64|128|256|512)\s*GB\b/i) || t.match(/\b(1|2)\s*TB\b/i);
    if (m) return pickAllowed(m[0].replace(/\s+/g, ""), m[0]);
    return pickAllowed("64 GB", "64GB", "Does Not Apply");
  }
  if (/screen|display|taille|size/.test(name) && /inch|pouce|"/.test(tl)) {
    const m = t.match(/\b(\d{1,2}(?:\.\d)?)\s*(?:-?inch|pouces?|"|”)/i);
    if (m) return pickAllowed(`${m[1]} in`, `${m[1]}"`, m[1]);
  }
  if (/color|couleur/.test(name)) {
    const colors = ["Pink", "Black", "White", "Blue", "Gray", "Grey", "Silver", "Gold", "Purple", "Red", "Green"];
    for (const c of colors) {
      if (new RegExp(`\\b${c}\\b`, "i").test(t)) return pickAllowed(c);
    }
    return pickAllowed("Black", "Multicolor", "Does Not Apply");
  }
  if (/model|mod[eè]le/.test(name)) {
    if (/ipad\s*air/i.test(t)) return pickAllowed("iPad Air", "Apple iPad Air");
    if (/ipad\s*pro/i.test(t)) return pickAllowed("iPad Pro");
    if (/iphone/i.test(t)) return pickAllowed("iPhone");
    return pickAllowed(t.slice(0, 50), "Does Not Apply");
  }
  if (/type|type de/.test(name)) {
    if (/ipad|tablet/i.test(t)) return pickAllowed("Tablet", "iPad", "Slate");
    return pickAllowed(allowedValues?.[0] || "Other", "Does Not Apply");
  }

  if (allowedValues?.length) return allowedValues[0];
  return "Does Not Apply";
}

async function buildAspectsForCategory(token, categoryId, title) {
  const required = await fetchRequiredAspectNames(token, categoryId);
  const aspects = {};

  // Toujours utiles
  aspects.Brand = [guessAspectValue("Brand", title, ["Apple", "Samsung", "Unbranded"])];

  for (const asp of required) {
    const value = guessAspectValue(asp.name, title, asp.values);
    aspects[asp.name] = [value];
  }

  // Filet de sécurité connu pour tablettes / iPad
  if (/ipad|tablet|tab\b/i.test(title) && !aspects["Internet Connectivity"]) {
    aspects["Internet Connectivity"] = [/cellular|5g|4g/i.test(title) ? "Wi-Fi + Cellular" : "Wi-Fi"];
  }

  console.log(`[EBX] Aspects: ${Object.keys(aspects).join(", ")}`);
  return aspects;
}

async function createOffer(token, sku, listing, categoryId) {
  const url = `${ebayApiBase()}/sell/inventory/v1/offer`;

  const listingHtml = String(listing.html_description || listing.seo_title || "EBX Product").slice(0, 490000);

  const body = {
    sku,
    marketplaceId: process.env.EBAY_MARKETPLACE_ID || "EBAY_US",
    format: "FIXED_PRICE",
    listingDescription: listingHtml,
    availableQuantity: 10,
    pricingSummary: {
      price: {
        value: String(listing.suggested_price || 29.99),
        currency: process.env.EBAY_CURRENCY || "USD",
      },
    },
    categoryId,
    merchantLocationKey: process.env.EBAY_MERCHANT_LOCATION_KEY || "default",
    listingPolicies: {
      fulfillmentPolicyId: ebayFulfillmentPolicyId(),
      paymentPolicyId: ebayPaymentPolicyId(),
      returnPolicyId: ebayReturnPolicyId(),
    },
  };

  const res = await ebayHttpsRequest("POST", url, {
    token,
    body,
    contentLanguage: true,
  });

  const data = res.json();

  if (!res.ok) {
    throw new Error(`Offer API error (${res.status}) [locale=${res.locale}]: ${JSON.stringify(data)}`);
  }

  return { offerId: data.offerId, status: "offer_created" };
}

async function publishOffer(token, offerId) {
  const url = `${ebayApiBase()}/sell/inventory/v1/offer/${offerId}/publish`;

  const res = await ebayHttpsRequest("POST", url, {
    token,
    body: {},
    contentLanguage: true,
  });

  const data = res.json();

  if (!res.ok) {
    throw new Error(`Publish error (${res.status}) [locale=${res.locale}]: ${JSON.stringify(data)}`);
  }

  return { listingId: data.listingId, status: "published" };
}

async function publishToEbay(listing, listingDbId) {
  loadEbayEnv();
  const missing = [];
  if (!ebayFulfillmentPolicyId()) missing.push(isProduction() ? "EBAY_FULFILLMENT_POLICY_ID_PROD" : "EBAY_FULFILLMENT_POLICY_ID");
  if (!ebayPaymentPolicyId()) missing.push(isProduction() ? "EBAY_PAYMENT_POLICY_ID_PROD" : "EBAY_PAYMENT_POLICY_ID");
  if (!ebayReturnPolicyId()) missing.push(isProduction() ? "EBAY_RETURN_POLICY_ID_PROD" : "EBAY_RETURN_POLICY_ID");
  if (missing.length) {
    throw new Error(
      `Policies manquantes dans .env : ${missing.join(", ")}. ` +
        `Lance npm run policies${isProduction() ? ":prod" : ""} ou ajoute les IDs.`
    );
  }

  const token = await getAccessToken();
  const sku = `EBX-${listingDbId}-${Date.now()}`;
  const title = listing.seo_title || "EBX Product";
  const categoryId = await resolveCategoryId(token, title);
  const aspects = await buildAspectsForCategory(token, categoryId, title);

  console.log(
    `[EBX] Publish (${isProduction() ? "PRODUCTION" : "sandbox"}) SKU=${sku} locale=${ebayMarketplaceLocale()} market=${env("EBAY_MARKETPLACE_ID", "EBAY_US")} category=${categoryId}`
  );

  await ensureInventoryLocation(token);
  await createOrReplaceInventoryItem(token, sku, listing, aspects);
  const { offerId } = await createOffer(token, sku, listing, categoryId);
  const { listingId } = await publishOffer(token, offerId);

  return { sku, offerId, listingId, status: "published", categoryId, env: isProduction() ? "production" : "sandbox" };
}

module.exports = {
  publishToEbay,
  getAccessToken,
  describeAuthState,
  isProduction,
  ebayApiBase,
};
