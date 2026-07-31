/**
 * EBX — eBay API Integration (Sandbox)
 *
 * Prérequis :
 *   1. Créer un compte sur https://developer.ebay.com
 *   2. Créer une application Sandbox → récupérer Client ID + Client Secret
 *   3. Remplir le .env avec les valeurs
 *
 * Ce module utilise l'API REST eBay (Inventory API + OAuth2 Client Credentials).
 * En Sandbox, les listings ne sont pas réels — parfait pour tester.
 */

const EBAY_API_BASE = process.env.EBAY_API_BASE || "https://api.sandbox.ebay.com";
const EBAY_AUTH_URL = process.env.EBAY_AUTH_URL || "https://api.sandbox.ebay.com/identity/v1/oauth2/token";
const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID || "";
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET || "";
const EBAY_REFRESH_TOKEN = String(process.env.EBAY_REFRESH_TOKEN || "").trim().replace(/^["']|["']$/g, "");
// Token obtenu via "Sign in to Sandbox for OAuth" (valable ~2h) — mode Sandbox rapide
const EBAY_USER_TOKEN = String(process.env.EBAY_USER_TOKEN || "").trim().replace(/^["']|["']$/g, "");

let cachedToken = null;
let tokenExpiry = 0;

/**
 * Obtient un access token.
 * Priorité :
 *   1. EBAY_REFRESH_TOKEN → access token auto (~18 mois, recommandé)
 *   2. EBAY_USER_TOKEN collé depuis le portail (~2h, dépannage uniquement)
 */
async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  if (EBAY_REFRESH_TOKEN) {
    if (!EBAY_CLIENT_ID || !EBAY_CLIENT_SECRET) {
      throw new Error("EBAY_CLIENT_ID et EBAY_CLIENT_SECRET requis pour utiliser EBAY_REFRESH_TOKEN");
    }

    const credentials = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString("base64");
    const res = await fetch(EBAY_AUTH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: EBAY_REFRESH_TOKEN,
        scope:
          "https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.account https://api.ebay.com/oauth/api_scope/sell.fulfillment",
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

  // Fallback dépannage : token portail (~2h)
  if (EBAY_USER_TOKEN) {
    if (EBAY_USER_TOKEN.length < 80) {
      throw new Error(
        "EBAY_USER_TOKEN trop court (souvent tronqué par #). Mets-le entre guillemets doubles dans .env — ou mieux : npm run oauth pour un refresh token."
      );
    }
    return EBAY_USER_TOKEN;
  }

  throw new Error(
    "Aucun token eBay durable. Lance `npm run oauth` pour obtenir EBAY_REFRESH_TOKEN, ou colle temporairement EBAY_USER_TOKEN (~2h)."
  );
}

/**
 * Crée le lieu d'inventaire "default" s'il n'existe pas encore.
 */
async function ensureInventoryLocation(token) {
  const key = process.env.EBAY_MERCHANT_LOCATION_KEY || "default";
  const getUrl = `${EBAY_API_BASE}/sell/inventory/v1/location/${key}`;

  const existing = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (existing.status === 200) return key;

  const createUrl = `${EBAY_API_BASE}/sell/inventory/v1/location/${key}`;
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

  const res = await fetch(createUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
    },
    body: JSON.stringify(body),
  });

  if (res.status !== 204 && res.status !== 200 && res.status !== 201) {
    const err = await res.text();
    // 409 = déjà existant
    if (res.status !== 409) {
      throw new Error(`Inventory location error (${res.status}): ${err}`);
    }
  }

  return key;
}

/**
 * Extrait les URLs d'images produit depuis le HTML (ignore picsum / placeholders).
 */
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

/**
 * Crée ou met à jour un item dans l'inventaire eBay (Inventory API).
 */
async function createOrReplaceInventoryItem(token, sku, listing) {
  const url = `${EBAY_API_BASE}/sell/inventory/v1/inventory_item/${sku}`;
  const title = (listing.seo_title || "EBX Product").slice(0, 80);
  const imageUrls = extractImageUrls(listing.html_description).slice(0, 8);
  if (!imageUrls.length) {
    throw new Error(
      "Aucune image produit dans le listing HTML. Rouvre Description Builder / Auto-Snipe avec une vraie image avant de publier."
    );
  }

  const body = {
    availability: {
      shipToLocationAvailability: { quantity: 10 },
    },
    condition: "NEW",
    product: {
      title,
      description: listing.html_description || title,
      aspects: {
        Brand: ["Unbranded"],
        Type: ["Exercise Bike"],
      },
      imageUrls,
    },
  };

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
    },
    body: JSON.stringify(body),
  });

  if (res.status !== 204 && res.status !== 200) {
    const err = await res.text();
    throw new Error(`Inventory API error (${res.status}): ${err}`);
  }

  return { sku, status: "inventory_created" };
}

/**
 * Crée une offre (prix + politique) pour un item inventaire.
 */
async function createOffer(token, sku, listing) {
  const url = `${EBAY_API_BASE}/sell/inventory/v1/offer`;

  const body = {
    sku,
    marketplaceId: process.env.EBAY_MARKETPLACE_ID || "EBAY_US",
    format: "FIXED_PRICE",
    listingDescription: listing.html_description,
    availableQuantity: 10,
    pricingSummary: {
      price: {
        value: String(listing.suggested_price || 29.99),
        currency: process.env.EBAY_CURRENCY || "USD",
      },
    },
    categoryId: process.env.EBAY_CATEGORY_ID || "175672",
    merchantLocationKey: process.env.EBAY_MERCHANT_LOCATION_KEY || "default",
    listingPolicies: {
      fulfillmentPolicyId: process.env.EBAY_FULFILLMENT_POLICY_ID || "",
      paymentPolicyId: process.env.EBAY_PAYMENT_POLICY_ID || "",
      returnPolicyId: process.env.EBAY_RETURN_POLICY_ID || "",
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Offer API error (${res.status}): ${JSON.stringify(data)}`);
  }

  return { offerId: data.offerId, status: "offer_created" };
}

/**
 * Publie une offre (la rend visible sur eBay).
 */
async function publishOffer(token, offerId) {
  const url = `${EBAY_API_BASE}/sell/inventory/v1/offer/${offerId}/publish`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Publish error (${res.status}): ${JSON.stringify(data)}`);
  }

  return { listingId: data.listingId, status: "published" };
}

/**
 * Flux complet : location → inventory → offer → publish.
 */
async function publishToEbay(listing, listingDbId) {
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

  await ensureInventoryLocation(token);
  await createOrReplaceInventoryItem(token, sku, listing);
  const { offerId } = await createOffer(token, sku, listing);
  const { listingId } = await publishOffer(token, offerId);

  return { sku, offerId, listingId, status: "published" };
}

module.exports = { publishToEbay, getAccessToken };
