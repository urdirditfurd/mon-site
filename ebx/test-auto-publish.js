const {
  keywordFromTitle,
  buildDemandKeywords,
  nextDemandSlice,
  pickMostProfitableOffer,
  rankOffersByProfit,
  isSupplierUrl,
  rollPipelineDay,
  languageForMarket,
} = require("./auto-publish-engine");
const { competitiveSellPrice } = require("./business-engine");

let failed = 0;
function check(ok, label) {
  if (!ok) failed += 1;
  console.log(`${ok ? "OK" : "FAIL"}  ${label}`);
}

check(keywordFromTitle("4/6/10 Pièces Poncho de Pluie Adulte, cape transparente") === "poncho pluie adulte cape",
  `keywordFromTitle → "${keywordFromTitle("4/6/10 Pièces Poncho de Pluie Adulte, cape transparente")}"`);

const demand = buildDemandKeywords({
  trendItems: [
    { title: "Poncho de pluie adulte EVA", seed: "poncho pluie", sold: 40, price: 9.99 },
    { title: "Nike Air Max 90", seed: "nike air max", sold: 200, price: 120 },
    { title: "Éponge maquillage blender", seed: "eponge maquillage", sold: 80, price: 4.5 },
  ],
  seeds: ["chargeur gan usb-c 65w"],
  calendarEvents: [{ phase: "prep", niche: "Voyage / Maison", tip: "Bagages, plage, déco été" }],
  limit: 20,
});
check(
  demand[0] && /chargeur|gan/i.test(demand[0].query) &&
    demand.some((d) => /poncho/i.test(d.query)) &&
    demand.some((d) => /eponge|maquillage/i.test(d.query)) &&
    !demand.some((d) => /nike/i.test(d.query)) &&
    !demand.some((d) => /Voyage/i.test(d.query)) &&
    !demand.some((d) => String(d.query).split(/\s+/).length < 2) &&
    !demand.some((d) => /^bagages$/i.test(d.query)),
  `demand keywords (seeds d'abord, sans VeRO / catégories / 1 mot) → ${demand.map((d) => d.query).join(" | ")}`
);

const crowded = buildDemandKeywords({
  trendItems: Array.from({ length: 40 }, (_, i) => ({
    title: `lampe chevet tactile modele ${i}`,
    sold: 10,
    price: 12,
  })),
  seeds: ["crochet mural adhesif"],
  limit: 8,
});
check(
  crowded.some((d) => /crochet/i.test(d.query)),
  "seeds toujours présents même si les tendances saturent la limite"
);

const slice1 = nextDemandSlice(demand, 0, 2);
const slice2 = nextDemandSlice(demand, slice1.cursor, 2);
check(slice1.items.length === 2 && slice2.items[0].query !== slice1.items[0].query, "rotation curseur demande");

const offers = [
  { title: "Poncho Ali", url: "https://fr.aliexpress.com/item/1005012141738065.html", price: 4.2, source: "aliexpress" },
  { title: "Poncho Amazon", url: "https://www.amazon.fr/dp/B0DSHZXYY2", price: 7.99, source: "amazon" },
  { title: "Poncho cher", url: "https://www.cdiscount.com/x/poncho.html", price: 40, source: "cdiscount" },
];
const competitors = [12, 13.5, 11.9];
const best = pickMostProfitableOffer(offers, competitors, 5);
check(
  best && best.offer.source === "aliexpress" && best.priced.profitable && best.priced.sell >= best.priced.minSell,
  `meilleure offre rentable → ${best ? `${best.offer.source} sell=${best.priced.sell} net=${best.netPct}%` : "null"}`
);

const unprofitable = pickMostProfitableOffer(
  [{ title: "Cher", url: "https://www.amazon.fr/dp/B0AAAAAAAA", price: 50, source: "amazon" }],
  [8, 8.5],
  5
);
check(unprofitable == null, "offre trop chère vs concurrent → rejetée (net < 5%)");

const ranked = rankOffersByProfit(offers, competitors, 5);
check(ranked[0].offer.price <= ranked[1].offer.price || ranked[0].netAmount >= ranked[1].netAmount, "tri par netAmount");

check(isSupplierUrl("https://fr.aliexpress.com/item/1005012141738065.html"), "URL Ali fiche OK");
check(!isSupplierUrl("https://www.ebay.fr/itm/123"), "URL eBay rejetée");
check(!isSupplierUrl("https://fr.aliexpress.com/w/wholesale-poncho.html"), "wholesale rejeté");

const rolled = rollPipelineDay({ day: "2020-01-01", preparedToday: 9, marketplace: "France" }, "France", new Date("2026-08-14T12:00:00Z"));
check(rolled.day === "2026-08-14" && rolled.preparedToday === 0, "reset compteurs chaque jour");

check(languageForMarket("France") === "fr" && languageForMarket("DE") === "de" && languageForMarket("US") === "en", "langue marché");

const floor = competitiveSellPrice({ cost: 10, competitorPrices: [8], minNetPct: 5 });
check(floor.sell >= floor.minSell && !((8 * 0.99) >= floor.minSell && floor.sell < floor.minSell), "plancher 5% jamais cassé");

if (failed) {
  console.error(`\n${failed} échec(s) auto-publish engine`);
  process.exit(1);
}
console.log("\nTous les tests Auto-Publish engine OK");
