/**
 * EBX — Obtenir un EBAY_REFRESH_TOKEN (valable ~18 mois)
 *
 * Usage :
 *   npm run oauth           → Sandbox (testuser) — défaut
 *   npm run oauth:prod      → Production (vrai compte vendeur) — NE PAS utiliser tant que non demandé
 *   npm run oauth -- CODE
 */

const readline = require("readline");
const { loadEbayEnv, cleanEnvToken } = require("./load-env");
loadEbayEnv();

const isProd =
  process.argv.includes("--prod") ||
  process.argv.includes("prod") ||
  String(process.env.EBAY_ENV || "").toLowerCase() === "production";

const CLIENT_ID = cleanEnvToken(
  isProd ? process.env.EBAY_PROD_CLIENT_ID || process.env.EBAY_CLIENT_ID : process.env.EBAY_CLIENT_ID
);
const CLIENT_SECRET = cleanEnvToken(
  isProd
    ? process.env.EBAY_PROD_CLIENT_SECRET || process.env.EBAY_CLIENT_SECRET
    : process.env.EBAY_CLIENT_SECRET
);
const RU_NAME = cleanEnvToken(
  isProd
    ? process.env.EBAY_RU_NAME_PROD || process.env.EBAY_RU_NAME
    : process.env.EBAY_RU_NAME || process.env.EBAY_REDIRECT_URI
);

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
  3. Copie dans .env avec guillemets DROITS " (pas Word ”) :
       ${isProd ? "EBAY_RU_NAME_PROD" : "EBAY_RU_NAME"}="TonRuName-..."
`);
    process.exit(1);
  }

  // Détecte encore des guillemets Word restants
  if (/[\u201C\u201D\u2018\u2019]/.test(RU_NAME) || RU_NAME.startsWith("%")) {
    console.error('❌ RuName contient encore des guillemets invalides. Utilise: EBAY_RU_NAME_PROD="xxx"');
    process.exit(1);
  }

  console.log(`  Client ID : ${CLIENT_ID.slice(0, 12)}… (${CLIENT_ID.length} car.)`);
  console.log(`  RuName    : ${RU_NAME} (${RU_NAME.length} car.)\n`);

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
EBAY_REFRESH_TOKEN_PROD="${data.refresh_token}"
EBAY_API_BASE=https://api.ebay.com
EBAY_AUTH_URL=https://api.ebay.com/identity/v1/oauth2/token

Puis npm run policies:prod (nouveaux IDs) — ne mets EBAY_ENV=production qu'après.
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
      if (probe.ok) console.log("✅ Privilege API OK — scopes vendeur corrects");
      else console.log(`⚠️  Privilege API ${probe.status} — vérifie les scopes Sell sur l'app.`);
    } catch (e) {
      console.log("⚠️  Impossible de tester privilege:", e.message);
    }

    // Affiche le pseudo lié — évite la confusion « même token » (tous commencent par v^1.1#)
    try {
      const https = require("https");
      const tradingHost = isProd ? "api.ebay.com" : "api.sandbox.ebay.com";
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetUserRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Version>1399</Version>
</GetUserRequest>`;
      const userId = await new Promise((resolve, reject) => {
        const payload = Buffer.from(xml, "utf8");
        const req = https.request(
          {
            hostname: tradingHost,
            path: "/ws/api.dll",
            method: "POST",
            headers: {
              "Content-Type": "text/xml",
              "Content-Length": payload.length,
              "X-EBAY-API-IAF-TOKEN": data.access_token,
              "X-EBAY-API-CALL-NAME": "GetUser",
              "X-EBAY-API-SITEID": "0",
              "X-EBAY-API-COMPATIBILITY-LEVEL": "1399",
            },
          },
          (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
              const text = Buffer.concat(chunks).toString("utf8");
              const id = (text.match(/<UserID>([^<]+)<\/UserID>/i) || [])[1] || "";
              resolve(id);
            });
          }
        );
        req.on("error", reject);
        req.write(payload);
        req.end();
      });
      if (userId) {
        console.log(`\n👤 Compte eBay lié à CE token : ${userId}`);
        console.log("   → Vérifie que c'est bien ton NOUVEAU pseudo (pas l'ancien).");
      } else {
        console.log("\n⚠️  Impossible de lire le UserID — vérifie dans EBX Paramètres après restart.");
      }
    } catch (e) {
      console.log("⚠️  GetUser:", e.message);
    }

    const rt = data.refresh_token;
    console.log(
      `\n🔎 Empreinte token (tous commencent par v^1.1# — compare la FIN) :\n` +
        `   début… ${rt.slice(0, 24)}…\n` +
        `   …fin   ${rt.slice(-32)}\n` +
        `   longueur ${rt.length} car.\n`
    );
  }
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
