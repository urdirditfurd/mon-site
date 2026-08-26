/**
 * Etsy Open API v3 — OAuth2 PKCE + création / activation d'annonces.
 *
 * Prérequis : app sur https://www.etsy.com/developers/your-apps
 *   ETSY_API_KEYSTRING + ETSY_SHARED_SECRET dans .env
 *   Redirect URI = https://TON-DOMAINE/api/oauth/etsy/callback
 *
 * Attention politique Etsy : handmade / vintage / craft supplies.
 * Le dropshipping générique Amazon peut faire bannir la boutique.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { cleanEnvToken } = require("./load-env");

const ETSY_API = "https://api.etsy.com/v3";
const ETSY_AUTH = "https://www.etsy.com/oauth/connect";
const ETSY_TOKEN = "https://api.etsy.com/v3/public/oauth/token";

const ETSY_SCOPES = [
  "listings_r",
  "listings_w",
  "shops_r",
  "shops_w",
].join(" ");

function etsyKeystring() {
  return cleanEnvToken(process.env.ETSY_API_KEYSTRING || process.env.ETSY_CLIENT_ID || "");
}

function etsySharedSecret() {
  return cleanEnvToken(process.env.ETSY_SHARED_SECRET || process.env.ETSY_CLIENT_SECRET || "");
}

function etsyRedirectUri() {
  const explicit = cleanEnvToken(process.env.ETSY_REDIRECT_URI || "");
  if (explicit) return explicit;
  const base = cleanEnvToken(process.env.EBX_PUBLIC_URL || "").replace(/\/$/, "");
  if (base) return `${base}/api/oauth/etsy/callback`;
  return "";
}

function etsyApiKeyHeader() {
  const k = etsyKeystring();
  const s = etsySharedSecret();
  if (!k || !s) return "";
  return `${k}:${s}`;
}

function isEtsyConfigured() {
  return Boolean(etsyKeystring() && etsySharedSecret() && etsyRedirectUri());
}

/** PKCE : verifier 43–128 chars URL-safe. */
function createPkcePair() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function buildEtsyConsentUrl({ state, codeChallenge }) {
  const clientId = etsyKeystring();
  const redirectUri = etsyRedirectUri();
  if (!clientId || !redirectUri) {
    throw new Error("ETSY_API_KEYSTRING / ETSY_REDIRECT_URI (ou EBX_PUBLIC_URL) manquants");
  }
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: ETSY_SCOPES,
    state: String(state || ""),
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${ETSY_AUTH}?${params.toString()}`;
}

async function exchangeEtsyAuthCode({ code, codeVerifier }) {
  const clientId = etsyKeystring();
  const redirectUri = etsyRedirectUri();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code: String(code || ""),
    code_verifier: String(codeVerifier || ""),
  });
  const res = await fetch(ETSY_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch (_) {}
  if (!res.ok || !data.access_token) {
    throw new Error(`Etsy token échoué: ${text.slice(0, 280)}`);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || "",
    expiresIn: Number(data.expires_in) || 3600,
    tokenType: data.token_type || "Bearer",
  };
}

async function refreshEtsyAccessToken(refreshToken) {
  const clientId = etsyKeystring();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: String(refreshToken || ""),
  });
  const res = await fetch(ETSY_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch (_) {}
  if (!res.ok || !data.access_token) {
    throw new Error(`Etsy refresh échoué: ${text.slice(0, 280)}`);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresIn: Number(data.expires_in) || 3600,
  };
}

async function etsyRequest(method, urlPath, { accessToken, body, form, multipart } = {}) {
  const apiKey = etsyApiKeyHeader();
  if (!apiKey) throw new Error("Clés Etsy manquantes (ETSY_API_KEYSTRING / ETSY_SHARED_SECRET)");
  if (!accessToken) throw new Error("Access token Etsy manquant — reconnecte la boutique");

  const headers = {
    "x-api-key": apiKey,
    Authorization: `Bearer ${accessToken}`,
  };
  let payload;
  if (multipart) {
    payload = multipart;
  } else if (form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    payload = form instanceof URLSearchParams ? form : new URLSearchParams(form);
  } else if (body != null) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${ETSY_API}${urlPath}`, {
    method,
    headers,
    body: payload,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg =
      data?.error ||
      data?.error_description ||
      data?.message ||
      (typeof data === "object" ? JSON.stringify(data).slice(0, 240) : text.slice(0, 240));
    const err = new Error(`Etsy API ${res.status}: ${msg}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** Prix Etsy form-urlencoded : centimes (ex. 11.87 € → "1187"). */
function etsyPriceCents(amount) {
  const n = Number(amount);
  if (!(n > 0)) throw new Error("Prix Etsy invalide");
  return String(Math.round(n * 100));
}

function htmlToPlainText(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 102000);
}

async function getEtsyUserMe(accessToken) {
  return etsyRequest("GET", "/application/users/me", { accessToken });
}

async function getShopByOwnerUserId(accessToken, userId) {
  return etsyRequest("GET", `/application/users/${encodeURIComponent(userId)}/shops`, { accessToken });
}

async function listShippingProfiles(accessToken, shopId) {
  const data = await etsyRequest(
    "GET",
    `/application/shops/${encodeURIComponent(shopId)}/shipping-profiles`,
    { accessToken }
  );
  return data?.results || data?.shipping_profiles || [];
}

async function listReadinessStates(accessToken, shopId) {
  try {
    const data = await etsyRequest(
      "GET",
      `/application/shops/${encodeURIComponent(shopId)}/readiness-state-definitions`,
      { accessToken }
    );
    return data?.results || [];
  } catch (_) {
    return [];
  }
}

/**
 * Choisit un taxonomy_id feuille raisonnable.
 * Priorité : ETSY_TAXONOMY_ID env, sinon premier nœud feuille trouvé.
 */
async function resolveTaxonomyId(accessToken, hint = "") {
  const forced = Number(process.env.ETSY_TAXONOMY_ID || 0);
  if (forced > 0) return forced;

  const data = await etsyRequest("GET", "/application/seller-taxonomy/nodes", { accessToken });
  const nodes = data?.results || [];
  const want = String(hint || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  function walk(list, depth = 0) {
    let best = null;
    for (const n of list || []) {
      const name = String(n.name || "").toLowerCase();
      const kids = n.children || n.children_ids ? n.children : null;
      if (Array.isArray(n.children) && n.children.length) {
        const hit = walk(n.children, depth + 1);
        if (hit) return hit;
      } else if (n.id && (!n.children || !n.children.length)) {
        if (want && name.includes(want.slice(0, 12))) return Number(n.id);
        if (!best) best = Number(n.id);
      }
    }
    return best;
  }

  // API renvoie souvent un arbre plat avec children imbriqués
  const found = walk(nodes);
  if (found) return found;
  // Fallback connu : "Electronics & Accessories" varie — prendre le premier id
  const flat = [];
  const stack = [...nodes];
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    if (Array.isArray(n.children)) stack.push(...n.children);
    if (n.id) flat.push(Number(n.id));
  }
  if (!flat.length) throw new Error("Impossible de résoudre taxonomy_id Etsy — fixe ETSY_TAXONOMY_ID");
  return flat[flat.length - 1];
}

function extractLocalMediaPaths(html) {
  const { extractAllImageSrcs, resolveLocalMediaPath } = require("./image-cache");
  const srcs = extractAllImageSrcs(html || "");
  const files = [];
  for (const src of srcs.slice(0, 8)) {
    if (!/^\/media\//i.test(src)) continue;
    const local = resolveLocalMediaPath(src);
    if (local && fs.existsSync(local)) files.push(local);
  }
  return files;
}

async function uploadListingImage(accessToken, shopId, listingId, filePath) {
  const buf = fs.readFileSync(filePath);
  const filename = path.basename(filePath);
  const form = new FormData();
  form.append("image", new Blob([buf]), filename);
  return etsyRequest(
    "POST",
    `/application/shops/${encodeURIComponent(shopId)}/listings/${encodeURIComponent(listingId)}/images`,
    { accessToken, multipart: form }
  );
}

/**
 * Publie un listing EBX sur Etsy.
 * @param {object} listing — row listings
 * @param {object} account — etsy_accounts row { shop_id, access_token, refresh_token, … }
 * @param {{ activate?: boolean, quantity?: number, onTokenRefresh?: fn }} options
 */
async function publishToEtsy(listing, account, options = {}) {
  if (!account?.shop_id) throw new Error("Compte Etsy sans shop_id — reconnecte la boutique");
  let accessToken = account.access_token;
  if (!accessToken && account.refresh_token) {
    const refreshed = await refreshEtsyAccessToken(account.refresh_token);
    accessToken = refreshed.accessToken;
    if (typeof options.onTokenRefresh === "function") {
      options.onTokenRefresh(refreshed);
    }
  }
  if (!accessToken) throw new Error("Token Etsy manquant");

  const shopId = account.shop_id;
  const title = String(listing.seo_title || "Produit").slice(0, 140);
  const description = htmlToPlainText(listing.html_description) || title;
  const price = etsyPriceCents(listing.suggested_price);
  const quantity = Math.max(1, Number(options.quantity) || 1);
  const activate = options.activate === true || process.env.ETSY_AUTO_ACTIVATE === "1";

  const profiles = await listShippingProfiles(accessToken, shopId);
  if (!profiles.length) {
    throw new Error(
      "Aucun profil d'expédition Etsy. Crée-en un dans Shop Manager → Paramètres → Expédition, puis réessaie."
    );
  }
  const shippingProfileId =
    Number(process.env.ETSY_SHIPPING_PROFILE_ID) ||
    Number(profiles[0].shipping_profile_id || profiles[0].id);

  const readiness = await listReadinessStates(accessToken, shopId);
  const readinessStateId =
    Number(process.env.ETSY_READINESS_STATE_ID) ||
    Number(readiness[0]?.readiness_state_id || readiness[0]?.id || 0);

  const taxonomyId = await resolveTaxonomyId(accessToken, title);

  const form = {
    quantity: String(quantity),
    title,
    description,
    price,
    who_made: process.env.ETSY_WHO_MADE || "someone_else",
    when_made: process.env.ETSY_WHEN_MADE || "made_to_order",
    taxonomy_id: String(taxonomyId),
    is_supply: process.env.ETSY_IS_SUPPLY === "1" ? "true" : "false",
    type: "physical",
    shipping_profile_id: String(shippingProfileId),
  };
  if (readinessStateId > 0) form.readiness_state_id = String(readinessStateId);

  let draft;
  try {
    draft = await etsyRequest("POST", `/application/shops/${encodeURIComponent(shopId)}/listings`, {
      accessToken,
      form,
    });
  } catch (err) {
    // Token expiré → un refresh puis retry
    if (err.status === 401 && account.refresh_token) {
      const refreshed = await refreshEtsyAccessToken(account.refresh_token);
      accessToken = refreshed.accessToken;
      if (typeof options.onTokenRefresh === "function") options.onTokenRefresh(refreshed);
      draft = await etsyRequest("POST", `/application/shops/${encodeURIComponent(shopId)}/listings`, {
        accessToken,
        form,
      });
    } else {
      throw err;
    }
  }

  const listingId = draft?.listing_id || draft?.listingId;
  if (!listingId) throw new Error("Etsy n'a pas renvoyé de listing_id");

  const images = extractLocalMediaPaths(listing.html_description);
  let imageCount = 0;
  for (const file of images) {
    try {
      await uploadListingImage(accessToken, shopId, listingId, file);
      imageCount += 1;
    } catch (imgErr) {
      console.warn(`[Etsy] upload image ${path.basename(file)}:`, imgErr.message);
    }
  }
  if (!imageCount) {
    console.warn(`[Etsy] Listing #${listingId} sans image /media/ — reste en brouillon`);
  }

  let state = draft.state || "draft";
  if (activate && imageCount > 0) {
    const updated = await etsyRequest(
      "PATCH",
      `/application/shops/${encodeURIComponent(shopId)}/listings/${encodeURIComponent(listingId)}`,
      { accessToken, form: { state: "active" } }
    );
    state = updated?.state || "active";
  }

  return {
    listingId: String(listingId),
    shopId: String(shopId),
    state,
    imageCount,
    shippingProfileId: String(shippingProfileId),
    taxonomyId,
    url: `https://www.etsy.com/listing/${listingId}`,
    env: "production",
  };
}

module.exports = {
  ETSY_SCOPES,
  ETSY_AUTH,
  ETSY_TOKEN,
  isEtsyConfigured,
  etsyKeystring,
  etsyRedirectUri,
  createPkcePair,
  buildEtsyConsentUrl,
  exchangeEtsyAuthCode,
  refreshEtsyAccessToken,
  getEtsyUserMe,
  getShopByOwnerUserId,
  listShippingProfiles,
  publishToEtsy,
  etsyPriceCents,
  htmlToPlainText,
  resolveTaxonomyId,
};
