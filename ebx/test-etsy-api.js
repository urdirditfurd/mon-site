/**
 * Tests unitaires Etsy (sans réseau).
 */
const {
  createPkcePair,
  etsyPriceCents,
  htmlToPlainText,
  isEtsyConfigured,
  ETSY_SCOPES,
} = require("./etsy-api");

let failed = 0;
function check(ok, label) {
  if (!ok) failed += 1;
  console.log(`${ok ? "OK" : "FAIL"}  ${label}`);
}

const pkce = createPkcePair();
check(pkce.verifier.length >= 43 && pkce.challenge.length >= 40, "PKCE verifier/challenge");
check(pkce.verifier !== pkce.challenge, "PKCE challenge ≠ verifier");

check(etsyPriceCents(11.87) === "1187", "prix 11.87 → 1187 centimes");
check(etsyPriceCents("9.99") === "999", "prix string 9.99");

const plain = htmlToPlainText("<p>Hello <b>world</b></p><script>x()</script>");
check(plain === "Hello world", `html→text « ${plain} »`);

check(/listings_w/.test(ETSY_SCOPES) && /shops_r/.test(ETSY_SCOPES), "scopes listings+shops");

// Sans .env Etsy → non configuré
check(typeof isEtsyConfigured() === "boolean", "isEtsyConfigured boolean");

if (failed) {
  console.error(`\n${failed} échec(s) etsy-api`);
  process.exit(1);
}
console.log("\nTous les tests Etsy API (unitaires) OK");
