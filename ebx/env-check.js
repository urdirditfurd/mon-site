/**
 * Diagnostic .env sans afficher les secrets.
 * Usage: npm run env-check
 */
const { loadEbayEnv, cleanEnvToken, ENV_PATH } = require("./load-env");

const info = loadEbayEnv();

console.log("\n⚡ EBX — Diagnostic .env\n");
console.log(`Fichier : ${ENV_PATH}`);
console.log(`Existe  : ${info.exists ? "oui" : "NON"}`);
console.log(`Clés    : ${info.keys.length ? info.keys.join(", ") : "(aucune)"}`);

const refresh = cleanEnvToken(process.env.EBAY_REFRESH_TOKEN);
const user = cleanEnvToken(process.env.EBAY_USER_TOKEN);
const cid = String(process.env.EBAY_CLIENT_ID || "").trim();
const secret = String(process.env.EBAY_CLIENT_SECRET || "").trim();
const ru = String(process.env.EBAY_RU_NAME || "").trim();

console.log("\n— Longueurs (pas les valeurs) —");
console.log(`  EBAY_CLIENT_ID      : ${cid.length} car. ${cid.length > 10 ? "✅" : "❌"}`);
console.log(`  EBAY_CLIENT_SECRET  : ${secret.length} car. ${secret.length > 10 ? "✅" : "❌"}`);
console.log(`  EBAY_RU_NAME        : ${ru.length} car. ${ru.length > 5 ? "✅" : "⚠️"}`);
  console.log(`  EBAY_REFRESH_TOKEN  : ${refresh.length} car. ${refresh.length >= 40 ? "✅" : "❌"}`);
  if (refresh.length > 0 && refresh.length < 150) {
    console.log("  ⚠️  Refresh court (<150) — souvent scopes incomplets → npm run oauth");
  }
console.log(`  EBAY_USER_TOKEN     : ${user.length} car. ${user.length === 0 ? "✅ (vide OK)" : user.length >= 80 ? "fallback OK" : "⚠️ court"}`);
console.log(`  Policies fulfill/pay/return : ${
  process.env.EBAY_FULFILLMENT_POLICY_ID && process.env.EBAY_PAYMENT_POLICY_ID && process.env.EBAY_RETURN_POLICY_ID
    ? "✅"
    : "⚠️"
}`);

if (info.issues.length) {
  console.log("\n— Problèmes —");
  for (const issue of info.issues) console.log(`  ❌ ${issue}`);
}

console.log(`
Si REFRESH = 0 car. :
  1. Le fichier doit s'appeler exactement .env (pas .env.txt) dans ce dossier
  2. Ligne exacte : EBAY_REFRESH_TOKEN="v^1.1#...."   (guillemets droits ")
  3. Dans PowerShell pour vérifier le nom :
       Get-ChildItem -Force | Where-Object Name -eq '.env'
`);
