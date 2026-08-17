const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  isRealEbayOrderRef,
  mergeOnboarding,
  nextOnboardingStep,
  isAutoPublishArmed,
  costForOrder,
  computePnl,
  buildWeeklyReport,
  loadOpsState,
  saveOpsState,
  DEFAULT_ONBOARDING,
} = require("./ops-engine");

let failed = 0;
function check(ok, label) {
  if (!ok) failed += 1;
  console.log(`${ok ? "OK" : "FAIL"}  ${label}`);
}

check(isRealEbayOrderRef("12-12345-67890") === true, "ref eBay réelle");
check(isRealEbayOrderRef("AO-123") === false, "ref AO- ignorée");
check(isRealEbayOrderRef("DEMO-1") === false, "ref DEMO ignorée");

const listings = [{ source_url: "https://www.amazon.fr/dp/B0TEST", cost_price: 8, suggested_price: 19.99, ebay_listing_id: "v1" }];
check(costForOrder({ source_url: "https://www.amazon.fr/dp/B0TEST", amount: 20 }, listings) === 8, "coût via listing");
check(costForOrder({ amount: 20 }, []) === 11, "coût fallback 55%");

const pnl = computePnl({
  listings,
  orders: [
    { order_ref: "12-111-222", amount: 19.99, status: "pending", source_url: "https://www.amazon.fr/dp/B0TEST" },
    { order_ref: "AO-9", amount: 99, status: "pending" },
  ],
});
check(pnl.orders === 1 && pnl.pendingOrders === 1, `pnl commandes=${pnl.orders} pending=${pnl.pendingOrders}`);
check(pnl.gmv === 19.99, `gmv=${pnl.gmv}`);
check(pnl.net < pnl.gmv && pnl.paymentNote.includes("manuel"), "net < CA + note paiement manuel");

const stored = { ...DEFAULT_ONBOARDING, contractSigned: true };
const merged = mergeOnboarding(stored, { ebayOauth: true, publishedCount: 2, savCount: 1 });
check(merged.contractSigned && merged.ebayOauth && merged.firstListing && merged.savInbox, "onboarding live merge");
check(merged.autoPublishArmed === false, "Auto-Publish ne s'arme pas tout seul");
check(isAutoPublishArmed({ onboarding: merged }) === false, "isArmed false par défaut");

const next = nextOnboardingStep(merged);
check(next.key === "policies", `prochaine étape=${next.key}`);
check(nextOnboardingStep({ ...DEFAULT_ONBOARDING, contractSigned: true, ebayOauth: true, policies: true, firstListing: true, savInbox: true, autoPublishArmed: true }).done, "onboarding done");

const report = buildWeeklyReport({
  client: { id: "acme", name: "Acme", feeEur: 1800, marketplace: "EBAY_FR" },
  listings: [
    ...listings,
    { suggested_price: 10, cost_price: 9.5, ebay_listing_id: "thin" },
  ],
  orders: [{ order_ref: "12-111-222", amount: 19.99, status: "pending", source_url: "https://www.amazon.fr/dp/B0TEST", created_at: new Date().toISOString() }],
  sav: [{ status: "new" }],
  publishLog: [],
  opsState: { onboarding: merged, feeEur: 1800 },
});
check(report.paymentNeverAutonomous === true, "rapport : paiement jamais autonome");
check(report.kpis.pendingOrders === 1 && report.kpis.unansweredSav === 1, "kpis semaine");
check(report.actions.some((a) => /sous 5 %/.test(a.text)), "alerte marge fine");
check(report.actions.some((a) => /Auto-Publish désarmé/.test(a.text)), "alerte auto-publish");

const tmp = path.join(os.tmpdir(), `baypilot-ops-${Date.now()}.json`);
saveOpsState(tmp, { onboarding: { contractSigned: true }, feeEur: 2000, notes: "ok" });
const loaded = loadOpsState(tmp);
check(loaded.onboarding.contractSigned === true && loaded.feeEur === 2000, "ops.json roundtrip");
fs.unlinkSync(tmp);

if (failed) {
  console.error(`\n${failed} échec(s)`);
  process.exit(1);
}
console.log("Tous les tests ops-engine OK");
