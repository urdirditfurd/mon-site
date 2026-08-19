const {
  keywordFromTitle,
  buildDemandKeywords,
  nextDemandSlice,
  pickMostProfitableOffer,
  rankOffersByProfit,
  isSupplierUrl,
  competitorMarketPrices,
  titleOverlapsQuery,
  explainUnprofitable,
  rollPipelineDay,
  languageForMarket,
  sniperQueryVariants,
  loopDelayMs,
  isFatalListingError,
  DAILY_PUBLISH_TARGET,
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
    !demand.some((d) => /deco ete|bagages/i.test(d.query)) &&
    !demand.some((d) => String(d.query).split(/\s+/).length < 2),
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

const mixedEbay = competitorMarketPrices(
  [
    { title: "Crochet pantalon vintage", price: 2.99, condition: "Used" },
    { title: "Lot 24 crochets muraux adhésifs", price: 8.5, condition: "New" },
    { title: "Crochet mural adhésif 10 pcs neuf", price: 9.2, condition: "New" },
    { title: "Serviette de bain", price: 3.5, condition: "New" },
  ],
  "crochet mural adhésif"
);
check(
  mixedEbay[0] >= 8 && mixedEbay.every((p) => p >= 8),
  `concurrents filtrés (neuf + même produit) → ${mixedEbay.join(", ")}`
);

const amazonCrochet = [
  { title: "24 crochets", url: "https://www.amazon.fr/dp/B0F5WWWZC8", price: 5.57, source: "amazon" },
];
const dumped = pickMostProfitableOffer(amazonCrochet, [2.99, 3.1, 8.5, 9.2, 10], 5);
check(
  dumped && dumped.profitable && dumped.priced.sell >= dumped.priced.minSell,
  `dump eBay ignoré, Amazon 5.57€ accepté → sell=${dumped ? dumped.priced.sell : "null"} competitive=${dumped && dumped.priced.competitive}`
);

check(titleOverlapsQuery("Lot 24 crochets muraux adhésifs", "crochet mural adhésif"), "titre concurrent proche OK");
check(!titleOverlapsQuery("Serviette de bain coton", "crochet mural adhésif"), "titre hors sujet rejeté");

const tight = pickMostProfitableOffer(amazonCrochet, [3.2, 3.4, 3.5], 5);
check(tight == null, "marché neuf plus bas que le plancher 5% → rejeté");

check(isSupplierUrl("https://www.amazon.fr/Nom-Produit/dp/B0DSHZXYY2"), "URL Amazon /titre/dp OK");

const scrubbed = require("./auto-publish-engine").snipableDemandQuery("pinceaux maquillage pro krystalparis");
check(
  /pinceaux/.test(scrubbed) && /maquillage/.test(scrubbed) && !/krystal/i.test(scrubbed),
  `snipable sans marque → "${scrubbed}"`
);
check(
  !buildDemandKeywords({ trendItems: [{ title: "Pinceaux maquillage Krystalparis", sold: 10, price: 9 }], seeds: [], limit: 10 }).some((d) =>
    /krystal/i.test(d.query)
  ),
  "titre tendance sans marque vendeur"
);

const edge = competitiveSellPrice({ cost: 5.99, competitorPrices: [], minNetPct: 5 });
check(edge.profitable && edge.netPct >= 4.8, `tolérance net ~5% → ${edge.netPct}% sell=${edge.sell}`);

const variants = sniperQueryVariants("eponge maquillage blender");
check(
  variants.some((v) => /sponge makeup/i.test(v)) && variants.some((v) => v === "eponge maquillage"),
  `variantes sniper → ${variants.join(" | ")}`
);
check(isFatalListingError("Impossible d'extraire le produit (aliexpress) — essayez une autre URL"), "erreur extrait = fatale");
check(!isFatalListingError("Accès refusé eBay (scope manquant)"), "erreur OAuth pas fatale");
check(DAILY_PUBLISH_TARGET === 200, "quota 200/jour");
check(loopDelayMs(10) < loopDelayMs(200), "boucle plus courte que la pause quota");

const dayKeep = rollPipelineDay(
  { day: "2026-08-18", marketplace: "France", publishedToday: 42, keywords: [{ query: "x" }], algo: 5 },
  "Germany",
  new Date("2026-08-18T12:00:00Z")
);
check(
  dayKeep.publishedToday === 42 && dayKeep.marketplace === "Germany" && (dayKeep.keywords || []).length === 0,
  "changement de marché le même jour : conserve le compteur, recharge les mots-clés"
);

if (failed) {
  console.error(`\n${failed} échec(s) auto-publish engine`);
  process.exit(1);
}
console.log("\nTous les tests Auto-Publish engine OK");
