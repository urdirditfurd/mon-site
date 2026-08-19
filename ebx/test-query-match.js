const {
  titleMatchesQuery,
  rankSupplierOffers,
  isPlaceholderSupplierTitle,
  normalizeAliExpressEuroPrice,
  sanitizeAliExpressPrice,
  aliMoneyToEur,
  pickPlausibleAliEuro,
} = require("./scraper");

const cases = [
  ["poncho", "Poncho imperméable épais, résistant au vent, pour homme et femme", true],
  ["poncho", "4/6/10 Pièces Poncho de Pluie Adulte, cape de pluie", true],
  ["poncho", "Garde-boue avant en fibre de carbone pour moto DUCATI Panigale V2", false],
  ["poncho", "flintronic", false],
  ["poncho", "Pull Luxe Femme Plaid Laine", false],
  ["poncho", "Couverture Portable avec Oreiller Intégré", false],
  ["poncho", "Imperméable intégral épais en Oxford, poncho de pluie ample", true],
  ["poncho", "poncho — AliExpress", false],
  ["poncho", "poncho", false],
  ["poncho", "Nu-June Poncho de surf dégradé pour femme", true],
  ["poncho", "Vente Flash : Imperméable Transparent Réutilisable pour Homme et Femme – Poncho Épais", true],
  ["éponge maquillage", "Eponge maquillage 12 pcs", true],
  ["éponge maquillage", "Eponge cuisine microfibre", false],
  ["cape pluie", "Cape de pluie adulte EVA", true],
];

