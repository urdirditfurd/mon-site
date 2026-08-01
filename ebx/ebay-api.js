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

function ebayRefreshToken() {
  return cleanEnvToken(process.env.EBAY_REFRESH_TOKEN);
}

function ebayUserToken() {
  return cleanEnvToken(process.env.EBAY_USER_TOKEN);
}

function ebayClientId() {
  return env("EBAY_CLIENT_ID");
}

function ebayClientSecret() {
  return env("EBAY_CLIENT_SECRET");
}

function ebayApiBase() {
  return env("EBAY_API_BASE", "https://api.sandbox.ebay.com");
}

function ebayAuthUrl() {
  return env("EBAY_AUTH_URL", "https://api.sandbox.ebay.com/identity/v1/oauth2/token");
}

let cachedToken = null;
let tokenExpiry = 0;

function describeAuthState() {
  return {
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

async function createOrReplaceInventoryItem(token, sku, listing) {
  const url = `${ebayApiBase()}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`;
  const title = (listing.seo_title || "EBX Product").slice(0, 80);
  const imageUrls = extractImageUrls(listing.html_description).slice(0, 8);
  if (!imageUrls.length) {
    throw new Error(
      "Aucune image produit dans le listing HTML. Rouvre Description Builder / Auto-Snipe avec une vraie image avant de publier."
    );
  }

  // product.description Inventory API : max 4000 car. (erreur 25718)
  // Le HTML complet va dans l'offre (listingDescription), pas ici.
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

  const body = {
    availability: {
      shipToLocationAvailability: { quantity: 10 },
    },
    condition: "NEW",
    product: {
      title,
      description: shortDesc,
      aspects: {
        Brand: ["Unbranded"],
        Type: ["Exercise Bike"],
      },
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

  return { sku, status: "inventory_created" };
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
  // Ancienne valeur d'exemple (non-leaf) → ignorer
  const fromEnv = env("EBAY_CATEGORY_ID");
  const badDefaults = new Set(["175672", "0", "1"]);

  if (fromEnv && !badDefaults.has(fromEnv)) {
    console.log(`[EBX] Catégorie .env: ${fromEnv}`);
    return fromEnv;
  }

  const suggested = await suggestLeafCategoryId(token, title);
  if (suggested) return suggested;

  // Fallback feuille US souvent valide en Sandbox (Cell Phones & Smartphones)
  console.warn("[EBX] Taxonomy indisponible — fallback catégorie 9355");
  return "9355";
}

async function createOffer(token, sku, listing) {
  const url = `${ebayApiBase()}/sell/inventory/v1/offer`;

  // listingDescription eBay : typiquement jusqu'à ~500 000 car., on borne par sécurité
  const listingHtml = String(listing.html_description || listing.seo_title || "EBX Product").slice(0, 490000);
  const categoryId = await resolveCategoryId(token, listing.seo_title || sku);

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
      fulfillmentPolicyId: process.env.EBAY_FULFILLMENT_POLICY_ID || "",
      paymentPolicyId: process.env.EBAY_PAYMENT_POLICY_ID || "",
      returnPolicyId: process.env.EBAY_RETURN_POLICY_ID || "",
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
  if (!process.env.EBAY_FULFILLMENT_POLICY_ID) missing.push("EBAY_FULFILLMENT_POLICY_ID");
  if (!process.env.EBAY_PAYMENT_POLICY_ID) missing.push("EBAY_PAYMENT_POLICY_ID");
  if (!process.env.EBAY_RETURN_POLICY_ID) missing.push("EBAY_RETURN_POLICY_ID");
  if (missing.length) {
    throw new Error(
      `Policies manquantes dans .env : ${missing.join(", ")}. ` +
        `Ajoute les IDs (ex. 6240367000 / 6240368000 / 6240369000) ou lance npm run policies.`
    );
  }

  const token = await getAccessToken();
  const sku = `EBX-${listingDbId}-${Date.now()}`;

  console.log(
    `[EBX] Publish SKU=${sku} locale=${ebayMarketplaceLocale()} market=${env("EBAY_MARKETPLACE_ID", "EBAY_US")}`
  );

  await ensureInventoryLocation(token);
  await createOrReplaceInventoryItem(token, sku, listing);
  const { offerId } = await createOffer(token, sku, listing);
  const { listingId } = await publishOffer(token, offerId);

  return { sku, offerId, listingId, status: "published" };
}

module.exports = { publishToEbay, getAccessToken, describeAuthState };
