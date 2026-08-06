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
  // En production : uniquement le refresh Prod (jamais le token Sandbox).
  if (isProduction()) {
    return cleanEnvToken(process.env.EBAY_REFRESH_TOKEN_PROD);
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
  // En production, ignorer EBAY_API_BASE sandbox du .env
  if (isProduction()) {
    const configured = env("EBAY_API_BASE");
    if (configured && !/sandbox/i.test(configured)) return configured;
    return "https://api.ebay.com";
  }
  return env("EBAY_API_BASE", "https://api.sandbox.ebay.com");
}

function ebayAuthUrl() {
  // En production, ignorer EBAY_AUTH_URL sandbox du .env (sinon invalid_client)
  if (isProduction()) {
    const configured = env("EBAY_AUTH_URL");
    if (configured && !/sandbox/i.test(configured)) return configured;
    return "https://api.ebay.com/identity/v1/oauth2/token";
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

function clearTokenCache() {
  cachedToken = null;
  tokenExpiry = 0;
}

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
      throw new Error(
        isProduction()
          ? "EBAY_PROD_CLIENT_ID et EBAY_PROD_CLIENT_SECRET requis (mode production)"
          : "EBAY_CLIENT_ID et EBAY_CLIENT_SECRET requis pour utiliser EBAY_REFRESH_TOKEN"
      );
    }

    console.log(
      `[EBX] OAuth refresh → ${ebayAuthUrl()} (client ${clientId.slice(0, 16)}…, refresh ${refresh.length} car.)`
    );

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
      throw new Error(
        `eBay OAuth refresh failed (${res.status}): ${err}` +
          (isProduction()
            ? "\n→ Vérifie EBAY_REFRESH_TOKEN_PROD + EBAY_PROD_CLIENT_ID/SECRET (guillemets droits)."
            : "")
      );
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sanitizeEbayTitle(title) {
  let t = String(title || "EBX Product")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    // Coupe les parenthèses / crochets non fermés (titre tronqué à 80)
    .replace(/\([^)]*$/g, " ")
    .replace(/\[[^\]]*$/g, " ")
    .replace(/\s*\(\s*type\s*$/i, " ")
    .replace(/\b(garantie|garanti|authentique|authenticité|réplique|replica|contrefa[cç]on|fake)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*[-–—|,;:]+\s*$/g, "")
    .trim();
  if (t.length > 80) t = t.slice(0, 80).replace(/\s+\S*$/, "").trim();
  return t || "Produit Qualité Premium Neuf";
}

/**
 * Nettoie titre + HTML avant publish (évite filtres eBay 25019 / mots interdits).
 */
function sanitizeListingForEbayPublish(listing) {
  const src = listing || {};
  let title = sanitizeEbayTitle(src.seo_title || src.title || "Produit");
  let html = String(src.html_description || "");

  const riskyHtml = [
    [/>\s*Garanti\s*</gi, ">Qualité<"],
    [/>\s*Garantie\s*</gi, ">Qualité<"],
    [/Satisfaction garantie/gi, "Satisfaction client"],
    [/Authenticité/gi, "Sélection"],
    [/Authentique/gi, "Sélectionné"],
    [/100\s*%\s*garanti[e]?/gi, "Contrôle qualité"],
    [/(?:meilleur|lowest)\s+prix/gi, "Bon rapport qualité-prix"],
    [/r[eé]plique/gi, "alternative"],
    [/contrefa[cç]on/gi, ""],
    [/\bfake\b/gi, ""],
    [/\bdrop\s*ship(?:ping)?\b/gi, ""],
    [/\bwholesale\b/gi, ""],
  ];
  for (const [re, rep] of riskyHtml) html = html.replace(re, rep);

  // Retire mentions marketplace / fournisseur restantes
  html = html
    .replace(/\b(?:aliexpress|amazon(?:\.[a-z]+)?|cdiscount|temu|wish)\b/gi, " ")
    .replace(/\s{2,}/g, " ");

  return {
    ...src,
    seo_title: title,
    html_description: html,
  };
}

/**
 * eBay refuse les annonces « identiques » (policy duplicate listing).
 * Extrait l'ID existant + message FR actionnable.
 */
function parseDuplicateListingError(errOrText) {
  const text = typeof errOrText === "string" ? errOrText : String(errOrText?.message || errOrText || "");
  if (!/objets? identiques|identical|already.*listed|déjà mis en vente|listing-multi/i.test(text)) {
    return null;
  }
  let existingId = null;
  let existingTitle = null;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}$/);
    const payload = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    const err = payload?.errors?.[0];
    const params = Object.fromEntries((err?.parameters || []).map((p) => [String(p.name), p.value]));
    existingTitle = params["0"] || null;
    existingId = params["1"] || null;
  } catch (_) {}
  if (!existingId) {
    const m = text.match(/\((\d{9,16})\)/);
    if (m) existingId = m[1];
  }
  const isFr = (process.env.EBAY_MARKETPLACE_ID || "").toUpperCase() === "EBAY_FR";
  const host = isFr ? "https://www.ebay.fr" : "https://www.ebay.com";
  const link = existingId ? `${host}/itm/${existingId}` : null;
  return {
    code: "DUPLICATE_LISTING",
    existingListingId: existingId,
    existingTitle,
    link,
    message:
      `eBay refuse un doublon : cette annonce ressemble déjà à une vente active` +
      (existingTitle ? ` « ${existingTitle} »` : "") +
      (existingId ? ` (#${existingId})` : "") +
      `.\n\nQue faire :\n` +
      `1) Ouvre l’annonce existante et augmente la quantité\n` +
      `2) Ou termine l’ancienne annonce sur eBay puis republie\n` +
      `3) Ou change le titre / les photos ici (Modifier) pour une annonce vraiment différente` +
      (link ? `\n\nLien : ${link}` : ""),
  };
}

/**
 * Extrait la vraie raison d’un 25019 depuis errors[].parameters
 * (ex. substances dangereuses, VeRO, etc.).
 */