let failed = 0;
for (const [q, title, expected] of cases) {
  const got = titleMatchesQuery(title, q);
  const ok = got === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? "OK" : "FAIL"}  q="${q}" | "${title.slice(0, 50)}" → ${got} (attendu ${expected})`);
}

const placeholderOk = isPlaceholderSupplierTitle("poncho — AliExpress", "poncho") === true;
console.log(`${placeholderOk ? "OK" : "FAIL"}  placeholder "poncho — AliExpress"`);
if (!placeholderOk) failed += 1;

const priceCases = [
  [3.69, 3.69],
  [7.99, 7.99],
  [21.47, 2.73],
  [2125.85, 2.7],
  [2147.33, 2.73],
  [0, null],
];
for (const [raw, expected] of priceCases) {
  const got = aliMoneyToEur(raw);
  const ok =
    expected == null ? got == null : got != null && Math.abs(got - expected) < 0.05;
  if (!ok) failed += 1;
  console.log(`${ok ? "OK" : "FAIL"}  aliMoney ${raw} → ${got} (attendu ${expected})`);
}

const eurFmt = aliMoneyToEur(null, "", "€ 2,47");
const eurFmtOk = eurFmt != null && Math.abs(eurFmt - 2.47) < 0.02;
console.log(`${eurFmtOk ? "OK" : "FAIL"}  formatted € 2,47 → ${eurFmt}`);
if (!eurFmtOk) failed += 1;

const cnyOk = Math.abs(aliMoneyToEur(21.47, "CNY") - 2.73) < 0.05;
console.log(`${cnyOk ? "OK" : "FAIL"}  21.47 CNY → ${aliMoneyToEur(21.47, "CNY")}`);
if (!cnyOk) failed += 1;

const oneEuro = aliMoneyToEur(1, "EUR");
const oneEuroOk = oneEuro == null;
console.log(`${oneEuroOk ? "OK" : "FAIL"}  1.00 EUR rejeté → ${oneEuro}`);
if (!oneEuroOk) failed += 1;

const cluster = pickPlausibleAliEuro([1, 1, 1, 46.19]);
const clusterOk = cluster != null && Math.abs(cluster - 46.19) < 0.02;
console.log(`${clusterOk ? "OK" : "FAIL"}  ignore 1€ leurre, garde 46.19 → ${cluster}`);
if (!clusterOk) failed += 1;

const clusterEmpty = pickPlausibleAliEuro([1, 1, 0.99]);
const clusterEmptyOk = clusterEmpty == null;
console.log(`${clusterEmptyOk ? "OK" : "FAIL"}  seulement des 1€ → ${clusterEmpty}`);
if (!clusterEmptyOk) failed += 1;

const raw = [
  {
    title: "Vente Flash : Imperméable Transparent – Poncho Épais Portable",
    url: "https://fr.aliexpress.com/item/1005011863385361.html",
    price: 2125.85,
    source: "aliexpress",
  },
  {
    title: "Imperméable unisexe avec sac, poncho de pluie léger",
    url: "https://fr.aliexpress.com/item/1005012897292167.html",
    price: 2147.33,
    source: "aliexpress",
  },
  {
    title: "4/6/10 Pièces Poncho de Pluie Adulte, cape de pluie transparent",
    url: "https://www.amazon.fr/dp/B0DSHZXYY2",
    price: 7.99,
    source: "amazon",
  },
  {
    title: "Poncho Pluie Imperméable avec Sac de Rangement",
    url: "https://www.amazon.fr/dp/B0FFN39LN2",
    price: 11.99,
    source: "amazon",
  },
  {
    title: "Poncho camping Cdiscount",
    url: "https://www.cdiscount.com/sports/poncho.html",
    price: 9.99,
    source: "cdiscount",
  },
  {
    title: "Garde-boue avant en fibre de carbone pour moto DUCATI",
    url: "https://fr.aliexpress.com/item/4.html",
    price: 151.99,
    source: "aliexpress",
  },
];

const top = rankSupplierOffers(raw, "poncho", { limit: 3 });
const topOk =
  top.length === 3 &&
  top.every((p) => p.price < 50) &&
  top.some((p) => /amazon/i.test(p.source)) &&
  top.some((p) => /aliexpress/i.test(p.source)) &&
  !top.some((p) => p.price > 100);
console.log(
  `${topOk ? "OK" : "FAIL"}  top3 diversity=${top.map((p) => `${p.source}:${p.price}€`).join(" | ")} (${top.length})`
);
if (!topOk) {
  failed += 1;
  console.log("  got", top.map((p) => ({ price: p.price, source: p.source, title: String(p.title).slice(0, 40) })));
}

const crowded = [
  {
    title: "Poncho Amazon A",
    url: "https://www.amazon.fr/dp/B0AAAAAAA1",
    price: 5.99,
    source: "amazon",
  },
  {
    title: "Poncho Amazon B",
    url: "https://www.amazon.fr/dp/B0AAAAAAA2",
    price: 6.49,
    source: "amazon",
  },
  {
    title: "Poncho Amazon C",
    url: "https://www.amazon.fr/dp/B0AAAAAAA3",
    price: 6.99,
    source: "amazon",
  },
  {
    title: "Poncho AliExpress épais",
    url: "https://fr.aliexpress.com/item/1005011863385361.html",
    price: 21.26,
    source: "aliexpress",
  },
  {
    title: "Poncho Cdiscount camping",
    url: "https://www.cdiscount.com/sports/poncho-cd.html",
    price: 12.5,
    source: "cdiscount",
  },
];
const mixed = rankSupplierOffers(crowded, "poncho", { limit: 3 });
const mixedSrc = mixed.map((p) => p.source).sort().join(",");
const mixedOk =
  mixed.length === 3 &&
  mixedSrc === "aliexpress,amazon,cdiscount" &&
  mixed.find((p) => p.source === "amazon").price === 5.99;
console.log(`${mixedOk ? "OK" : "FAIL"}  1 par site malgré 3 Amazon moins chers → ${mixed.map((p) => `${p.source}:${p.price}`).join(" | ")}`);
if (!mixedOk) failed += 1;

const decoyRank = rankSupplierOffers(
  [
    {
      title: "Poncho de plage femme dégradé, sec rapide, microfibre",
      url: "https://fr.aliexpress.com/item/1005012141738065.html",
      price: 1,
      source: "aliexpress",
    },
    {
      title: "4/6/10 Pièces Poncho de Pluie Adulte, cape de pluie transparent",
      url: "https://www.amazon.fr/dp/B0DSHZXYY2",
      price: 7.99,
      source: "amazon",
    },
  ],
  "poncho",
  { limit: 3 }
);
const decoyOk = decoyRank.every((p) => Number(p.price) >= 1.99) && !decoyRank.some((p) => Number(p.price) === 1);
console.log(`${decoyOk ? "OK" : "FAIL"}  1,00 € Ali rejeté dans le ranking (${decoyRank.map((p) => p.price).join(", ")})`);
if (!decoyOk) failed += 1;

const { competitiveSellPrice } = require("./business-engine");
const priced = competitiveSellPrice({ cost: 4, competitorPrices: [12, 14, 11], minNetPct: 5 });
const pricedOk = priced.sell >= priced.minSell && priced.sell <= 12 && priced.profitable;
console.log(`${pricedOk ? "OK" : "FAIL"}  auto-publish prix ${JSON.stringify(priced)}`);
if (!pricedOk) failed += 1;
const floor = competitiveSellPrice({ cost: 10, competitorPrices: [8, 8.5], minNetPct: 5 });
const floorOk = floor.sell >= floor.minSell && floor.sell > 8;
console.log(`${floorOk ? "OK" : "FAIL"}  plancher 5% ${floor.sell} (min ${floor.minSell}) vs concurrent 8`);
if (!floorOk) failed += 1;

const noComp = competitiveSellPrice({ cost: 5, competitorPrices: [], minNetPct: 5 });
const noCompOk = noComp.sell >= noComp.minSell && noComp.profitable && noComp.minSell > 5;
console.log(`${noCompOk ? "OK" : "FAIL"}  sans concurrent → plancher ${noComp.sell} (min ${noComp.minSell})`);
if (!noCompOk) failed += 1;

const { resolvePublishQuantity } = require("./ebay-api");
const qty = resolvePublishQuantity(null, 5000);
const qtyCap = resolvePublishQuantity({ sellingLimit: { quantity: 200 } }, 5000);
const qtyAmt = resolvePublishQuantity({ sellingLimit: { amount: { value: "12838.38", currency: "EUR" } } }, 5000, 92.67);
const qtyBoth = resolvePublishQuantity({ sellingLimit: { quantity: 200, amount: { value: "500", currency: "EUR" } } }, 5000, 10);
const qtyOk = qty === 5000 && qtyCap === 200;
const qtyAmtOk = qtyAmt === 138;
const qtyBothOk = qtyBoth === 50;
console.log(`${qtyOk ? "OK" : "FAIL"}  quantité publish ${qty} (cap 200 → ${qtyCap})`);
if (!qtyOk) failed += 1;
console.log(`${qtyAmtOk ? "OK" : "FAIL"}  plancher montant 12838€ / 92.67€ = ${qtyAmt} (attendu 138)`);
if (!qtyAmtOk) failed += 1;
console.log(`${qtyBothOk ? "OK" : "FAIL"}  cap double qty=200 + montant 500€/10€ = ${qtyBoth} (attendu 50)`);
if (!qtyBothOk) failed += 1;

if (failed) {
  console.error(`\n${failed} échec(s)`);
  process.exit(1);
}
console.log("\nTous les tests pertinence + prix OK");
