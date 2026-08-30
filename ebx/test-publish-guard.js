/**
 * Tests double vérification pré-publish (sans réseau).
 */
const {
  extractAsin,
  titlesShareIdentity,
  priceSaneVsSource,
  verifyListingMatchesSource,
} = require("./publish-guard");

let failed = 0;
function check(ok, label) {
  if (!ok) failed += 1;
  console.log(`${ok ? "OK" : "FAIL"}  ${label}`);
}

check(extractAsin("https://www.amazon.fr/dp/B0DB2HLSS9") === "B0DB2HLSS9", "extract ASIN");
check(
  titlesShareIdentity(
    "Logitech MX Ergo S advanced wireless trackball mouse",
    "Logitech MX Ergo souris trackball New"
  ).ok,
  "identité Logitech OK"
);
check(
  !titlesShareIdentity("Logitech MX Ergo S trackball", "Cable USB-C charge rapide 2m").ok,
  "identité mismatch cable vs Logitech"
);

const badPrice = priceSaneVsSource({ livePrice: 87.66, cost: 9.5, sell: 11.51 });
check(!badPrice.ok && badPrice.code === "COST_TOO_LOW_VS_SOURCE", `prix cas listing #129 → ${badPrice.code}`);

const sellBelow = priceSaneVsSource({ livePrice: 87.66, cost: 80, sell: 11.51 });
check(!sellBelow.ok && sellBelow.code === "SELL_BELOW_SOURCE", `vente sous source → ${sellBelow.code}`);

const okPrice = priceSaneVsSource({ livePrice: 87.66, cost: 87.66, sell: 99.9 });
check(okPrice.ok, "prix cohérent OK");

(async () => {
  const fakeScrape = async () => ({
    title: "Logitech MX Ergo S advanced wireless trackball mouse Graphite",
    price: 87.66,
    url: "https://www.amazon.fr/dp/B0DB2HLSS9",
  });

  const blocked = await verifyListingMatchesSource(
    {
      id: 129,
      seo_title: "Logitech MX Ergo souris trackball New",
      suggested_price: 11.51,
      cost_price: 9.5,
      source_url: "https://www.amazon.fr/dp/B0DB2HLSS9",
    },
    { scrapeProduct: fakeScrape }
  );
  check(!blocked.ok, `cas #129 bloqué → ${blocked.code}: ${blocked.message.slice(0, 80)}`);

  const good = await verifyListingMatchesSource(
    {
      id: 1,
      seo_title: "Logitech MX Ergo S trackball sans fil graphite",
      suggested_price: 99.9,
      cost_price: 87.66,
      source_url: "https://www.amazon.fr/dp/B0DB2HLSS9",
    },
    { scrapeProduct: fakeScrape }
  );
  check(good.ok, `cas cohérent OK → ${good.message.slice(0, 80)}`);

  if (failed) {
    console.error(`\n${failed} échec(s) publish-guard`);
    process.exit(1);
  }
  console.log("\nTous les tests publish-guard OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
