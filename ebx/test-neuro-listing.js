/**
 * Tests unitaires neuromarketing listing (sans LLM ; Chrome optionnel pour badge).
 */
const fs = require("fs");
const path = require("path");
const {
  triageListingInputs,
  inferCategory,
  fallbackNeuroCopy,
  buildNeuroHtml,
  clipTitle,
  overlayBadgeOnFirstImage,
} = require("./neuro-listing");
const { CACHE_DIR, ensureCacheDir } = require("./image-cache");

let failed = 0;
function check(ok, label) {
  if (!ok) failed += 1;
  console.log(`${ok ? "OK" : "FAIL"}  ${label}`);
}

async function main() {
  check(inferCategory("chargeur usb c laptop") === "High-Tech / Accessoires", "catégorie tech");
  check(inferCategory("bande elastique musculation") === "Sport / Fitness", "catégorie sport");
  check(clipTitle("a".repeat(100), 60).length <= 60, "clipTitle max 60");

  const listing = {
    id: 1,
    seo_title: "Support Laptop Aluminium Pliable Neuf",
    suggested_price: 24.9,
    cost_price: 12,
    keywords: "auto-publish:support laptop aluminium",
    html_description: `<div><img src="/media/abc.jpg" /><ul><li>✔ Structure alu légère</li><li>✔ Pliable pour le bureau</li></ul><p>Support pour ordinateur portable en aluminium.</p></div>`,
  };
  const inputs = triageListingInputs(listing);
  check(inputs.name.includes("Support Laptop"), `triage nom → ${inputs.name}`);
  check(inputs.price === 24.9, "triage prix");
  check(inputs.images[0] === "/media/abc.jpg", "triage 1ʳᵉ image /media/");
  check(/High-Tech|Maison|Général|Bricolage/.test(inputs.category), `triage catégorie → ${inputs.category}`);
  check(inputs.description.includes("Structure alu"), "triage bullets dans description");

  const copy = fallbackNeuroCopy(inputs);
  check(copy.titles.length === 3 && copy.titles.every((t) => t.length <= 60), "3 titres ≤ 60 car");
  check(copy.seo_title.length <= 80, "seo_title ≤ 80");
  check(copy.benefits.length === 3, "3 bénéfices");
  check(copy.reassurance.length === 2, "2 réassurances");
  check(copy.ctas.length === 2 && copy.ctas.every((c) => !/acheter|valider/i.test(c)), "CTA sans Acheter/Valider");
  check(/^#[0-9a-fA-F]{6}$/.test(copy.visual.primary_hex), "HEX primaire");
  check(Boolean(copy.visual.badge), "badge présent");

  const html = buildNeuroHtml(copy, inputs.images);
  check(/Support|Découvrir|Sécuriser|Best-Seller|Performance|Choix/i.test(html), "HTML neuro généré");
  check(html.includes("/media/abc.jpg"), "hero = 1ʳᵉ image");
  check(!/<script/i.test(html), "pas de script dans HTML");
  check(/Le déclic|Ce que ça change|Tranquillité/i.test(html), "structure hook/bénéfices/réassurance");

  ensureCacheDir();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC",
    "base64"
  );
  const demoName = "neuro-test-badge.png";
  fs.writeFileSync(path.join(CACHE_DIR, demoName), png);
  const dual = `<div><img src="/media/${demoName}" /><img src="/media/keep-second.png" /></div>`;
  const overlay = await overlayBadgeOnFirstImage(dual, {
    badge: "Best-Seller",
    ctaHex: "#f97316",
    primaryHex: "#1e3a5f",
  });
  if (overlay.changed) {
    check(!overlay.html.includes(demoName), "badge: 1ʳᵉ image remplacée");
    check(overlay.html.includes("/media/keep-second.png"), "badge: 2ᵉ image intacte");
  } else {
    console.log("SKIP  badge overlay (Chrome/Playwright indisponible — OK en prod VPS)");
  }

  if (failed) {
    console.error(`\n${failed} échec(s) neuro-listing`);
    process.exit(1);
  }
  console.log("\nTous les tests neuro-listing OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
