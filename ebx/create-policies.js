/**
 * EBX — Création des Business Policies eBay
 *
 * Usage :
 *   npm run policies        → Sandbox
 *   npm run policies:prod   → Production (vrai compte)
 */

const { loadEbayEnv } = require("./load-env");
loadEbayEnv();

// Force prod après lecture .env (sinon EBAY_ENV=sandbox du fichier gagne)
if (process.argv.includes("--prod") || process.argv.includes("prod")) {
  process.env.EBAY_ENV = "production";
}

const { getAccessToken, describeAuthState, isProduction, ebayApiBase, ebayAuthUrl } = require("./ebay-api");

function cleanPresent(name) {
  const v = String(process.env[name] || "")
    .trim()
    .replace(/^["']|["']$/g, "");
  return Boolean(v);
}

function marketplace() {
  return process.env.EBAY_MARKETPLACE_ID || (isProduction() ? "EBAY_US" : "EBAY_US");
}

function currencyForMarketplace(market) {
  switch (market) {
    case "EBAY_US":
      return "USD";
    case "EBAY_GB":
      return "GBP";
    case "EBAY_FR":
    case "EBAY_DE":
    case "EBAY_IT":
    case "EBAY_ES":
      return "EUR";
    default:
      return "USD";
  }
}

function shippingForMarketplace(market) {
  const currency = currencyForMarketplace(market);
  if (market === "EBAY_US") {
    return {
      shippingCarrierCode: "USPS",
      shippingServiceCode: "USPSPriority",
      shippingCost: { value: "5.99", currency: "USD" },
      additionalShippingCost: { value: "2.00", currency: "USD" },
    };
  }
  // Europe — service générique souvent accepté
  return {
    shippingCarrierCode: "Other",
    shippingServiceCode: "Other",
    shippingCost: { value: "4.90", currency },
    additionalShippingCost: { value: "2.00", currency },
  };
}

function localeForMarketplace() {
  const m = marketplace();
  if (m === "EBAY_FR") return "fr-FR";
  if (m === "EBAY_GB") return "en-GB";
  if (m === "EBAY_DE") return "de-DE";
  return "en-US";
}

async function ebayFetch(method, pathName, body, token) {
  const res = await fetch(`${ebayApiBase()}${pathName}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": localeForMarketplace(),
      "Accept-Language": localeForMarketplace(),
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  return { status: res.status, ok: res.ok, data };
}

async function probeToken(token) {
  console.log("→ Test token (GET privilege)...");
  const { status, data } = await ebayFetch("GET", "/sell/account/v1/privilege", null, token);
  if (status === 200) {
    console.log("  ✅ Token valide");
    return true;
  }
  console.log(`  ❌ Token invalide (${status}):`, JSON.stringify(data));
  console.log(
    isProduction()
      ? "\nCorrige : npm run oauth:prod + EBAY_REFRESH_TOKEN_PROD\n"
      : "\nCorrige : npm run oauth + EBAY_REFRESH_TOKEN\n"
  );
  return false;
}

async function optIn(token) {
  console.log("→ Opt-in Business Policies...");
  const { status, data } = await ebayFetch(
    "POST",
    "/sell/account/v1/program/opt_in",
    { programType: "SELLING_POLICY_MANAGEMENT" },
    token
  );

  if (status === 200 || status === 201 || status === 204 || status === 409) {
    console.log("  ✅ Opt-in OK");
    return;
  }
  console.log(`  ⚠️ Opt-in status ${status}:`, JSON.stringify(data));
}

async function createFulfillmentPolicy(token) {
  console.log("→ Création Fulfillment (Shipping) Policy...");
  const market = marketplace();
  const currency = process.env.EBAY_CURRENCY || (market === "EBAY_US" ? "USD" : "EUR");
  const body = {
    name: "EBX Shipping",
    marketplaceId: market,
    categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES", default: true }],
    handlingTime: { value: 1, unit: "DAY" },
    shippingOptions: [
      {
        optionType: "DOMESTIC",
        costType: "FLAT_RATE",
        shippingServices: [
          {
            sortOrder: 1,
            shippingCarrierCode: market === "EBAY_US" ? "USPS" : "LaPosteColissimo",
            shippingServiceCode: market === "EBAY_US" ? "USPSPriority" : "FR_Colissimo",
            shippingCost: { value: market === "EBAY_US" ? "5.99" : "4.90", currency },
            additionalShippingCost: { value: "2.00", currency },
            freeShipping: false,
            buyerResponsibleForShipping: false,
            buyerResponsibleForPickup: false,
          },
        ],
      },
    ],
    shipToLocations: { regionIncluded: [{ regionName: "Worldwide" }] },
  };

  const { status, data } = await ebayFetch("POST", "/sell/account/v1/fulfillment_policy", body, token);
  if (status === 201 || status === 200) {
    console.log("  ✅ Fulfillment Policy ID:", data.fulfillmentPolicyId);
    return data.fulfillmentPolicyId;
  }

  console.log(`  ⚠️ Create failed (${status}), listing existing...`);
  const list = await ebayFetch(
    "GET",
    `/sell/account/v1/fulfillment_policy?marketplace_id=${market}`,
    null,
    token
  );
  const existing = list.data?.fulfillmentPolicies?.[0];
  if (existing) {
    console.log("  ✅ Existing Fulfillment Policy ID:", existing.fulfillmentPolicyId);
    return existing.fulfillmentPolicyId;
  }
  console.error("  ❌", JSON.stringify(data));
  return null;
}

async function createPaymentPolicy(token) {
  console.log("→ Création Payment Policy...");
  const market = marketplace();
  const body = {
    name: "EBX Payment",
    marketplaceId: market,
    categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES", default: true }],
    paymentMethods: [],
    immediatePay: true,
  };

  const { status, data } = await ebayFetch("POST", "/sell/account/v1/payment_policy", body, token);
  if (status === 201 || status === 200) {
    console.log("  ✅ Payment Policy ID:", data.paymentPolicyId);
    return data.paymentPolicyId;
  }

  console.log(`  ⚠️ Create failed (${status}), listing existing...`);
  const list = await ebayFetch(
    "GET",
    `/sell/account/v1/payment_policy?marketplace_id=${market}`,
    null,
    token
  );
  const existing = list.data?.paymentPolicies?.[0];
  if (existing) {
    console.log("  ✅ Existing Payment Policy ID:", existing.paymentPolicyId);
    return existing.paymentPolicyId;
  }
  console.error("  ❌", JSON.stringify(data));
  return null;
}

async function createReturnPolicy(token) {
  console.log("→ Création Return Policy...");
  const market = marketplace();
  const body = {
    name: "EBX Returns",
    marketplaceId: market,
    categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES", default: true }],
    returnsAccepted: true,
    returnPeriod: { value: 30, unit: "DAY" },
    refundMethod: "MONEY_BACK",
    returnShippingCostPayer: "SELLER",
    returnMethod: "REPLACEMENT",
  };

  const { status, data } = await ebayFetch("POST", "/sell/account/v1/return_policy", body, token);
  if (status === 201 || status === 200) {
    console.log("  ✅ Return Policy ID:", data.returnPolicyId);
    return data.returnPolicyId;
  }

  console.log(`  ⚠️ Create failed (${status}), listing existing...`);
  const list = await ebayFetch(
    "GET",
    `/sell/account/v1/return_policy?marketplace_id=${market}`,
    null,
    token
  );
  const existing = list.data?.returnPolicies?.[0];
  if (existing) {
    console.log("  ✅ Existing Return Policy ID:", existing.returnPolicyId);
    return existing.returnPolicyId;
  }
  console.error("  ❌", JSON.stringify(data));
  return null;
}

async function main() {
  const prod = isProduction();
  const market = marketplace();
  console.log(`\n⚡ EBX — Business Policies ${prod ? "PRODUCTION" : "Sandbox"} (${market})\n`);
  if (prod) {
    console.log("⚠️  Compte vendeur RÉEL — les policies seront créées en Production.\n");
  }

  const existing = prod
    ? {
        fulfillment: process.env.EBAY_FULFILLMENT_POLICY_ID_PROD,
        payment: process.env.EBAY_PAYMENT_POLICY_ID_PROD,
        return: process.env.EBAY_RETURN_POLICY_ID_PROD,
      }
    : {
        fulfillment: process.env.EBAY_FULFILLMENT_POLICY_ID,
        payment: process.env.EBAY_PAYMENT_POLICY_ID,
        return: process.env.EBAY_RETURN_POLICY_ID,
      };
  const hasExisting = existing.fulfillment && existing.payment && existing.return;

  const auth = describeAuthState();
  console.log("— Auth .env —");
  console.log(`  ENV              : ${auth.env}`);
  console.log(`  API              : ${ebayApiBase()}`);
  console.log(`  AUTH             : ${ebayAuthUrl()}`);
  console.log(`  CLIENT_ID/SECRET : ${auth.hasClientId && auth.hasClientSecret ? "OK" : "MANQUANT"}`);
  console.log(`  REFRESH_TOKEN    : ${auth.refreshLen} car. ${auth.refreshLen >= 40 ? "✅" : "❌"}`);
  if (prod && !cleanPresent("EBAY_REFRESH_TOKEN_PROD")) {
    console.log("  ⚠️  EBAY_REFRESH_TOKEN_PROD manquant — ajoute-le (ne pas réutiliser le refresh Sandbox)");
  }
  console.log("");

  let token;
  try {
    token = await getAccessToken();
    console.log("  Auth: access token OK\n");
  } catch (err) {
    console.error("❌", err.message);
    process.exit(1);
  }

  const ok = await probeToken(token);
  if (!ok) {
    if (hasExisting) {
      console.log("⚠️  Privilege refusée, mais IDs déjà présents — tu peux les garder.\n");
      process.exit(0);
    }
    process.exit(1);
  }

  await optIn(token);
  const fulfillmentId = await createFulfillmentPolicy(token);
  const paymentId = await createPaymentPolicy(token);
  const returnId = await createReturnPolicy(token);

  console.log("\n════════════════════════════════════════");
  console.log("Copie ces lignes dans ton fichier ebx/.env :");
  console.log("════════════════════════════════════════\n");
  if (prod) {
    if (fulfillmentId) console.log(`EBAY_FULFILLMENT_POLICY_ID_PROD=${fulfillmentId}`);
    if (paymentId) console.log(`EBAY_PAYMENT_POLICY_ID_PROD=${paymentId}`);
    if (returnId) console.log(`EBAY_RETURN_POLICY_ID_PROD=${returnId}`);
  } else {
    if (fulfillmentId) console.log(`EBAY_FULFILLMENT_POLICY_ID=${fulfillmentId}`);
    if (paymentId) console.log(`EBAY_PAYMENT_POLICY_ID=${paymentId}`);
    if (returnId) console.log(`EBAY_RETURN_POLICY_ID=${returnId}`);
  }
  console.log(`EBAY_MARKETPLACE_ID=${market}`);
  if (prod) {
    console.log("\nQuand tout est prêt pour publier en réel :");
    console.log("  EBAY_ENV=production");
  }
  console.log("");
}

main().catch((err) => {
  console.error("Erreur fatale:", err.message);
  process.exit(1);
});
