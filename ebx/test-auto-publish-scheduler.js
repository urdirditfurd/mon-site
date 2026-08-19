/**
 * Scheduler Auto-Publish : boucle 20s jusqu’à 200/jour, puis pause 10 min.
 */
const {
  loopDelayMs,
  DAILY_PUBLISH_TARGET,
  LOOP_MS,
  REST_MS,
  nextLoopMarket,
  AUTO_PUBLISH_MARKETS,
} = require("./auto-publish-engine");

let failed = 0;
function check(ok, label) {
  if (!ok) failed += 1;
  console.log(`${ok ? "OK" : "FAIL"}  ${label}`);
}

check(DAILY_PUBLISH_TARGET === 200, `objectif journalier ${DAILY_PUBLISH_TARGET}`);
check(LOOP_MS === 20_000, `boucle ${LOOP_MS}ms`);
check(REST_MS === 10 * 60 * 1000, "pause quota = 10 min");
check(loopDelayMs(0) === LOOP_MS, "0 publié → boucle 20s");
check(loopDelayMs(199) === LOOP_MS, "199 publié → encore boucle");
check(loopDelayMs(200) === REST_MS, "200 publié → pause");
check(loopDelayMs(250) === REST_MS, "au-delà du quota → pause");

const m0 = nextLoopMarket(0);
const m1 = nextLoopMarket(m0.nextIndex);
const m2 = nextLoopMarket(m1.nextIndex);
const m3 = nextLoopMarket(m2.nextIndex);
const m4 = nextLoopMarket(m3.nextIndex);
check(m0.marketplace === "France", `marché 0 ${m0.marketplace}`);
check(m1.marketplace === "Germany", `marché 1 ${m1.marketplace}`);
check(m2.marketplace === "United Kingdom", `marché 2 ${m2.marketplace}`);
check(m3.marketplace === "United States", `marché 3 ${m3.marketplace}`);
check(m4.marketplace === "France", "rotation revient à FR");
check(AUTO_PUBLISH_MARKETS.length === 4, "4 marchés");

if (failed) {
  console.error(`\n${failed} échec(s)`);
  process.exit(1);
}
console.log("Tous les tests scheduler boucle 200/jour OK");
