/**
 * EBX — Obtenir un EBAY_REFRESH_TOKEN (valable ~18 mois)
 *
 * Une fois configuré, plus besoin de coller EBAY_USER_TOKEN toutes les 2h.
 *
 * Prérequis dans ebx/.env :
 *   EBAY_CLIENT_ID=...
 *   EBAY_CLIENT_SECRET=...
 *   EBAY_RU_NAME=...   (RuName Sandbox créé sur developer.ebay.com)
 *
 * Usage :
 *   npm run oauth          → affiche l'URL de consentement
 *   npm run oauth -- CODE  → échange le code contre refresh_token
 */

const readline = require("readline");
const { loadEbayEnv } = require("./load-env");
loadEbayEnv();

const CLIENT_ID = String(process.env.EBAY_CLIENT_ID || "").trim();
const CLIENT_SECRET = String(process.env.EBAY_CLIENT_SECRET || "").trim();
const RU_NAME = String(process.env.EBAY_RU_NAME || process.env.EBAY_REDIRECT_URI || "").trim();
const AUTH_URL = process.env.EBAY_AUTH_URL || "https://api.sandbox.ebay.com/identity/v1/oauth2/token";
const CONSENT_BASE = "https://auth.sandbox.ebay.com/oauth2/authorize";

const SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.marketing",
].join(" ");

function buildConsentUrl() {
  // URLSearchParams encode correctement les espaces des scopes
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
  return input;
}

async function main() {
  console.log("\n⚡ EBX — Refresh Token Sandbox (~18 mois)\n");

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("❌ EBAY_CLIENT_ID / EBAY_CLIENT_SECRET manquants dans ebx/.env");
    process.exit(1);
  }
  if (!RU_NAME) {
    console.error("❌ EBAY_RU_NAME manquant dans ebx/.env");
    console.error(`
Créer le RuName :
  1. https://developer.ebay.com/my/auth/?env=sandbox&index=0
  2. Get a Token from eBay via Your Application → Add/configure RuName (Sandbox)
  3. Copie le RuName (ex. YourApp-YourApp-SBX-xxxxx-xxxxx) dans .env :
       EBAY_RU_NAME=YourApp-YourApp-SBX-xxxxx-xxxxx
`);
    process.exit(1);
  }

  const argCode = process.argv.slice(2).filter((a) => a !== "--").join(" ").trim();
  let code = extractCode(argCode);

  if (!code) {
    const url = buildConsentUrl();
    console.log("1) Ouvre cette URL dans le navigateur (compte Sandbox) :\n");
    console.log(url);
    console.log(`
2) Connecte-toi avec un utilisateur Sandbox et accepte.
3) Tu arrives sur une page / URL contenant ?code=...
   (copie toute l'URL de la barre d'adresse, ou juste la valeur de code=)
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

  console.log(`
✅ OK — refresh token obtenu (≈ ${expiresDays} jours, ${data.refresh_token.length} car.)

Scopes demandés :
  ${SCOPES}

Colle ceci dans ebx/.env (guillemets obligatoires) :

EBAY_REFRESH_TOKEN="${data.refresh_token}"

# EBAY_USER_TOKEN=

Puis : npm run env-check → npm run policies (ou directement node server.js si policies déjà OK)
`);

  // Vérifie que le token a bien les droits vendeur
  if (data.access_token) {
    try {
      const probe = await fetch(
        (process.env.EBAY_API_BASE || "https://api.sandbox.ebay.com") + "/sell/account/v1/privilege",
        {
          headers: {
            Authorization: `Bearer ${data.access_token}`,
            Accept: "application/json",
          },
        }
      );
      if (probe.ok) {
        console.log("✅ Privilege API OK — scopes vendeur corrects\n");
      } else {
        const t = await probe.text();
        console.log(`⚠️  Privilege API ${probe.status} — scopes peut-être incomplets:`);
        console.log(`   ${t.slice(0, 200)}`);
        console.log("   Sur developer.ebay.com → ton app Sandbox → active les OAuth scopes Sell (inventory, account, fulfillment).\n");
      }
    } catch (e) {
      console.log("⚠️  Impossible de tester privilege:", e.message);
    }
  }
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
