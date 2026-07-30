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
const EBAY_REFRESH_TOKEN = process.env.EBAY_REFRESH_TOKEN || "";
// Token obtenu via "Sign in to Sandbox for OAuth" (valable ~2h) — mode Sandbox rapide
const EBAY_USER_TOKEN = process.env.EBAY_USER_TOKEN || "";

let cachedToken = null;
let tokenExpiry = 0;

/**
 * Obtient un access token.
 * Priorité :
 *   1. EBAY_USER_TOKEN (copié depuis le portail développeur, ~2h)
 *   2. Refresh Token OAuth (renouvellement automatique, ~18 mois)
 */
async function getAccessToken() {
  // Mode Sandbox rapide : token collé depuis le portail
  if (EBAY_USER_TOKEN) {
    return EBAY_USER_TOKEN;
  }

  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  if (!EBAY_CLIENT_ID || !EBAY_CLIENT_SECRET) {
    throw new Error("EBAY_CLIENT_ID et EBAY_CLIENT_SECRET requis dans .env");
  }

  if (!EBAY_REFRESH_TOKEN) {
    throw new Error(
      "Aucun token eBay. Ajoute EBAY_USER_TOKEN (token du portail) ou EBAY_REFRESH_TOKEN dans .env"
    );
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
      scope: "https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.account",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`eBay OAuth failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

/**
 * Crée ou met à jour un item dans l'inventaire eBay (Inventory API).
 */
async function createOrReplaceInventoryItem(token, sku, listing) {
  const url = `${EBAY_API_BASE}/sell/inventory/v1/inventory_item/${sku}`;

  const body = {
    availability: {
      shipToLocationAvailability: { quantity: 10 },
    },
    condition: "NEW",
    product: {
      title: listing.seo_title.slice(0, 80),
      description: listing.html_description,
      aspects: {},
      imageUrls: ["https://via.placeholder.com/600x600.png?text=EBX+Product"],
    },
  };

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "fr-FR",
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
    marketplaceId: "EBAY_FR",
    format: "FIXED_PRICE",
    listingDescription: listing.html_description,
    availableQuantity: 10,
    pricingSummary: {
      price: {
        value: String(listing.suggested_price || 29.99),
        currency: "EUR",
      },
    },
    categoryId: "7294",
    merchantLocationKey: "default",
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
      "Content-Language": "fr-FR",
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
 * Flux complet : inventory → offer → publish.
 */
async function publishToEbay(listing, listingDbId) {
  const token = await getAccessToken();
  const sku = `EBX-${listingDbId}-${Date.now()}`;

  await createOrReplaceInventoryItem(token, sku, listing);
  const { offerId } = await createOffer(token, sku, listing);
  const { listingId } = await publishOffer(token, offerId);

  return { sku, offerId, listingId, status: "published" };
}

module.exports = { publishToEbay, getAccessToken };
