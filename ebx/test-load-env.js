const { parseLine, applyProdFallbacks, cleanEnvToken, isPlaceholderEnvValue } = require("./load-env");

let failed = 0;
function check(ok, label) {
  if (!ok) failed += 1;
  console.log(`${ok ? "OK" : "FAIL"}  ${label}`);
}

const tokenLine = parseLine(
  'EBAY_REFRESH_TOKEN_PROD="v^1.1#i^1#I^3#r^1#p^3#f^0#t^Ul4xMF8TEST"'
);
check(tokenLine && tokenLine.value.includes("#") && tokenLine.value.length > 20, "token avec # conservé entre guillemets");

const noQuote = parseLine("EBAY_REFRESH_TOKEN_PROD=v^1.1#i^1#t^ABC");
check(noQuote && noQuote.value.includes("#i^1"), "sans espace avant # le token n'est pas coupé");

check(cleanEnvToken('"abc"') === "abc", "cleanEnvToken quotes");
check(isPlaceholderEnvValue("your_sandbox_app_id"), "placeholder sandbox id");
check(isPlaceholderEnvValue(""), "vide = placeholder");
check(!isPlaceholderEnvValue("Urdirdit-EBX-PRD-aaaaaaaa"), "vrai client id n'est pas placeholder");

const KEYS = [
  "EBAY_ENV",
  "EBAY_API_BASE",
  "EBAY_AUTH_URL",
  "EBAY_PROD_CLIENT_ID",
  "EBAY_PROD_CLIENT_SECRET",
  "EBAY_REFRESH_TOKEN_PROD",
  "EBAY_REFRESH_TOKEN_SANDBOX",
  "EBAY_CLIENT_ID",
  "EBAY_CLIENT_SECRET",
  "EBAY_REFRESH_TOKEN",
  "EBAY_RU_NAME",
  "EBAY_RU_NAME_PROD",
  "EBAY_FULFILLMENT_POLICY_ID",
  "EBAY_FULFILLMENT_POLICY_ID_PROD",
];

function withEnv(patch, fn) {
  const snapshot = {};
  for (const k of KEYS) snapshot[k] = process.env[k];
  try {
    for (const k of KEYS) delete process.env[k];
    Object.assign(process.env, patch);
    fn();
  } finally {
    for (const k of KEYS) {
      if (snapshot[k] === undefined) delete process.env[k];
      else process.env[k] = snapshot[k];
    }
  }
}

withEnv(
  {
    EBAY_ENV: "sandbox",
    EBAY_API_BASE: "https://api.sandbox.ebay.com",
    EBAY_CLIENT_ID: "your_sandbox_app_id",
    EBAY_CLIENT_SECRET: "your_sandbox_cert_id",
    EBAY_REFRESH_TOKEN: "",
    EBAY_PROD_CLIENT_ID: "evamorea-fi-PRD-test-id-long",
    EBAY_PROD_CLIENT_SECRET: "PRD-secret-long-enough",
    EBAY_REFRESH_TOKEN_PROD: "x".repeat(50),
    EBAY_RU_NAME_PROD: "EBX_VPS_PROD",
    EBAY_FULFILLMENT_POLICY_ID_PROD: "419424394022",
  },
  () => {
    const issues = { issues: [] };
    applyProdFallbacks(issues);
    check(process.env.EBAY_ENV === "production", `ENV forcé production → ${process.env.EBAY_ENV}`);
    check(process.env.EBAY_CLIENT_ID === "evamorea-fi-PRD-test-id-long", "CLIENT_ID recopié depuis PROD");
    check(process.env.EBAY_CLIENT_SECRET === "PRD-secret-long-enough", "SECRET recopié (placeholder sandbox)");
    check(process.env.EBAY_REFRESH_TOKEN.length === 50, "refresh générique recopié depuis *_PROD");
    check(process.env.EBAY_RU_NAME === "EBX_VPS_PROD", "RuName prod recopié");
    check(process.env.EBAY_FULFILLMENT_POLICY_ID === "419424394022", "policy prod recopiée");
    check(!/sandbox/i.test(process.env.EBAY_API_BASE), `API_BASE prod → ${process.env.EBAY_API_BASE}`);
    check(
      issues.issues.some((i) => /production/i.test(i)),
      "issue explicite de bascule production"
    );
  }
);

withEnv(
  {
    EBAY_ENV: "production",
    EBAY_REFRESH_TOKEN: "y".repeat(60),
    EBAY_REFRESH_TOKEN_PROD: "",
    EBAY_PROD_CLIENT_ID: "prod-client-id-ok",
    EBAY_PROD_CLIENT_SECRET: "prod-secret-ok",
  },
  () => {
    applyProdFallbacks({ issues: [] });
    check(process.env.EBAY_REFRESH_TOKEN_PROD.length === 60, "refresh générique recopié vers *_PROD");
  }
);

const { browserLaunchCandidates } = require("./scraper");
const candidates = browserLaunchCandidates();
check(Array.isArray(candidates) && candidates.length >= 1, "browserLaunchCandidates non vide");
check(
  candidates.some((c) => c.channel === "chrome" || c.channel === "chromium" || c.executablePath),
  "candidats chrome/chromium présents"
);

if (failed) {
  console.error(`\n${failed} échec(s)`);
  process.exit(1);
}
console.log("Tous les tests load-env OK");
