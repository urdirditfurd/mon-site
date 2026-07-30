/**
 * EBX — Création des Business Policies eBay Sandbox via API
 *
 * Usage :
 *   1. Remplir ebx/.env avec EBAY_USER_TOKEN (+ CLIENT_ID / SECRET)
 *   2. node create-policies.js
 *   3. Copier les 3 IDs affichés dans ton .env
 */

require("dotenv").config();

const EBAY_API_BASE = process.env.EBAY_API_BASE || "https://api.sandbox.ebay.com";
const MARKETPLACE = process.env.EBAY_MARKETPLACE_ID || "EBAY_US";
const TOKEN = process.env.EBAY_USER_TOKEN || "";

if (!TOKEN) {
  console.error("❌ EBAY_USER_TOKEN manquant dans .env");
  console.error("   Copie le token depuis developer.ebay.com → User Tokens (Sandbox OAuth)");
  process.exit(1);
}

async function ebayFetch(method, path, body) {
  const res = await fetch(`${EBAY_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
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

async function optIn() {
  console.log("→ Opt-in Business Policies...");
  const { status, data } = await ebayFetch("POST", "/sell/account/v1/program/opt_in", {
    programType: "SELLING_POLICY_MANAGEMENT",
  });

  // 200/201 = ok, 409 = déjà opt-in
  if (status === 200 || status === 201 || status === 204 || status === 409) {
    console.log("  ✅ Opt-in OK");
    return;
  }
  console.log(`  ⚠️ Opt-in status ${status}:`, JSON.stringify(data));
}

async function createFulfillmentPolicy() {
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

  const { status, data } = await ebayFetch("POST", "/sell/account/v1/fulfillment_policy", body);
  if (status === 201 || status === 200) {
    console.log("  ✅ Fulfillment Policy ID:", data.fulfillmentPolicyId);
    return data.fulfillmentPolicyId;
  }

  // Si déjà créée, lister
  console.log(`  ⚠️ Create failed (${status}), listing existing...`);
  const list = await ebayFetch(
    "GET",
    `/sell/account/v1/fulfillment_policy?marketplace_id=${MARKETPLACE}`
  );
  const existing = list.data?.fulfillmentPolicies?.[0];
  if (existing) {
    console.log("  ✅ Existing Fulfillment Policy ID:", existing.fulfillmentPolicyId);
    return existing.fulfillmentPolicyId;
  }
  console.error("  ❌", JSON.stringify(data));
  return null;
}

async function createPaymentPolicy() {
  console.log("→ Création Payment Policy...");
  const body = {
    name: "EBX Payment",
    marketplaceId: MARKETPLACE,
    categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES", default: true }],
    paymentMethods: [],
    immediatePay: true,
  };

  const { status, data } = await ebayFetch("POST", "/sell/account/v1/payment_policy", body);
  if (status === 201 || status === 200) {
    console.log("  ✅ Payment Policy ID:", data.paymentPolicyId);
    return data.paymentPolicyId;
  }

  console.log(`  ⚠️ Create failed (${status}), listing existing...`);
  const list = await ebayFetch(
    "GET",
    `/sell/account/v1/payment_policy?marketplace_id=${MARKETPLACE}`
  );
  const existing = list.data?.paymentPolicies?.[0];
  if (existing) {
    console.log("  ✅ Existing Payment Policy ID:", existing.paymentPolicyId);
    return existing.paymentPolicyId;
  }
  console.error("  ❌", JSON.stringify(data));
  return null;
}

async function createReturnPolicy() {
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

  const { status, data } = await ebayFetch("POST", "/sell/account/v1/return_policy", body);
  if (status === 201 || status === 200) {
    console.log("  ✅ Return Policy ID:", data.returnPolicyId);
    return data.returnPolicyId;
  }

  console.log(`  ⚠️ Create failed (${status}), listing existing...`);
  const list = await ebayFetch(
    "GET",
    `/sell/account/v1/return_policy?marketplace_id=${MARKETPLACE}`
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

  await optIn();
  const fulfillmentId = await createFulfillmentPolicy();
  const paymentId = await createPaymentPolicy();
  const returnId = await createReturnPolicy();

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
