/**
 * EBX — Création des Business Policies eBay Sandbox via API
 *
 * Usage :
 *   1. Remplir ebx/.env avec EBAY_REFRESH_TOKEN (npm run oauth) ou EBAY_USER_TOKEN
 *   2. node create-policies.js
 *   3. Copier les 3 IDs affichés dans ton .env
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const { getAccessToken } = require("./ebay-api");

const EBAY_API_BASE = process.env.EBAY_API_BASE || "https://api.sandbox.ebay.com";
const MARKETPLACE = process.env.EBAY_MARKETPLACE_ID || "EBAY_US";

async function ebayFetch(method, pathName, body, token) {
  const res = await fetch(`${EBAY_API_BASE}${pathName}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
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
    console.log("  ✅ Token Sandbox valide");
    return true;
  }
  console.log(`  ❌ Token invalide (${status}):`, JSON.stringify(data));
  console.log(`
Corrige l'auth dans ebx/.env :
  • Recommandé : npm run oauth → EBAY_REFRESH_TOKEN (≈18 mois)
  • Ou temporaire : EBAY_USER_TOKEN du portail (≈2h), entre guillemets doubles
`);
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
  const body = {
    name: "EBX Shipping",
    marketplaceId: MARKETPLACE,
    categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES", default: true }],
    handlingTime: { value: 1, unit: "DAY" },
    shippingOptions: [
      {
        optionType: "DOMESTIC",
        costType: "FLAT_RATE",
        shippingServices: [
          {
            sortOrder: 1,
            shippingCarrierCode: "USPS",
            shippingServiceCode: "USPSPriority",
            shippingCost: { value: "5.99", currency: "USD" },
            additionalShippingCost: { value: "2.00", currency: "USD" },
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
    `/sell/account/v1/fulfillment_policy?marketplace_id=${MARKETPLACE}`,
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
  const body = {
    name: "EBX Payment",
    marketplaceId: MARKETPLACE,
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
    `/sell/account/v1/payment_policy?marketplace_id=${MARKETPLACE}`,
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
  const body = {
    name: "EBX Returns",
    marketplaceId: MARKETPLACE,
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
    `/sell/account/v1/return_policy?marketplace_id=${MARKETPLACE}`,
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
  console.log(`\n⚡ EBX — Business Policies Sandbox (${MARKETPLACE})\n`);

  let token;
  try {
    token = await getAccessToken();
    console.log("  Auth: refresh token ou user token OK\n");
  } catch (err) {
    console.error("❌", err.message);
    process.exit(1);
  }

  const ok = await probeToken(token);
  if (!ok) {
    console.log("Astuce : si tu avais déjà créé les policies avant, remets dans .env :");
    console.log("  EBAY_FULFILLMENT_POLICY_ID=6240367000");
    console.log("  EBAY_PAYMENT_POLICY_ID=6240368000");
    console.log("  EBAY_RETURN_POLICY_ID=6240369000");
    console.log("  (IDs de ta session précédente — à confirmer dans le Seller Hub Sandbox)\n");
    process.exit(1);
  }

  await optIn(token);
  const fulfillmentId = await createFulfillmentPolicy(token);
  const paymentId = await createPaymentPolicy(token);
  const returnId = await createReturnPolicy(token);

  console.log("\n════════════════════════════════════════");
  console.log("Copie ces lignes dans ton fichier ebx/.env :");
  console.log("════════════════════════════════════════\n");
  if (fulfillmentId) console.log(`EBAY_FULFILLMENT_POLICY_ID=${fulfillmentId}`);
  if (paymentId) console.log(`EBAY_PAYMENT_POLICY_ID=${paymentId}`);
  if (returnId) console.log(`EBAY_RETURN_POLICY_ID=${returnId}`);
  console.log(`EBAY_MARKETPLACE_ID=${MARKETPLACE}`);
  console.log("");
}

main().catch((err) => {
  console.error("Erreur fatale:", err.message);
  process.exit(1);
});
