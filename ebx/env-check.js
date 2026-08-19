/**
 * Diagnostic .env sans afficher les secrets.
 * Usage: npm run env-check
 */
const { loadEbayEnv, cleanEnvToken, ENV_PATH, isPlaceholderEnvValue } = require("./load-env");

const info = loadEbayEnv();

function lenLine(name, value, ok) {
  const n = cleanEnvToken(value).length;
  const mark = ok ? "✅" : "❌";
  return `  ${name.padEnd(28)} ${String(n).padStart(4)} car. ${mark}`;
}

console.log("\n⚡ EBX — Diagnostic .env\n");
console.log(`Fichier : ${ENV_PATH}`);
console.log(`Existe  : ${info.exists ? "oui" : "NON"}`);
console.log(`Clés    : ${info.keys.length ? info.keys.join(", ") : "(aucune)"}`);
console.log(`EBAY_ENV effectif : ${process.env.EBAY_ENV || "(vide)"}`);
console.log(`API     : ${process.env.EBAY_API_BASE || "(défaut)"}`);

const cid = cleanEnvToken(process.env.EBAY_CLIENT_ID);
const secret = cleanEnvToken(process.env.EBAY_CLIENT_SECRET);
const prodId = cleanEnvToken(process.env.EBAY_PROD_CLIENT_ID);
const prodSecret = cleanEnvToken(process.env.EBAY_PROD_CLIENT_SECRET);
const refresh = cleanEnvToken(process.env.EBAY_REFRESH_TOKEN);
const refreshProd = cleanEnvToken(process.env.EBAY_REFRESH_TOKEN_PROD);
const ru = cleanEnvToken(process.env.EBAY_RU_NAME);
const user = cleanEnvToken(process.env.EBAY_USER_TOKEN);
const prodReady = !isPlaceholderEnvValue(prodId) && !isPlaceholderEnvValue(prodSecret);

console.log("\n— Longueurs (pas les valeurs) —");
console.log(lenLine("EBAY_PROD_CLIENT_ID", prodId, prodId.length > 10 && !isPlaceholderEnvValue(prodId)));
console.log(lenLine("EBAY_PROD_CLIENT_SECRET", prodSecret, prodSecret.length > 10 && !isPlaceholderEnvValue(prodSecret)));
console.log(lenLine("EBAY_CLIENT_ID", cid, cid.length > 10 && !isPlaceholderEnvValue(cid)));
console.log(lenLine("EBAY_CLIENT_SECRET", secret, secret.length > 10 && !isPlaceholderEnvValue(secret)));
console.log(lenLine("EBAY_RU_NAME", ru, ru.length > 5));
console.log(lenLine("EBAY_REFRESH_TOKEN_PROD", refreshProd, refreshProd.length >= 40));
console.log(lenLine("EBAY_REFRESH_TOKEN", refresh, refresh.length >= 40));
if ((refreshProd.length > 0 && refreshProd.length < 150) || (refresh.length > 0 && refresh.length < 150)) {
  console.log("  ⚠️  Refresh court (<150) — souvent scopes incomplets → reconnecte eBay");
}
console.log(
  `  EBAY_USER_TOKEN             : ${user.length} car. ${user.length === 0 ? "✅ (vide OK)" : user.length >= 80 ? "fallback OK" : "⚠️ court"}`
);
const pol =
  (process.env.EBAY_FULFILLMENT_POLICY_ID_PROD || process.env.EBAY_FULFILLMENT_POLICY_ID) &&
  (process.env.EBAY_PAYMENT_POLICY_ID_PROD || process.env.EBAY_PAYMENT_POLICY_ID) &&
  (process.env.EBAY_RETURN_POLICY_ID_PROD || process.env.EBAY_RETURN_POLICY_ID);
console.log(`  Policies fulfill/pay/return : ${pol ? "✅" : "⚠️"}`);

if (info.issues.length) {
  console.log("\n— Problèmes —");
  for (const issue of info.issues) console.log(`  ❌ ${issue}`);
}

if (!prodReady && isPlaceholderEnvValue(cid)) {
  console.log(`
❌ Clés encore en placeholder (.env.example).
   Sur le VPS, n'utilise PAS nano (SSH coupe souvent). Colle un heredoc :

   cd /var/www/ebx/ebx
   cp -a .env .env.bak
   cat > .env << 'ENVEOF'
   ...tes clés...
   ENVEOF
   pm2 restart ebx --update-env
   npm run env-check
`);
}

console.log(`
Si REFRESH = 0 car. :
  1. Le fichier doit s'appeler exactement .env dans ${require("path").dirname(ENV_PATH)}
  2. Ligne : EBAY_REFRESH_TOKEN_PROD="v^1.1#...."   (guillemets droits, le # est obligatoire)
  3. Puis : pm2 restart ebx --update-env
`);