function decodeEbayHtmlEntities(text) {
  return String(text || "")
    .replace(/&eacute;/gi, "é")
    .replace(/&egrave;/gi, "è")
    .replace(/&agrave;/gi, "à")
    .replace(/&ocirc;/gi, "ô")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractEbayPolicyBlockReason(errOrText) {
  const raw = typeof errOrText === "string" ? errOrText : String(errOrText?.message || errOrText || "");
  let payload = null;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}$/);
    if (jsonMatch) payload = JSON.parse(jsonMatch[0]);
  } catch (_) {}
  const err = payload?.errors?.[0] || {};
  const params = Object.fromEntries((err.parameters || []).map((p) => [String(p.name), String(p.value || "")]));
  const joined = Object.values(params).join(" \n ");
  const code = params["2"] || "";
  const policyUrl =
    params["4"] ||
    (joined.match(/https?:\/\/[^\s"']+hazardous[^\s"']*/i) || [])[0] ||
    null;

  if (/PI_HAZ|hazardous|substances?\s+dangereuses|mat[eé]riaux?\s+dangereux/i.test(joined + code + raw)) {
    const plain =
      decodeEbayHtmlEntities(params["0"] || params["1"] || "") ||
      "Cet objet est interdit par le règlement eBay sur les substances dangereuses.";
    return {
      code: "HAZARDOUS_MATERIALS",
      policyCode: code || "PI_HAZ",
      policyUrl: policyUrl || "https://www.ebay.fr/pages/help/policies/hazardous-materials.html",
      message:
        `⛔ PRODUIT INTERDIT — Substances dangereuses (eBay FR)\n\n` +
        `${plain}\n\n` +
        `Ce n’est PAS un problème de limites ni de policies.\n` +
        `eBay refuse cette catégorie de produit (souvent : slime / butter squishy / putty / gels / certains jouets souples).\n\n` +
        `Que faire :\n` +
        `1) Ne republie PAS ce listing — change de produit\n` +
        `2) Évite slime, butter stick, putty, gel sticky, pâte à modeler chimique\n` +
        `3) Lis : ${policyUrl || "https://www.ebay.fr/pages/help/policies/hazardous-materials.html"}`,
    };
  }

  if (/PI_VERO|VeRO|propri[eé]t[eé] intellectuelle|counterfeit/i.test(joined + code + raw)) {
    return {
      code: "VERO",
      policyCode: code || "PI_VERO",
      policyUrl: null,
      message:
        `⛔ PRODUIT BLOQUÉ — VeRO / propriété intellectuelle\n\n` +
        `${decodeEbayHtmlEntities(params["0"] || params["1"] || "Marque protégée.")}\n` +
        `Change de produit (pas de marque Apple/Nike/etc. sans autorisation).`,
    };
  }

  // Message clair générique depuis le param 0/1 si présent
  if (params["0"] || params["1"]) {
    const plain = decodeEbayHtmlEntities(params["0"] || params["1"]);
    if (plain && plain.length > 20) {
      return {
        code: "POLICY_BLOCK",
        policyCode: code || null,
        policyUrl,
        message: `⛔ eBay refuse cette annonce (règlement)\n\n${plain}`,
      };
    }
  }
  return null;
}

/**
 * Transforme une erreur eBay brute (souvent message="Error" + longMessage utile)
 * en texte FR actionnable pour l’UI.
 */
function formatEbayPublishError(errOrText) {
  const raw = typeof errOrText === "string" ? errOrText : String(errOrText?.message || errOrText || "");
  if (!raw.trim()) return "Erreur eBay inconnue — regarde la console serveur ([EBX] Erreur eBay).";

  const policy = extractEbayPolicyBlockReason(raw);
  if (policy) return policy.message;

  const dup = parseDuplicateListingError(raw);
  if (dup) return dup.message;

  let payload = null;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}$/);
    if (jsonMatch) payload = JSON.parse(jsonMatch[0]);
  } catch (_) {}

  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  const first = errors[0] || {};
  const errorId = first.errorId != null ? Number(first.errorId) : null;
  const longMessage = String(first.longMessage || first.message || "").trim();
  const shortMessage = String(first.message || "").trim();
  const detail =
    longMessage && !/^error$/i.test(longMessage)
      ? longMessage
      : shortMessage && !/^error$/i.test(shortMessage)
        ? shortMessage
        : "";

  const tips = {
    1001: "Token OAuth invalide ou expiré → npm run oauth:prod (ou oauth) puis redémarre le serveur.",
    1100: "Accès refusé eBay (scope manquant) → reconnecte OAuth avec les scopes Sell Inventory.",
    25002: "Aspect produit refusé (Marque/Couleur/Type…) → ouvre Modifier, simplifie le titre, republie.",
    25005: "Catégorie invalide (non-feuille) → laisse Taxonomy choisir, ou change EBAY_CATEGORY_ID.",
    25007: "Politique business invalide → npm run policies:prod et mets à jour les IDs dans .env.",
    25008: "Politique manquante → npm run policies:prod.",
    25009: "Emplacement inventaire manquant → le serveur devrait le créer auto (merchant location).",
    25019:
      "eBay bloque la mise en vente (règlement, limites, ou politiques).\n\n" +
      "Vérifie : substances dangereuses, VeRO, limites Seller Hub, policies FR 30j.",
    25601: "SKU / offer déjà utilisé → republie (nouveau SKU) ou termine l’ancienne offre.",
    25604: "Offer introuvable — republie depuis Mes Listings.",
    25709: "Locale / Content-Language incorrect — vérifie EBAY_MARKETPLACE_ID (ex. EBAY_FR).",
    25710: "Marketplace mismatch — aligne EBAY_MARKETPLACE_ID avec ton compte vendeur.",
    25713: "Image galerie refusée — change l’ordre des photos ou réimporte le produit.",
    25718: "Description Inventory trop longue — déjà tronquée côté EBX, réessaie.",
  };

  const tip = errorId && tips[errorId] ? tips[errorId] : null;
  const idPart = errorId != null ? `eBay #${errorId}` : "eBay";

  // 25019 : garder le diagnostic live s'il est déjà enrichi (et sans policy déjà extraite)
  if (errorId === 25019 || /25019|Cannot revise listing|ne peut pas être mis en vente/i.test(raw)) {
    if (/⛔ PRODUIT|Diagnostic EBX|Publish bloqué \(préflight\)/i.test(raw)) return raw;
    return `eBay #25019 — ${detail || "Mise en vente refusée"}\n\n→ ${tips[25019]}`;
  }

  if (/Publish bloqué \(préflight\)|⛔ PRODUIT/i.test(raw)) return raw;

  if (detail) {
    return tip ? `${idPart} — ${detail}\n\n→ ${tip}` : `${idPart} — ${detail}`;
  }

  // Messages locaux déjà clairs
  if (/policies manquantes|aucune image|héberger les images|VeRO|Gallery|EPS|OAuth|refresh|dangereux|hazardous/i.test(raw)) {
    return raw;
  }

  // Évite d’afficher seulement « Error »
  if (/^error$/i.test(raw.trim()) || /\bmessage"\s*:\s*"Error"/i.test(raw)) {
    return tip
      ? `${idPart} — erreur sans détail.\n\n→ ${tip}`
      : `${idPart} — erreur sans détail. Ouvre la console serveur (ligne [EBX] Erreur eBay) et copie le JSON.`;
  }

  // JSON trop long : garde un extrait lisible
  if (raw.length > 900) {
    return `${idPart} — ${raw.slice(0, 700)}…`;
  }
  return raw;
}

/** Titre légèrement différent pour un 2e essai après refus doublon. */
function differentiateEbayTitle(title) {
  let t = sanitizeEbayTitle(title);
  const stamps = ["Pack", "Kit", "Lot", "Pro", "Plus"];
  const stamp = stamps[Math.floor(Math.random() * stamps.length)];
  // Retire un suffixe déjà ajouté
  t = t.replace(/\s+(Pack|Kit|Lot|Pro|Plus)\s*$/i, "").trim();
  // Évite de coller trop près d'un « Neuf » terminal
  if (/\bneuf\b$/i.test(t)) {
    t = t.replace(/\bneuf\b$/i, `${stamp} Neuf`).trim();
  } else {
    const room = 80 - t.length - 1 - stamp.length;
    if (room >= 0) t = `${t} ${stamp}`;
    else t = sanitizeEbayTitle(`${t.slice(0, Math.max(20, 80 - stamp.length - 1))} ${stamp}`);
  }
  return sanitizeEbayTitle(t);
}

/** Aspects Inventory : uniquement { "Name": ["value"] } non vides. */
function sanitizeAspects(aspects) {
  const out = {};
  for (const [rawKey, rawVal] of Object.entries(aspects || {})) {
    const key = String(rawKey || "").trim();
    if (!key) continue;
    const values = (Array.isArray(rawVal) ? rawVal : [rawVal])
      .map((v) => String(v == null ? "" : v).trim())
      .filter((v) => v && v.toLowerCase() !== "undefined" && v.toLowerCase() !== "null")
      .slice(0, 10);
    if (values.length) out[key] = values;
  }
  const isFr = (process.env.EBAY_MARKETPLACE_ID || "").toUpperCase() === "EBAY_FR";
  const defaultBrand = isFr ? "Sans marque" : "Unbranded";
  if (!out.Brand) out.Brand = [defaultBrand];
  // eBay FR exige souvent la clé localisée "Marque" (erreur 25002 si absente)
  if (!out.Marque) out.Marque = out.Brand;
  return out;
}

