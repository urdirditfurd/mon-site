const {
  titleMatchesQuery,
  rankSupplierOffers,
  isPlaceholderSupplierTitle,
  normalizeAliExpressEuroPrice,
  sanitizeAliExpressPrice,
  aliMoneyToEur,
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

const absurd = sanitizeAliExpressPrice(2147.33, "Poncho de pluie");
const absurdOk = absurd != null && absurd < 6;
console.log(`${absurdOk ? "OK" : "FAIL"}  sanitize 2147.33 poncho → ${absurd}€ (pas 21.47€)`);
if (!absurdOk) failed += 1;

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

if (failed) {
  console.error(`\n${failed} échec(s)`);
  process.exit(1);
}
console.log("\nTous les tests pertinence + prix OK");
