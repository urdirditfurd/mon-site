const { titleMatchesQuery, rankSupplierOffers, isPlaceholderSupplierTitle } = require("./scraper");

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

const raw = [
  { title: "Poncho imperméable épais, résistant au vent, pour homme et femme", url: "https://fr.aliexpress.com/item/1.html", price: 3.69, source: "aliexpress" },
  { title: "4/6/10 Pièces Poncho de Pluie Adulte, cape de pluie transparent", url: "https://www.amazon.fr/dp/B0DSHZXYY2", price: 7.99, source: "amazon" },
  { title: "flintronic", url: "https://www.amazon.fr/dp/B0CHRMRN87", price: 7.99, source: "amazon" },
  { title: "Poncho Pluie Imperméable avec Sac de Rangement", url: "https://www.amazon.fr/dp/B0FFN39LN2", price: 11.99, source: "amazon" },
  { title: "Poncho Pluie, 2 Poncho Imperméable", url: "https://www.amazon.fr/dp/B0B5ZM4FYF", price: 14.99, source: "amazon" },
  { title: "Imperméable intégral épais en Oxford, poncho de pluie ample", url: "https://fr.aliexpress.com/item/2.html", price: 15.89, source: "aliexpress" },
  { title: "Nu-June Poncho de surf dégradé pour femme", url: "https://fr.aliexpress.com/item/3.html", price: 46.19, source: "aliexpress" },
  { title: "Garde-boue avant en fibre de carbone pour moto DUCATI Panigale V2", url: "https://fr.aliexpress.com/item/4.html", price: 151.99, source: "aliexpress" },
  { title: "poncho — AliExpress", url: "https://fr.aliexpress.com/item/5.html", price: 1.99, source: "aliexpress" },
];

const top = rankSupplierOffers(raw, "poncho", { limit: 3 });
const topTitles = top.map((p) => p.title);
const expectUrls = [
  "https://fr.aliexpress.com/item/1.html",
  "https://www.amazon.fr/dp/B0DSHZXYY2",
  "https://www.amazon.fr/dp/B0FFN39LN2",
];
const rankOk =
  top.length === 3 &&
  top.every((p) => p.price < 12) &&
  top.map((p) => p.url).join() === expectUrls.join() &&
  !topTitles.some((t) => /ducati|flintronic|aliExpress/i.test(t));
console.log(`${rankOk ? "OK" : "FAIL"}  top3=${top.map((p) => `${p.price}€`).join(" | ")} (${top.length})`);
if (!rankOk) {
  failed += 1;
  console.log("  got", top.map((p) => ({ price: p.price, title: p.title.slice(0, 40), url: p.url })));
}

const low = rankSupplierOffers(raw, "poncho", { limit: 3, priceMax: 30 });
const lowOk = low.length === 3 && low.every((p) => p.price <= 30) && !low.some((p) => p.price > 40);
console.log(`${lowOk ? "OK" : "FAIL"}  ticket low ≤30€ → ${low.length} offres`);
if (!lowOk) failed += 1;

const mid = rankSupplierOffers(raw, "poncho", { limit: 3, priceMin: 30.01, priceMax: 100 });
const midOk = mid.length === 1 && mid[0].price === 46.19;
console.log(`${midOk ? "OK" : "FAIL"}  ticket mid 30–100€ → ${mid.map((p) => p.price).join(",")}`);
if (!midOk) failed += 1;

if (failed) {
  console.error(`\n${failed} échec(s)`);
  process.exit(1);
}
console.log("\nTous les tests pertinence OK");
