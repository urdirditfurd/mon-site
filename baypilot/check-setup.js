/**
 * Vérifie la config locale EBX (.env) sans afficher les secrets.
 * Usage: node check-setup.js
 */
const { loadEbayEnv } = require("./load-env");
loadEbayEnv();

const { getAppToken, browseSearch } = require("./ebay-browse");

function present(v) {
  return Boolean(v && String(v).trim() && !String(v).includes("your_"));
}

function mask(v) {
  if (!present(v)) return "—";
  const s = String(v);
  if (s.length <= 8) return "***";
  return s.slice(0, 4) + "…" + s.slice(-4);
}

async function main() {
  console.log("\n⚡ BayPilot — Vérification setup local\n");

  const checks = [
    ["EBAY_PROD_CLIENT_ID", present(process.env.EBAY_PROD_CLIENT_ID), mask(process.env.EBAY_PROD_CLIENT_ID)],
    ["EBAY_PROD_CLIENT_SECRET", present(process.env.EBAY_PROD_CLIENT_SECRET), mask(process.env.EBAY_PROD_CLIENT_SECRET)],
    ["EBAY_CLIENT_ID (Sandbox)", present(process.env.EBAY_CLIENT_ID), mask(process.env.EBAY_CLIENT_ID)],
    ["EBAY_CLIENT_SECRET (Sandbox)", present(process.env.EBAY_CLIENT_SECRET), mask(process.env.EBAY_CLIENT_SECRET)],
    ["EBAY_RU_NAME", present(process.env.EBAY_RU_NAME), mask(process.env.EBAY_RU_NAME)],
    ["EBAY_REFRESH_TOKEN (~18 mois)", present(process.env.EBAY_REFRESH_TOKEN), mask(process.env.EBAY_REFRESH_TOKEN)],
    ["EBAY_USER_TOKEN (~2h)", present(process.env.EBAY_USER_TOKEN), mask(process.env.EBAY_USER_TOKEN)],
    ["Policies (fulfill/pay/return)", present(process.env.EBAY_FULFILLMENT_POLICY_ID) && present(process.env.EBAY_PAYMENT_POLICY_ID) && present(process.env.EBAY_RETURN_POLICY_ID), "ok / manquant"],
    ["LOCAL_LLM_URL", true, process.env.LOCAL_LLM_URL || "http://localhost:1234/v1"],
  ];

  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? "✅" : "❌"} ${name.padEnd(32)} ${detail}`);
  }

  console.log("\n— Test Browse API Production —");
  try {
    await getAppToken({ production: true });
    console.log("✅ OAuth Production OK");
    const r = await browseSearch("colle b7000", { marketplace: "FR", limit: 3 });
    console.log(`✅ Recherche live OK — ${r.items.length} annonces (${r.api})`);
    if (r.items[0]) console.log(`   ex: ${r.items[0].title.slice(0, 70)}`);
  } catch (err) {
    console.log(`❌ Browse API: ${err.message}`);
    console.log("   → Vérifie EBAY_PROD_CLIENT_ID / SECRET (Production, guillemets si #)");
  }

  console.log("\n— Test LLM local (optionnel) —");
  try {
    const base = process.env.LOCAL_LLM_URL || "http://localhost:1234/v1";
    const res = await fetch(base.replace(/\/v1\/?$/, "/v1/models"));
    if (res.ok) console.log("✅ LM Studio / LLM joignable");
    else console.log(`⚠️  LLM répond HTTP ${res.status}`);
  } catch {
    console.log("⚠️  LLM non disponible (lance LM Studio si tu veux l’IA descriptions)");
  }

  console.log("\nEnsuite: node server.js → http://localhost:3101  (opérateur: npm run ops → :3100)\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