function isInventoryTransientError(status, text) {
  if (status === 500 || status === 503 || status === 504) return true;
  if (/25001|25025|internal error|try again/i.test(String(text || ""))) return true;
  return false;
}

async function ensureInventoryLocation(token) {
  const market = process.env.EBAY_MARKETPLACE_ID || "EBAY_US";
  const isFr = market === "EBAY_FR";
  // Évite la clé "default" ; FR ≠ US (sinon shipping policy FR vs entrepôt US = erreurs)
  const key =
    env("EBAY_MERCHANT_LOCATION_KEY") || (isFr ? "ebx_fr_wh" : "ebx_us_wh");
  const getUrl = `${ebayApiBase()}/sell/inventory/v1/location/${encodeURIComponent(key)}`;

  const existing = await ebayHttpsRequest("GET", getUrl, { token });
  if (existing.status === 200) {
    console.log(`[EBX] Inventory location OK: ${key}`);
    return key;
  }

  const createUrl = `${ebayApiBase()}/sell/inventory/v1/location/${encodeURIComponent(key)}`;
  const body = isFr
    ? {
        name: "EBX Entrepot FR",
        merchantLocationStatus: "ENABLED",
        location: {
          address: {
            addressLine1: "10 Rue de Rivoli",
            city: "Paris",
            stateOrProvince: "IDF",
            postalCode: "75001",
            country: "FR",
          },
        },
        locationTypes: ["WAREHOUSE"],
      }
    : {
        name: "EBX Warehouse US",
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

  // Location API : pas de Content-Language (évite des 500 parasites)
  const res = await ebayHttpsRequest("POST", createUrl, {
    token,
    body,
    contentLanguage: false,
  });

  if (res.status !== 204 && res.status !== 200 && res.status !== 201 && res.status !== 409) {
    throw new Error(`Inventory location error (${res.status}): ${res.text}`);
  }

  console.log(`[EBX] Inventory location créée: ${key} (HTTP ${res.status})`);
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

function refererForImageUrl(imageUrl) {
  const u = String(imageUrl || "").toLowerCase();
  if (/alicdn\.com|aliexpress\.|ae01\.alicdn/i.test(u)) return "https://www.aliexpress.com/";
  if (/cdiscount\.|cdscdn\.|octopia/i.test(u)) return "https://www.cdiscount.com/";
  if (/media-amazon\.|ssl-images-amazon\.|amazon\./i.test(u)) return "https://www.amazon.fr/";
  if (/ebayimg\.|ebaystatic\./i.test(u)) return "https://www.ebay.fr/";
  try {
    const host = new URL(imageUrl).origin;
    return host + "/";
  } catch {
    return "https://www.google.com/";
  }
}

async function downloadImageBuffer(imageUrl) {
  const referer = refererForImageUrl(imageUrl);
  const res = await fetch(imageUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      Referer: referer,
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
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

async function createOrReplaceInventoryItem(token, sku, listing, aspects = {}, options = {}) {
  const url = `${ebayApiBase()}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`;
  const title = sanitizeEbayTitle(listing.seo_title);
  let imageUrls = options.imageUrls || [];
  if (!imageUrls.length) {
    const sourceImages = extractImageUrls(listing.html_description).slice(0, 8);
    if (!sourceImages.length) {
      throw new Error(
        "Aucune image produit dans le listing HTML. Réimporte le produit avec de vraies images avant de publier."
      );
    }
    console.log(`[EBX] Hébergement galerie EPS (${sourceImages.length} image(s))…`);
    imageUrls = await hostImagesForGallery(token, sourceImages);
    if (!imageUrls.length) {
      throw new Error(
        "Impossible d'héberger les images sur eBay (Gallery / EPS). " +
          "Cause fréquente : images AliExpress/Amazon bloquées. " +
          "Réimporte le produit, vérifie que les photos s'affichent dans Modifier, puis republie."
      );
    }
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
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const shortDesc = (plain || title).slice(0, 4000);
  const mergedAspects = sanitizeAspects({
    Brand: ["Unbranded"],
    Marque: ["Sans marque"],
    EAN: ["Does not apply"],
    MPN: ["Does not apply"],
    ...aspects,
  });
  // Aligne Brand ↔ Marque pour EBAY_FR
  if (mergedAspects.Brand && !mergedAspects.Marque) mergedAspects.Marque = mergedAspects.Brand;
  if (mergedAspects.Marque && !mergedAspects.Brand) mergedAspects.Brand = mergedAspects.Marque;
  const ean = options.ean || ["Does not apply"];
  const qty = Math.max(1, Number(options.quantity) || 1);

  const attempts = [
    {
      label: "full",
      body: {
        availability: { shipToLocationAvailability: { quantity: qty } },
        condition: "NEW",
        product: {
          title: options.variantLabel ? `${title} — ${options.variantLabel}`.slice(0, 80) : title,
          description: shortDesc,
          aspects: mergedAspects,
          imageUrls,
          ean,
          upc: ["Does not apply"],
        },
      },
    },
    {
      label: "minimal",
      body: {
        availability: { shipToLocationAvailability: { quantity: qty } },
        condition: "NEW",
        product: {
          title,
          aspects: {
            Brand: mergedAspects.Brand || ["Unbranded"],
            Marque: mergedAspects.Marque || mergedAspects.Brand || ["Sans marque"],
            EAN: ["Does not apply"],
          },
          imageUrls: imageUrls.slice(0, 1),
          ean: ["Does not apply"],
        },
      },
    },
    {
      label: "bare",
      body: {
        availability: { shipToLocationAvailability: { quantity: qty } },
        condition: "NEW",
        product: {
          title,
          aspects: {
            Brand: ["Unbranded"],
            Marque: ["Sans marque"],
          },
          imageUrls: imageUrls.slice(0, 1),
        },
      },
    },
  ];

  let lastErr = "";
  for (let i = 0; i < attempts.length; i++) {
    let { label, body } = attempts[i];
    // Si le précédent refus cite un aspect invalide, on le retire pour la suite
    if (i > 0 && lastErr) {
      const badAspect = (lastErr.match(/aspect[^"']*['"]([^"']+)['"]/i) ||
        lastErr.match(/['"]([A-Za-zÀ-ÿ ]+)['"]\s+(?:is not|n'est pas|non autoris)/i) ||
        [])[1];
      if (badAspect && body?.product?.aspects?.[badAspect]) {
        const cleaned = { ...body, product: { ...body.product, aspects: { ...body.product.aspects } } };
        delete cleaned.product.aspects[badAspect];
        body = cleaned;
        label = `${label}-sans-${badAspect}`;
      }
    }
    if (i > 0) {
      const wait = 1200 * i;
      console.warn(`[EBX] Inventory retry ${i + 1}/${attempts.length} (${label}) dans ${wait}ms…`);
      await sleep(wait);
    } else {
      console.log(`[EBX] Inventory PUT sku=${sku} images=${imageUrls.length} aspects=${Object.keys(mergedAspects).length}`);
    }

    const res = await ebayHttpsRequest("PUT", url, {
      token,
      body,
      contentLanguage: true,
    });

    if (res.status === 204 || res.status === 200) {
      console.log(`[EBX] Inventory item OK (${label})`);
      return { sku, status: "inventory_created", imageUrls };
    }

    lastErr = `Inventory API error (${res.status}) [locale=${res.locale}]: ${res.text}`;
    console.warn(`[EBX] Inventory ${label} fail: ${res.text.slice(0, 240)}`);
  }

  throw new Error(
    lastErr +
      "\n→ Erreur Inventory eBay. Réessaie dans 1–2 min. Vérifie Marque/EAN/catégorie."
  );
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
 * Aspects requis + aspects autorisés en variations pour une catégorie.
 */
async function fetchCategoryAspectMeta(token, categoryId) {
  const marketplaceId = env("EBAY_MARKETPLACE_ID", "EBAY_US");
  const treeId = categoryTreeIdForMarketplace(marketplaceId);
  const url =
    `${ebayApiBase()}/commerce/taxonomy/v1/category_tree/${treeId}` +
    `/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`;

  try {
    const res = await ebayHttpsRequest("GET", url, { token });
    if (!res.ok) {
      console.warn(`[EBX] Aspects catégorie HTTP ${res.status}`);
      return { required: [], variationAspects: [] };
    }
    const data = res.json();
    const aspects = data?.aspects || [];
    const mapAsp = (a) => ({
      name: a.localizedAspectName || a.aspectName,
      values: (a.aspectValues || []).map((v) => v.localizedValue || v.value).filter(Boolean),
    });
    const required = aspects
      .filter((a) => a?.aspectConstraint?.aspectRequired)
      .map(mapAsp)
      .filter((a) => a.name);
    const variationAspects = aspects
      .filter((a) => a?.aspectConstraint?.aspectEnabledForVariations)
      .map(mapAsp)
      .filter((a) => a.name);
    return { required, variationAspects };
  } catch (err) {
    console.warn("[EBX] fetchCategoryAspectMeta:", err.message);
    return { required: [], variationAspects: [] };
  }
}

async function fetchRequiredAspectNames(token, categoryId) {
  const meta = await fetchCategoryAspectMeta(token, categoryId);
  return meta.required;
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
    return pickAllowed("Unbranded", "Generic", "Does not apply", "Sans marque");
  }
  if (/^ean$|gtin|upc|isbn|epid/.test(name)) {
    return pickAllowed("Does not apply", "Ne s'applique pas", "Non applicable");
  }
  if (/^mpn$|manufacturer part|num[eé]ro de pi[eè]ce/.test(name)) {
    return pickAllowed("Does not apply", "Ne s'applique pas");
  }
  if (/type de produit|product type|type$/.test(name) && /led|bande|strip/i.test(t)) {
    return pickAllowed("LED Strip", "Light Strip", "Éclairage", allowedValues?.[0]);
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
  const isFr = env("EBAY_MARKETPLACE_ID", "EBAY_US") === "EBAY_FR";

  // Toujours renseigner Marque + identifiants (eBay les demande souvent)
  const brandVal = isFr ? "Sans marque" : "Unbranded";
  aspects.Brand = [brandVal];
  aspects.Marque = [brandVal];
  aspects.EAN = ["Does not apply"];
  aspects.MPN = ["Does not apply"];

  for (const asp of required) {
    const key = asp.name;
    if (/^brand$|^marque$/i.test(key)) {
      aspects[key] = [guessAspectValue(key, title, asp.values?.length ? asp.values : [brandVal])];
      // Garde les deux clés synchronisées
      aspects.Brand = aspects[key];
      aspects.Marque = aspects[key];
      continue;
    }
    if (/ean|gtin|upc|isbn/i.test(key)) {
      aspects[key] = ["Does not apply"];
      continue;
    }
    if (/^mpn$/i.test(key)) {
      aspects[key] = ["Does not apply"];
      continue;
    }
    aspects[key] = [guessAspectValue(asp.name, title, asp.values)];
  }

  if (/ipad|tablet|tab\b/i.test(title) && !aspects["Internet Connectivity"]) {
    aspects["Internet Connectivity"] = [/cellular|5g|4g/i.test(title) ? "Wi-Fi + Cellular" : "Wi-Fi"];
  }

  console.log(`[EBX] Aspects: ${Object.keys(aspects).join(", ")}`);
  return aspects;
}

function defaultVariantValues(title = "") {
  const t = String(title || "").toLowerCase();
  if (/led|bande|strip|n[eé]on|lumineuse|blanc chaud|froid|kelvin|cct/i.test(t)) {
    return ["Blanc chaud", "Blanc froid"];
  }
  if (/coque|case|housse|silicone/i.test(t)) return ["Noir", "Transparent"];
  if (/cable|câble|usb|hdmi/i.test(t)) return ["1 m", "2 m"];
  return ["Option A", "Option B"];
}

/**
 * Résout les variations pour la catégorie eBay.
 * Si « Couleur » n'est pas autorisé (erreur 25002), choisit un aspect valide
 * ou désactive les variations → publish simple.
 */
async function resolveVariationsForCategory(token, categoryId, title, input = {}) {
  // Opt-in strict : sans enabled=true → publish simple (évite 25002 Couleur)
  if (input?.enabled !== true) {
    return { enabled: false, aspect: null, values: [] };
  }

  const isFr = env("EBAY_MARKETPLACE_ID", "EBAY_US") === "EBAY_FR";
  const meta = await fetchCategoryAspectMeta(token, categoryId);
  const allowed = meta.variationAspects || [];
  const wanted = String(input?.aspect || (isFr ? "Couleur" : "Color")).trim();

  let chosen =
    allowed.find((a) => a.name.toLowerCase() === wanted.toLowerCase()) ||
    allowed.find((a) => /^(couleur|color|colour)$/i.test(a.name)) ||
    allowed.find((a) => /couleur|color|colour|teinte|shade|size|taille|longueur/i.test(a.name)) ||
    allowed[0] ||
    null;

  if (!chosen) {
    console.warn(
      `[EBX] Catégorie ${categoryId}: aucun aspect variation autorisé — publish simple (évite 25002 Couleur)`
    );
    return { enabled: false, aspect: null, values: [] };
  }

  if (wanted && chosen.name.toLowerCase() !== wanted.toLowerCase()) {
    console.warn(
      `[EBX] Aspect « ${wanted} » non autorisé en variation — utilisation de « ${chosen.name} »`
    );
  }

  let values = (input?.values || []).map((v) => String(v).trim()).filter(Boolean);
  if (chosen.values?.length >= 2) {
    // Prefer taxonomy values that match requested labels, else first two allowed
    const matched = values
      .map((v) => chosen.values.find((av) => String(av).toLowerCase() === v.toLowerCase()) || null)
      .filter(Boolean);
    if (matched.length >= 2) values = matched.slice(0, 6);
    else values = chosen.values.slice(0, 2);
  } else if (values.length < 2) {
    values = defaultVariantValues(title);
  }

  const uniq = [...new Set(values)].slice(0, 6);
  while (uniq.length < 2) uniq.push(`Variante ${uniq.length + 1}`);

  return { enabled: true, aspect: chosen.name, values: uniq };
}

function normalizeVariations(input, title) {
  // Legacy helper — prefer resolveVariationsForCategory at publish time
  if (input?.enabled === false) return { aspect: null, values: [], enabled: false };
  const isFr = env("EBAY_MARKETPLACE_ID", "EBAY_US") === "EBAY_FR";
  const aspect = String(input?.aspect || (isFr ? "Couleur" : "Color")).trim() || (isFr ? "Couleur" : "Color");
  let values = (input?.values || []).map((v) => String(v).trim()).filter(Boolean);
  if (values.length < 2) values = defaultVariantValues(title);
  const uniq = [...new Set(values)].slice(0, 6);
  while (uniq.length < 2) uniq.push(`Variante ${uniq.length + 1}`);
  return { aspect, values: uniq, enabled: input?.enabled !== false };
}

async function createOrReplaceInventoryItemGroup(token, groupKey, payload) {
  const url = `${ebayApiBase()}/sell/inventory/v1/inventory_item_group/${encodeURIComponent(groupKey)}`;
  const res = await ebayHttpsRequest("PUT", url, { token, body: payload, contentLanguage: true });
  if (res.status !== 204 && res.status !== 200 && res.status !== 201) {
    throw new Error(`Inventory item group error (${res.status}): ${res.text.slice(0, 400)}`);
  }
  return groupKey;
}

async function publishByInventoryItemGroup(token, groupKey) {
  const url = `${ebayApiBase()}/sell/inventory/v1/offer/publish_by_inventory_item_group`;
  const body = {
    inventoryItemGroupKey: groupKey,
    marketplaceId: env("EBAY_MARKETPLACE_ID", "EBAY_US"),
  };
  const res = await ebayHttpsRequest("POST", url, { token, body, contentLanguage: true });
  const data = res.json();
  if (!res.ok) {
    throw new Error(`Publish group error (${res.status}): ${JSON.stringify(data)}`);
  }
  return { listingId: data.listingId, status: "published" };
}

function currencyForMarketplace(marketplaceId = env("EBAY_MARKETPLACE_ID", "EBAY_US")) {
  switch (String(marketplaceId || "").toUpperCase()) {
    case "EBAY_GB":
      return "GBP";
    case "EBAY_FR":
    case "EBAY_DE":
    case "EBAY_IT":
    case "EBAY_ES":
      return "EUR";
    case "EBAY_AU":
      return "AUD";
    case "EBAY_CA":
      return "CAD";
    case "EBAY_US":
    default:
      return "USD";
  }
}

async function fetchSellerPrivileges(token) {
  const url = `${ebayApiBase()}/sell/account/v1/privilege`;
  const res = await ebayHttpsRequest("GET", url, { token });
  if (!res.ok) {
    console.warn(`[EBX] privilege HTTP ${res.status}: ${res.text.slice(0, 200)}`);
    return null;
  }
  return res.json();
}

async function fetchPolicyById(token, kind, policyId) {
  if (!policyId) return null;
  const url = `${ebayApiBase()}/sell/account/v1/${kind}/${encodeURIComponent(policyId)}`;
  const res = await ebayHttpsRequest("GET", url, { token });
  if (!res.ok) {
    console.warn(`[EBX] ${kind} ${policyId} HTTP ${res.status}`);
    return { error: true, status: res.status, text: res.text.slice(0, 200) };
  }
  return res.json();
}

/**
 * Préflight publish : limites vendeur + politiques + devise marketplace.
 * Retourne des issues FR actionnables (peut bloquer avant l’appel publish).
 */
async function diagnosePublishReadiness(token, { price } = {}) {
  const market = env("EBAY_MARKETPLACE_ID", "EBAY_US");
  const currency = currencyForMarketplace(market);
  const issues = [];
  const warnings = [];

  const priv = await fetchSellerPrivileges(token);
  if (priv) {
    if (priv.sellerRegistrationCompleted === false) {
      issues.push(
        "Inscription vendeur eBay incomplète (sellerRegistrationCompleted=false). Termine l’inscription vendeur sur eBay.fr puis réessaie."
      );
    }
    const qtyCap = priv.sellingLimit?.quantity;
    const amtCap = Number(priv.sellingLimit?.amount?.value);
    const amtCur = priv.sellingLimit?.amount?.currency || currency;
    if (qtyCap != null && Number(qtyCap) <= 0) {
      issues.push(
        `Limite quantité mensuelle eBay = ${qtyCap}. Demande une hausse dans Seller Hub → Limites, ou attends le reset mensuel.`
      );
    } else if (qtyCap != null && Number(qtyCap) <= 5) {
      warnings.push(`Compte limité : max ${qtyCap} article(s)/mois — on publie en quantité 1.`);
    }
    if (Number.isFinite(amtCap) && amtCap > 0 && price && Number(price) > amtCap) {
      issues.push(
        `Prix ${price} ${currency} > plafond mensuel de ventes (${amtCap} ${amtCur}). Baisse le prix ou demande une hausse de limite.`
      );
    } else if (Number.isFinite(amtCap) && amtCap > 0) {
      warnings.push(`Plafond ventes mensuel : ${amtCap} ${amtCur}.`);
    }
  } else {
    warnings.push("Impossible de lire /privilege (scope sell.account manquant ?). Continue quand même.");
  }

  const returnId = ebayReturnPolicyId();
  const fulfillId = ebayFulfillmentPolicyId();
  const paymentId = ebayPaymentPolicyId();
  const ret = await fetchPolicyById(token, "return_policy", returnId);
  const ful = await fetchPolicyById(token, "fulfillment_policy", fulfillId);
  const pay = await fetchPolicyById(token, "payment_policy", paymentId);

  if (ret?.error) {
    issues.push(`Return policy ${returnId} introuvable (${ret.status}). Lance npm run policies:prod et mets à jour .env.`);
  } else if (ret) {
    if (ret.returnsAccepted === false) {
      issues.push("Ta return policy refuse les retours — eBay FR exige des retours (souvent 30 jours).");
    }
    const days = Number(ret.returnPeriod?.value);
    if (Number.isFinite(days) && days < 30 && /^EBAY_(FR|DE|IT|ES)$/i.test(market)) {
      issues.push(
        `Return policy = ${days} jour(s) — pour ${market} il faut ≥ 30 jours. npm run policies:prod puis mets EBAY_RETURN_POLICY_ID_PROD.`
      );
    }
    if (ret.marketplaceId && ret.marketplaceId !== market) {
      issues.push(
        `Return policy marketplace=${ret.marketplaceId} ≠ ${market}. Recrée les policies pour le bon marketplace.`
      );
    }
  }

  if (ful?.error) {
    issues.push(`Fulfillment policy ${fulfillId} introuvable (${ful.status}). npm run policies:prod.`);
  } else if (ful) {
    const hasShip = (ful.shippingOptions || []).some((o) => (o.shippingServices || []).length > 0);
    if (!hasShip) {
      issues.push("Fulfillment policy sans mode de livraison — crée une policy Colissimo (France).");
    }
    if (ful.marketplaceId && ful.marketplaceId !== market) {
      issues.push(`Fulfillment policy marketplace=${ful.marketplaceId} ≠ ${market}.`);
    }
  }

  if (pay?.error) {
    issues.push(`Payment policy ${paymentId} introuvable (${pay.status}). npm run policies:prod.`);
  } else if (pay?.marketplaceId && pay.marketplaceId !== market) {
    issues.push(`Payment policy marketplace=${pay.marketplaceId} ≠ ${market}.`);
  }

  const envCurrency = env("EBAY_CURRENCY");
  if (envCurrency && envCurrency.toUpperCase() !== currency) {
    warnings.push(
      `EBAY_CURRENCY=${envCurrency} ignoré — marketplace ${market} force ${currency}.`
    );
  }

  return {
    ok: issues.length === 0,
    market,
    currency,
    issues,
    warnings,
    privileges: priv,
    policies: {
      returnDays: ret && !ret.error ? Number(ret.returnPeriod?.value) : null,
      returnsAccepted: ret && !ret.error ? ret.returnsAccepted !== false : null,
      fulfillmentHasShipping:
        ful && !ful.error
          ? (ful.shippingOptions || []).some((o) => (o.shippingServices || []).length > 0)
          : null,
    },
  };
}

function resolvePublishQuantity(privileges) {
  const cap = privileges?.sellingLimit?.quantity;
  if (cap == null) return 1; // prudent pour comptes nouveaux / inconnus
  const n = Number(cap);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(1, Math.max(1, n)); // toujours 1 au 1er publish (évite 25019 limites)
}

async function publishOffer(token, offerId) {
  const url = `${ebayApiBase()}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`;
  const res = await ebayHttpsRequest("POST", url, { token, body: {}, contentLanguage: true });
  const data = res.json();
  if (!res.ok) {
    throw new Error(`Publish offer error (${res.status}): ${JSON.stringify(data)}`);
  }
  return { listingId: data.listingId, status: "published" };
}

async function createOffer(token, sku, listing, categoryId, merchantLocationKey, options = {}) {
  const url = `${ebayApiBase()}/sell/inventory/v1/offer`;
  const market = env("EBAY_MARKETPLACE_ID", "EBAY_US");
  const currency = currencyForMarketplace(market);
  const quantity = Math.max(1, Number(options.quantity) || 1);
  const listingHtml = String(
    options.minimalDescription
      ? `<div style="font-family:Arial,sans-serif;padding:12px;"><p>${String(listing.seo_title || "Produit neuf").replace(/</g, "")}</p><p>Article neuf. Voir les photos.</p></div>`
      : listing.html_description || listing.seo_title || "EBX Product"
  ).slice(0, 490000);
  const body = {
    sku,
    marketplaceId: market,
    format: "FIXED_PRICE",
    listingDescription: listingHtml,
    availableQuantity: quantity,
    pricingSummary: {
      price: {
        value: String(Number(listing.suggested_price) > 0 ? Number(listing.suggested_price).toFixed(2) : "29.99"),
        currency,
      },
    },
    categoryId,
    merchantLocationKey:
      merchantLocationKey ||
      env("EBAY_MERCHANT_LOCATION_KEY") ||
      (market === "EBAY_FR" ? "ebx_fr_wh" : "ebx_us_wh"),
    listingPolicies: {
      fulfillmentPolicyId: ebayFulfillmentPolicyId(),
      paymentPolicyId: ebayPaymentPolicyId(),
      returnPolicyId: ebayReturnPolicyId(),
    },
  };
  const res = await ebayHttpsRequest("POST", url, { token, body, contentLanguage: true });
  const data = res.json();
  if (!res.ok) {
    throw new Error(`Offer API error (${res.status}) [locale=${res.locale}]: ${JSON.stringify(data)}`);
  }
  return { offerId: data.offerId, status: "offer_created", quantity, currency };
}

/**
 * Enrichit le message 25019 avec le diagnostic live (limites / policies).
 * Priorité : raison règlement (hazardous / VeRO) si présente dans l’erreur eBay.
 */
function format25019WithDiagnosis(detail, diagnosis) {
  const policy = extractEbayPolicyBlockReason(detail);
  if (policy) return policy.message;

  const lines = [
    `eBay #25019 — mise en vente refusée`,
    "",
    "→ Diagnostic EBX :",
  ];
  if (diagnosis?.issues?.length) {
    diagnosis.issues.forEach((i, idx) => lines.push(`${idx + 1}) ${i}`));
  } else {
    lines.push("Aucun blocage détecté côté policies/limites API.");
    lines.push("Regarde le détail eBay (souvent : substances dangereuses, VeRO, restriction compte).");
  }
  if (diagnosis?.warnings?.length) {
    lines.push("");
    lines.push("Infos :");
    diagnosis.warnings.forEach((w) => lines.push(`• ${w}`));
  }
  const qty = diagnosis?.privileges?.sellingLimit?.quantity;
  const amt = diagnosis?.privileges?.sellingLimit?.amount;
  if (qty != null || amt) {
    lines.push("");
    lines.push(
      `Limites API : quantité/mois=${qty ?? "n/a"}` +
        (amt ? `, montant/mois=${amt.value} ${amt.currency}` : "")
    );
  }
  if (diagnosis?.policies) {
    lines.push(
      `Policies : retours=${diagnosis.policies.returnDays ?? "?"}j` +
        `, shipping=${diagnosis.policies.fulfillmentHasShipping ? "OK" : "KO"}` +
        `, market=${diagnosis.market}, devise=${diagnosis.currency}`
    );
  }
  if (detail) {
    lines.push("");
    lines.push("Détail brut eBay :");
    lines.push(String(detail).slice(0, 500));
  }
  return lines.join("\n");
}

async function publishToEbay(listing, listingDbId, options = {}) {
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

  listing = sanitizeListingForEbayPublish(listing);

  const token = await getAccessToken();
  const diagnosis = await diagnosePublishReadiness(token, {
    price: listing.suggested_price,
  });
  for (const w of diagnosis.warnings || []) console.warn(`[EBX] Preflight: ${w}`);
  if (!diagnosis.ok) {
    throw new Error(
      `Publish bloqué (préflight) :\n` + diagnosis.issues.map((i, n) => `${n + 1}) ${i}`).join("\n")
    );
  }

  const title = listing.seo_title || "EBX Product";
  const categoryId = await resolveCategoryId(token, title);
  const baseAspects = await buildAspectsForCategory(token, categoryId, title);
  const locationKey = await ensureInventoryLocation(token);
  const quantity = resolvePublishQuantity(diagnosis.privileges);
  // Par défaut: pas de variations (évite 25002 « Couleur non autorisée »).
  const variationInput =
    options.variations && typeof options.variations === "object"
      ? options.variations
      : { enabled: false };
  const variations = await resolveVariationsForCategory(token, categoryId, title, variationInput);

  console.log(
    `[EBX] Publish (${isProduction() ? "PRODUCTION" : "sandbox"}) locale=${ebayMarketplaceLocale()} market=${env(
      "EBAY_MARKETPLACE_ID",
      "EBAY_US"
    )} category=${categoryId} qty=${quantity} currency=${diagnosis.currency} variations=${
      variations.enabled ? `${variations.aspect}:${variations.values.join("|")}` : "off (simple)"
    }`
  );

  const stamp = Date.now();

  // ——— Publish simple (1 SKU) ———
  if (!variations.enabled) {
    const sku = `EBX-${listingDbId}-${stamp}`;
    const aspects = sanitizeAspects({
      ...baseAspects,
      Brand: baseAspects.Brand || baseAspects.Marque || ["Unbranded"],
      Marque: baseAspects.Marque || baseAspects.Brand || ["Sans marque"],
      EAN: ["Does not apply"],
      MPN: ["Does not apply"],
    });
    const inv = await createOrReplaceInventoryItem(token, sku, listing, aspects, {
      ean: ["Does not apply"],
      quantity,
    });
    const { offerId } = await createOffer(token, sku, listing, categoryId, locationKey, {
      quantity,
    });

    try {
      const { listingId } = await publishOffer(token, offerId);
      return {
        sku,
        skus: [sku],
        groupKey: null,
        offerId,
        listingId,
        status: "published",
        categoryId,
        variations: { enabled: false, aspect: null, values: [] },
        imageCount: inv.imageUrls?.length || 0,
        env: isProduction() ? "production" : "sandbox",
        quantity,
        diagnosis,
      };
    } catch (pubErr) {
      const is25019 = /25019|Cannot revise listing|ne peut pas être mis en vente/i.test(
        String(pubErr.message || "")
      );
      if (!is25019) throw pubErr;

      console.warn("[EBX] 25019 → retry description minimale + qty=1…");
      try {
        await updateOfferPriceQuantity(offerId, { quantity: 1 });
        // Recrée l’offer description via PUT offer
        const getUrl = `${ebayApiBase()}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`;
        const existing = await ebayHttpsRequest("GET", getUrl, { token });
        if (existing.ok) {
          const offer = existing.json();
          offer.availableQuantity = 1;
          offer.listingDescription = `<div style="font-family:Arial,sans-serif;padding:12px;"><p>${String(
            title
          ).replace(/[<>]/g, "")}</p><p>Article neuf. Voir les photos de l'annonce.</p></div>`;
          offer.pricingSummary = offer.pricingSummary || {};
          offer.pricingSummary.price = {
            value: String(Number(listing.suggested_price) > 0 ? Number(listing.suggested_price).toFixed(2) : "29.99"),
            currency: diagnosis.currency,
          };
          await ebayHttpsRequest("PUT", getUrl, { token, body: offer, contentLanguage: true });
        }
        const { listingId } = await publishOffer(token, offerId);
        return {
          sku,
          skus: [sku],
          groupKey: null,
          offerId,
          listingId,
          status: "published",
          categoryId,
          variations: { enabled: false, aspect: null, values: [] },
          imageCount: inv.imageUrls?.length || 0,
          env: isProduction() ? "production" : "sandbox",
          quantity: 1,
          diagnosis,
          note: "Publié après retry 25019 (description minimale).",
        };
      } catch (retryErr) {
        const live = await diagnosePublishReadiness(token, { price: listing.suggested_price });
        throw new Error(format25019WithDiagnosis(pubErr.message, live));
      }
    }
  }

  // ——— Publish avec variations (item group) ———
  const groupKey = `EBX-G-${listingDbId}-${stamp}`;
  const skus = [];
  let firstOfferId = null;
  let hostedImages = [];

  for (let i = 0; i < variations.values.length; i++) {
    const value = variations.values[i];
    const sku = `EBX-${listingDbId}-V${i + 1}-${stamp}`;
    const aspects = sanitizeAspects({
      ...baseAspects,
      [variations.aspect]: [value],
      Brand: baseAspects.Brand || baseAspects.Marque || ["Unbranded"],
      Marque: baseAspects.Marque || baseAspects.Brand || ["Sans marque"],
      EAN: ["Does not apply"],
      MPN: ["Does not apply"],
    });
    const inv = await createOrReplaceInventoryItem(token, sku, listing, aspects, {
      ean: ["Does not apply"],
      variantLabel: value,
      imageUrls: hostedImages.length ? hostedImages : undefined,
      quantity,
    });
    if (inv.imageUrls?.length) hostedImages = inv.imageUrls;
    skus.push(sku);
    const { offerId } = await createOffer(token, sku, listing, categoryId, locationKey, {
      quantity,
    });
    if (!firstOfferId) firstOfferId = offerId;
  }

  const groupBody = {
    inventoryItemGroupKey: groupKey,
    variantSKUs: skus,
    title: sanitizeEbayTitle(title),
    description: String(listing.html_description || title).slice(0, 490000),
    imageUrls: hostedImages.slice(0, 8),
    aspects: sanitizeAspects({
      Brand: baseAspects.Brand || ["Unbranded"],
      Marque: baseAspects.Marque || baseAspects.Brand || ["Sans marque"],
      EAN: ["Does not apply"],
      MPN: ["Does not apply"],
      ...Object.fromEntries(
        Object.entries(baseAspects).filter(
          ([k]) => !new RegExp(`^${variations.aspect}$`, "i").test(k)
        )
      ),
    }),
    variesBy: {
      specifications: [
        {
          name: variations.aspect,
          values: variations.values,
        },
      ],
    },
  };
  await createOrReplaceInventoryItemGroup(token, groupKey, groupBody);
  try {
    const { listingId } = await publishByInventoryItemGroup(token, groupKey);
    return {
      sku: skus[0],
      skus,
      groupKey,
      offerId: firstOfferId,
      listingId,
      status: "published",
      categoryId,
      variations,
      env: isProduction() ? "production" : "sandbox",
      quantity,
      diagnosis,
    };
  } catch (pubErr) {
    if (/25019|Cannot revise listing|ne peut pas être mis en vente/i.test(String(pubErr.message || ""))) {
      const live = await diagnosePublishReadiness(token, { price: listing.suggested_price });
      throw new Error(format25019WithDiagnosis(pubErr.message, live));
    }
    throw pubErr;
  }
}

/**
 * Identifie le compte vendeur lié au token OAuth courant (Trading GetUser).
 * Utile pour vérifier Sandbox testuser vs compte réel.
 */
async function getSellerIdentity() {
  loadEbayEnv();
  const token = await getAccessToken();
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetUserRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Version>1399</Version>
</GetUserRequest>`;

  const tradingUrl = new URL(ebayTradingUrl());
  const responseText = await new Promise((resolve, reject) => {
    const payload = Buffer.from(xml, "utf8");
    const req = https.request(
      {
        protocol: tradingUrl.protocol,
        hostname: tradingUrl.hostname,
        port: 443,
        path: tradingUrl.pathname,
        method: "POST",
        headers: {
          "Content-Type": "text/xml",
          "Content-Length": payload.length,
          "X-EBAY-API-IAF-TOKEN": token,
          "X-EBAY-API-CALL-NAME": "GetUser",
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
    req.write(payload);
    req.end();
  });

  const ack = (responseText.match(/<Ack>([^<]+)<\/Ack>/i) || [])[1] || "";
  const userId = (responseText.match(/<UserID>([^<]+)<\/UserID>/i) || [])[1] || "";
  const email = (responseText.match(/<Email>([^<]+)<\/Email>/i) || [])[1] || "";
  if (!/Success|Warning/i.test(ack) || !userId) {
    const shortErr = (responseText.match(/<ShortMessage>([^<]+)<\/ShortMessage>/i) || [])[1] || "GetUser failed";
    throw new Error(shortErr);
  }

  return {
    userId,
    email: email.includes("@") ? email : "",
    env: isProduction() ? "production" : "sandbox",
  };
}

async function getRecentOrders({ limit = 40, daysBack = 90 } = {}) {
  loadEbayEnv();
  const token = await getAccessToken();
  const lim = Math.min(Number(limit) || 40, 50);
  const base = `${ebayApiBase()}/sell/fulfillment/v1/order`;

  const attempts = [];
  // 1) Commandes ouvertes (à expédier)
  attempts.push(
    `${base}?limit=${lim}&filter=${encodeURIComponent("orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}")}`
  );
  // 2) Toutes les commandes récentes (90 jours) — même déjà expédiées
  const end = new Date();
  const start = new Date(Date.now() - Math.max(1, daysBack) * 86400000);
  const dateFilter = `creationdate:[${start.toISOString()}..${end.toISOString()}]`;
  attempts.push(`${base}?limit=${lim}&filter=${encodeURIComponent(dateFilter)}`);
  // 3) Sans filtre
  attempts.push(`${base}?limit=${lim}`);

  const byId = new Map();
  let lastError = null;
  let lastStatus = null;
  let apiOk = false;

  for (const url of attempts) {
    try {
      const res = await ebayHttpsRequest("GET", url, { token });
      lastStatus = res.status;
      if (!res.ok) {
        lastError = `Orders API (${res.status}): ${String(res.text || "").slice(0, 180)}`;
        continue;
      }
      apiOk = true;
      const data = res.json();
      for (const o of data?.orders || []) {
        if (o?.orderId) byId.set(o.orderId, o);
      }
    } catch (e) {
      lastError = e.message;
    }
  }

  if (!apiOk && lastError) {
    throw new Error(lastError);
  }

  let seller = null;
  try {
    seller = await getSellerIdentity();
  } catch (_) {}

  return {
    orders: [...byId.values()],
    env: isProduction() ? "production" : "sandbox",
    sellerUserId: seller?.userId || null,
    httpStatus: lastStatus,
  };
}

/** Appel Trading API XML (IAF OAuth). */
async function tradingApiCall(callName, xmlBody) {
  loadEbayEnv();
  const token = await getAccessToken();
  const tradingUrl = new URL(ebayTradingUrl());
  const payload = Buffer.from(xmlBody, "utf8");
  const responseText = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: tradingUrl.protocol,
        hostname: tradingUrl.hostname,
        port: 443,
        path: tradingUrl.pathname,
        method: "POST",
        headers: {
          "Content-Type": "text/xml",
          "Content-Length": payload.length,
          "X-EBAY-API-IAF-TOKEN": token,
          "X-EBAY-API-CALL-NAME": callName,
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
    req.write(payload);
    req.end();
  });
  const ack = (responseText.match(/<Ack>([^<]+)<\/Ack>/i) || [])[1] || "";
  if (!/Success|Warning/i.test(ack)) {
    const shortErr =
      (responseText.match(/<ShortMessage>([^<]+)<\/ShortMessage>/i) || [])[1] ||
      (responseText.match(/<LongMessage>([^<]+)<\/LongMessage>/i) || [])[1] ||
      `${callName} failed`;
    const err = new Error(shortErr);
    err.raw = responseText.slice(0, 500);
    throw err;
  }
  return responseText;
}

function xmlUnescape(s) {
  return String(s || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractXmlBlocks(xml, tag) {
  const re = new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, "gi");
  return xml.match(re) || [];
}

function xmlField(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? xmlUnescape(m[1].trim()) : "";
}

/**
 * Messages acheteurs (Trading GetMemberMessages).
 * Fallback possible côté serveur si scopes OAuth insuffisants.
 */
async function getMemberMessages({ daysBack = 14, unansweredOnly = false } = {}) {
  const end = new Date();
  const start = new Date(Date.now() - Math.max(1, daysBack) * 86400000);
  const statusXml = unansweredOnly ? "<MessageStatus>Unanswered</MessageStatus>" : "";
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetMemberMessagesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Version>1399</Version>
  <MailMessageType>All</MailMessageType>
  ${statusXml}
  <StartCreationTime>${start.toISOString()}</StartCreationTime>
  <EndCreationTime>${end.toISOString()}</EndCreationTime>
  <Pagination>
    <EntriesPerPage>50</EntriesPerPage>
    <PageNumber>1</PageNumber>
  </Pagination>
</GetMemberMessagesRequest>`;

  const responseText = await tradingApiCall("GetMemberMessages", xml);
  const blocks = extractXmlBlocks(responseText, "MemberMessageExchange");
  const messages = blocks.map((b) => {
    const msg = extractXmlBlocks(b, "Question")[0] || b;
    return {
      messageId: xmlField(msg, "MessageID") || xmlField(b, "MessageID"),
      itemId: xmlField(b, "ItemID") || xmlField(msg, "ItemID"),
      itemTitle: xmlField(b, "Title") || xmlField(msg, "ItemTitle"),
      sender: xmlField(msg, "SenderID") || xmlField(b, "SenderID"),
      recipient: xmlField(msg, "RecipientID") || "",
      subject: xmlField(msg, "Subject") || xmlField(b, "Subject"),
      body: xmlField(msg, "Body") || xmlField(b, "Body"),
      creationDate: xmlField(msg, "CreationDate") || xmlField(b, "CreationDate"),
      messageStatus: xmlField(b, "MessageStatus") || xmlField(msg, "MessageStatus"),
      answered: /Answered/i.test(xmlField(b, "MessageStatus") || ""),
    };
  }).filter((m) => m.messageId || m.body);

  return {
    messages,
    count: messages.length,
    env: isProduction() ? "production" : "sandbox",
  };
}

/** Réponse à un message membre (AddMemberMessageRTQ). */
async function replyToMemberMessage({ itemId, parentMessageId, recipientId, body } = {}) {
  if (!itemId || !parentMessageId || !recipientId || !body) {
    throw new Error("itemId, parentMessageId, recipientId et body requis");
  }
  const safeBody = String(body)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<AddMemberMessageRTQRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Version>1399</Version>
  <ItemID>${String(itemId)}</ItemID>
  <MemberMessage>
    <Body>${safeBody}</Body>
    <ParentMessageID>${String(parentMessageId)}</ParentMessageID>
    <RecipientID>${String(recipientId)}</RecipientID>
  </MemberMessage>
</AddMemberMessageRTQRequest>`;
  await tradingApiCall("AddMemberMessageRTQ", xml);
  return { ok: true, parentMessageId, itemId };
}

async function updateOfferPriceQuantity(offerId, { price, quantity } = {}) {
  loadEbayEnv();
  const token = await getAccessToken();
  const getUrl = `${ebayApiBase()}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`;
  const existing = await ebayHttpsRequest("GET", getUrl, { token });
  if (!existing.ok) throw new Error(`Offer GET (${existing.status}): ${existing.text.slice(0, 180)}`);
  const offer = existing.json();
  if (price != null) {
    offer.pricingSummary = offer.pricingSummary || {};
    offer.pricingSummary.price = {
      value: String(Number(price).toFixed(2)),
      currency: process.env.EBAY_CURRENCY || offer.pricingSummary?.price?.currency || "USD",
    };
  }
  if (quantity != null) offer.availableQuantity = Number(quantity);
  const put = await ebayHttpsRequest("PUT", getUrl, { token, body: offer, contentLanguage: true });
  if (!put.ok && put.status !== 204) {
    throw new Error(`Offer update (${put.status}): ${put.text.slice(0, 200)}`);
  }
  return { offerId, price, quantity, status: "updated" };
}

async function endEbayOffer(offerId) {
  loadEbayEnv();
  const token = await getAccessToken();
  const url = `${ebayApiBase()}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/withdraw`;
  const res = await ebayHttpsRequest("POST", url, { token, body: {}, contentLanguage: true });
  if (!res.ok && res.status !== 200 && res.status !== 204) {
    throw new Error(`Withdraw offer (${res.status}): ${res.text.slice(0, 220)}`);
  }
  return { offerId, status: "ended" };
}

module.exports = {
  publishToEbay,
  getAccessToken,
  getSellerIdentity,
  getRecentOrders,
  getMemberMessages,
  replyToMemberMessage,
  updateOfferPriceQuantity,
  endEbayOffer,
  clearTokenCache,
  describeAuthState,
  isProduction,
  ebayApiBase,
  ebayAuthUrl,
  parseDuplicateListingError,
  formatEbayPublishError,
  extractEbayPolicyBlockReason,
  differentiateEbayTitle,
  sanitizeEbayTitle,
  sanitizeListingForEbayPublish,
  diagnosePublishReadiness,
  fetchSellerPrivileges,
  currencyForMarketplace,
};
