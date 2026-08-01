/**
 * EBX — Obtenir un EBAY_REFRESH_TOKEN (valable ~18 mois)
 *
 * Usage :
 *   npm run oauth           → Sandbox (testuser) — défaut
 *   npm run oauth:prod      → Production (vrai compte vendeur) — NE PAS utiliser tant que non demandé
 *   npm run oauth -- CODE
 */

const readline = require("readline");
const { loadEbayEnv } = require("./load-env");
loadEbayEnv();

const isProd =
  process.argv.includes("--prod") ||
  process.argv.includes("prod") ||
  String(process.env.EBAY_ENV || "").toLowerCase() === "production";

const CLIENT_ID = String(
  (isProd ? process.env.EBAY_PROD_CLIENT_ID || process.env.EBAY_CLIENT_ID : process.env.EBAY_CLIENT_ID) || ""
).trim();
const CLIENT_SECRET = String(
  (isProd
    ? process.env.EBAY_PROD_CLIENT_SECRET || process.env.EBAY_CLIENT_SECRET
    : process.env.EBAY_CLIENT_SECRET) || ""
).trim();
const RU_NAME = String(
  (isProd
    ? process.env.EBAY_RU_NAME_PROD || process.env.EBAY_RU_NAME
    : process.env.EBAY_RU_NAME || process.env.EBAY_REDIRECT_URI) || ""
).trim();

const AUTH_URL = isProd
  ? process.env.EBAY_AUTH_URL_PROD || "https://api.ebay.com/identity/v1/oauth2/token"
  : process.env.EBAY_AUTH_URL || "https://api.sandbox.ebay.com/identity/v1/oauth2/token";
const CONSENT_BASE = isProd
  ? "https://auth.ebay.com/oauth2/authorize"
  : "https://auth.sandbox.ebay.com/oauth2/authorize";

const SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.marketing",
].join(" ");

function buildConsentUrl() {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: RU_NAME,
    scope: SCOPES,
  });
  return `${CONSENT_BASE}?${params.toString()}`;
}

async function exchangeCode(code) {
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: RU_NAME,
    }),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`Échange code échoué (${res.status}): ${text}`);
  }
  return data;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer || "").trim());
    });
  });
}

function extractCode(input) {
  if (!input) return "";
  try {
    if (input.includes("code=")) {
      const u = new URL(input.includes("://") ? input : `https://localhost/?${input.replace(/^\?/, "")}`);
      return decodeURIComponent(u.searchParams.get("code") || "");
    }
  } catch (_) {}
  try {
    return decodeURIComponent(input);
  } catch (_) {
    return input;
  }
}

async function main() {
  console.log(`\n⚡ EBX — Refresh Token ${isProd ? "PRODUCTION (réel)" : "Sandbox (test)"}\n`);

  if (isProd) {
    console.log("⚠️  Mode Production : les annonces seront RÉELLES sur ton vrai compte vendeur.");
    console.log("   N'utilise ce mode que quand EBX te le demandera explicitement.\n");
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error(
      isProd
        ? "❌ EBAY_PROD_CLIENT_ID / EBAY_PROD_CLIENT_SECRET manquants dans .env"
        : "❌ EBAY_CLIENT_ID / EBAY_CLIENT_SECRET manquants dans .env"
    );
    process.exit(1);
  }
  if (!RU_NAME) {
    console.error(`❌ ${isProd ? "EBAY_RU_NAME_PROD" : "EBAY_RU_NAME"} manquant dans .env`);
    console.error(`
Créer le RuName (${isProd ? "Production" : "Sandbox"}) :
  1. https://developer.ebay.com/my/auth/?env=${isProd ? "production" : "sandbox"}&index=0
  2. Get a Token from eBay via Your Application → Add/configure RuName
  3. Copie dans .env :
       ${isProd ? "EBAY_RU_NAME_PROD" : "EBAY_RU_NAME"}=TonRuName-...
`);
    process.exit(1);
  }

  const argCode = process.argv
    .slice(2)
    .filter((a) => a !== "--" && a !== "--prod" && a !== "prod")
    .join(" ")
    .trim();
  let code = extractCode(argCode);

  if (!code) {
    const url = buildConsentUrl();
    console.log(`1) Ouvre cette URL (${isProd ? "compte vendeur RÉEL" : "compte Sandbox"}) :\n`);
    console.log(url);
    console.log(`
2) Connecte-toi et accepte les permissions.
3) Copie l'URL complète (ou le code=...) de la barre d'adresse.
`);
    code = extractCode(await ask("Colle l'URL ou le code ici : "));
  }

  if (!code) {
    console.error("❌ Code vide");
    process.exit(1);
  }

  console.log("\n→ Échange du code (valable ~5 min)...");
  const data = await exchangeCode(code);

  if (!data.refresh_token) {
    console.error("❌ Pas de refresh_token dans la réponse:", data);
    process.exit(1);
  }

  const expiresDays = data.refresh_token_expires_in
    ? Math.round(Number(data.refresh_token_expires_in) / 86400)
    : "~540";

  if (isProd) {
    console.log(`
✅ OK — refresh token PRODUCTION (≈ ${expiresDays} jours, ${data.refresh_token.length} car.)

Quand EBX te le dira, mets dans .env :

EBAY_ENV=production
EBAY_CLIENT_ID=<ton App ID Production>
EBAY_CLIENT_SECRET=<ton Cert ID Production>
EBAY_RU_NAME=${RU_NAME}
EBAY_REFRESH_TOKEN="${data.refresh_token}"
EBAY_API_BASE=https://api.ebay.com
EBAY_AUTH_URL=https://api.ebay.com/identity/v1/oauth2/token

Puis npm run policies (nouveaux IDs) et redémarre le serveur.
`);
  } else {
    console.log(`
✅ OK — refresh token Sandbox (≈ ${expiresDays} jours, ${data.refresh_token.length} car.)

Colle dans ebx/.env :

EBAY_REFRESH_TOKEN="${data.refresh_token}"

# EBAY_USER_TOKEN=

Puis : npm run env-check → node server.js
`);
  }

  if (data.access_token) {
    try {
      const apiBase = isProd ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
      const probe = await fetch(apiBase + "/sell/account/v1/privilege", {
        headers: {
          Authorization: `Bearer ${data.access_token}`,
          Accept: "application/json",
        },
      });
      if (probe.ok) console.log("✅ Privilege API OK — scopes vendeur corrects\n");
      else console.log(`⚠️  Privilege API ${probe.status} — vérifie les scopes Sell sur l'app.\n`);
    } catch (e) {
      console.log("⚠️  Impossible de tester privilege:", e.message);
    }
  }
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
