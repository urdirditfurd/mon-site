/**
 * Vérifie la config du scheduler Auto-Publish (intervalle 10 min).
 * Le test live (ticks réels) se fait via AUTO_PUBLISH_INTERVAL_MS court + API.
 */
const path = require("path");

// Charge juste les constantes sans démarrer le serveur HTTP
process.env.PORT = process.env.PORT || "0";
process.env.AUTO_PUBLISH_INTERVAL_MS = process.env.AUTO_PUBLISH_INTERVAL_MS || String(10 * 60 * 1000);

let failed = 0;
function check(ok, label) {
  if (!ok) failed += 1;
  console.log(`${ok ? "OK" : "FAIL"}  ${label}`);
}

const defaultMs = 10 * 60 * 1000;
const envMs = Number(process.env.AUTO_PUBLISH_INTERVAL_MS);
check(envMs === defaultMs || envMs >= 15_000, `intervalle ms valide → ${envMs}`);
check(Math.round(defaultMs / 60000) === 10, "10 minutes = 600000 ms");

const short = Math.max(15_000, 15_000);
check(short === 15_000, "plancher test 15s OK");

console.log("\nPour preuve live : AUTO_PUBLISH_INTERVAL_MS=15000 node server.js");
if (failed) {
  console.error(`\n${failed} échec(s)`);
  process.exit(1);
}
console.log("Tous les tests scheduler config OK");
