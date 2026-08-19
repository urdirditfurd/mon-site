/**
 * Données / simulations locales pour cloner les outils ebx.army
 * (sans scraping réel Amazon/eBay — démo locale fiable)
 */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h || 1;
}

function seededRand(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function getRankings(marketplace = "FR") {
  const products = [
    { title: "Verre Trempé iPhone 15 Pro Max Pack 3", category: "Accessoires Téléphone", price: 9.99, sold: 2840 },
    { title: "Coque Silicone MagSafe iPhone 14", category: "Accessoires Téléphone", price: 12.5, sold: 1920 },
    { title: "Colle B7000 110ml Transparent", category: "Bricolage", price: 7.9, sold: 1654 },
    { title: "Support Laptop Aluminium Réglable", category: "Informatique", price: 24.99, sold: 1432 },
    { title: "Bande LED RGB 5m WiFi", category: "Maison", price: 18.9, sold: 1288 },
    { title: "Organiseur Câbles Bureau Set 10", category: "Bureau", price: 8.5, sold: 1102 },
    { title: "Pochette Ordinateur 15.6\" Nylon", category: "Informatique", price: 16.99, sold: 987 },
    { title: "Mini Projecteur Portable 1080p", category: "Électronique", price: 59.9, sold: 876 },
    { title: "Tapis Souris XXL Gaming RGB", category: "Gaming", price: 14.9, sold: 802 },
    { title: "Chargeur GaN 65W USB-C", category: "Accessoires Téléphone", price: 22.0, sold: 745 },
  ];
  return products.map((p, i) => ({
    rank: i + 1,
    ...p,
    marketplace,
    trend: i % 3 === 0 ? "up" : i % 3 === 1 ? "stable" : "down",
  }));
}

function analyzeTitleKeywords(query) {
  const seed = hashSeed(query.toLowerCase());
  const rand = seededRand(seed);
  const base = query.trim().toLowerCase() || "produit";

  const keywords = [
    { keyword: base, searches: Math.floor(8000 + rand() * 12000), sales: Math.floor(400 + rand() * 900) },
    { keyword: `${base} professionnel`, searches: Math.floor(2000 + rand() * 4000), sales: Math.floor(120 + rand() * 300) },
    { keyword: `${base} fort`, searches: Math.floor(1500 + rand() * 3000), sales: Math.floor(90 + rand() * 250) },
    { keyword: `${base} rapide`, searches: Math.floor(900 + rand() * 2000), sales: Math.floor(60 + rand() * 180) },
  ];

  const longTail = [
    { keyword: `${base} de bricolage`, searches: Math.floor(400 + rand() * 900), sales: Math.floor(40 + rand() * 120) },
    { keyword: `tube de ${base}`, searches: Math.floor(300 + rand() * 700), sales: Math.floor(30 + rand() * 100) },
    { keyword: `${base} epoxy forte`, searches: Math.floor(250 + rand() * 600), sales: Math.floor(25 + rand() * 80) },
    { keyword: `${base} réparation téléphone`, searches: Math.floor(200 + rand() * 500), sales: Math.floor(20 + rand() * 70) },
  ];

  const generic = [
    { keyword: "qualité premium", searches: Math.floor(5000 + rand() * 5000), sales: Math.floor(100 + rand() * 200) },
    { keyword: "livraison rapide", searches: Math.floor(4000 + rand() * 4000), sales: Math.floor(80 + rand() * 150) },
    { keyword: "neuf", searches: Math.floor(10000 + rand() * 8000), sales: Math.floor(200 + rand() * 400) },
    { keyword: "garantie", searches: Math.floor(3000 + rand() * 3000), sales: Math.floor(70 + rand() * 120) },
  ];

  return {
    query,
    analyzedListings: Math.floor(80 + rand() * 200),
    keywords,
    longTail,
    generic,
  };
}

function analyzeCompetitor(sellerName) {
  const seed = hashSeed(sellerName.toLowerCase());
  const rand = seededRand(seed);
  const revenue = +(1500 + rand() * 8000).toFixed(2);
  const active = Math.floor(40 + rand() * 220);
  const avgPrice = +(12 + rand() * 45).toFixed(2);
  const sellThrough = Math.floor(12 + rand() * 40);

  const bestsellers = [
    "Set Vaisselle Bambou 16 pièces",
    "Boîte Conservation Verre Lot 5",
    "Torchons Cuisine Coton Bio x6",
    "Planche à Découper Acacia",
    "Mug Isotherme 350ml Inox",
    "Sac Courses Réutilisable Pack 3",
  ].map((title, i) => ({
    title,
    price: +(8 + rand() * 35).toFixed(2),
    sold: Math.floor(50 + rand() * 600 - i * 40),
    url: `https://www.ebay.fr/sch/i.html?_nkw=${encodeURIComponent(title)}`,
  }));

  return {
    seller: sellerName,
    revenue,
    activeListings: active,
    avgPrice,
    sellThrough,
    successfulSales: Math.floor(200 + rand() * 1500),
    totalSold: Math.floor(500 + rand() * 4000),
    followers: Math.floor(20 + rand() * 800),
    bestsellers,
    location: "France",
    live: false,
    source: "mock",
  };
}

async function* runAutoSnipe({ count = 1, margin = 20, marketplace = "France", ticket = "all", testMode = true }) {
  const sources = ["Amazon FR", "AliExpress", "Cdiscount"];
  yield { type: "log", message: `[INIT] Auto-Snipe démarré — Mode ${testMode ? "TEST (24h)" : "REEL"}` };
  await sleep(400);
  yield { type: "log", message: `[CONFIG] Marketplace=${marketplace} | Marge=${margin}% | Ticket=${ticket} | Qty=${count}` };
  await sleep(500);

  let scanned = 0;
  let imported = 0;
  let listed = 0;
  let errors = 0;

  for (let i = 0; i < count; i++) {
    const source = sources[i % sources.length];
    yield { type: "log", message: `[SCAN] Recherche produits rentables sur ${source}...` };
    await sleep(700);
    scanned += 12 + i;
    yield { type: "stats", scanned, imported, listed, errors };

    const title = [
      "Support Laptop Aluminium",
      "Colle B7000 110ml",
      "Bande LED RGB 5m",
      "Chargeur GaN 65W",
    ][i % 4];
    const cost = +(5 + Math.random() * 20).toFixed(2);
    const price = +((cost * (1 + margin / 100)) * 1.35).toFixed(2);

    yield { type: "log", message: `[IMPORT] ${title} — coût ${cost}€ → prix eBay ${price}€` };
    await sleep(600);
    imported += 1;
    yield { type: "stats", scanned, imported, listed, errors };

    if (testMode) {
      yield { type: "log", message: `[SIMULATION] Listé sur eBay à ${price} EUR — "${title}"` };
    } else {
      yield { type: "log", message: `[LISTING] Publication eBay en cours pour "${title}"...` };
      await sleep(500);
      yield { type: "log", message: `[OK] Listing créé (Sandbox) — SKU EBX-SNIPE-${Date.now()}` };
    }
    listed += 1;
    yield { type: "stats", scanned, imported, listed, errors };
    await sleep(400);
  }

  yield { type: "log", message: `[DONE] Auto-Snipe terminé — ${listed} produit(s) traité(s)` };
  yield { type: "done", scanned, imported, listed, errors };
}

function buildDescriptionFromUrl(url, themeColor = "#667eea") {
  const name = guessProductNameFromUrl(url);
  return {
    seo_title: `${name} — Qualité Premium Livraison Rapide`.slice(0, 80),
    suggested_price: 29.99,
    product_name: name,
    source_url: url,
    html_description: `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:100%;color:#1a1a2e;">
  <div style="background:linear-gradient(135deg,${themeColor} 0%,#764ba2 100%);border-radius:16px;padding:28px 20px;text-align:center;color:#fff;margin-bottom:20px;">
    <h1 style="font-size:20px;margin:0 0 8px;">✨ ${escapeHtml(name)}</h1>
    <p style="font-size:13px;opacity:.9;margin:0;">Découvrez le Produit — Qualité &amp; Authenticité</p>
  </div>
  <div style="text-align:center;margin-bottom:20px;">
    <img src="https://picsum.photos/seed/${encodeURIComponent(name)}/800/500" alt="${escapeHtml(name)}" style="width:100%;border-radius:12px;max-height:280px;object-fit:cover;" />
  </div>
  <div style="background:#fafafe;border-radius:12px;padding:16px;margin-bottom:16px;">
    <h2 style="font-size:15px;margin:0 0 10px;color:#2d2d5e;">Pourquoi Ce Produit ?</h2>
    <p style="font-size:13px;line-height:1.7;color:#555;margin:0;">Détails authentiques, finition soignée et rapport qualité-prix excellent. Idéal pour un usage quotidien, ce produit répond aux attentes des acheteurs eBay exigeants.</p>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
    <div style="background:#f0f0ff;border-radius:12px;padding:14px;text-align:center;"><div style="font-size:20px;">✅</div><p style="font-size:11px;font-weight:600;margin:4px 0 0;">Qualité Premium</p></div>
    <div style="background:#f0fff4;border-radius:12px;padding:14px;text-align:center;"><div style="font-size:20px;">🚚</div><p style="font-size:11px;font-weight:600;margin:4px 0 0;">Livraison Rapide</p></div>
    <div style="background:#fff7ed;border-radius:12px;padding:14px;text-align:center;"><div style="font-size:20px;">🛡️</div><p style="font-size:11px;font-weight:600;margin:4px 0 0;">Garantie</p></div>
    <div style="background:#fef2f2;border-radius:12px;padding:14px;text-align:center;"><div style="font-size:20px;">💬</div><p style="font-size:11px;font-weight:600;margin:4px 0 0;">Support Client</p></div>
  </div>
  <div style="border-radius:12px;border:1px solid #e8e8f0;overflow:hidden;margin-bottom:16px;">
    <div style="background:#f5f3ff;padding:10px 16px;font-size:13px;font-weight:600;color:#5b21b6;">Caractéristiques Techniques</div>
    <div style="padding:12px 16px;font-size:12px;color:#555;line-height:2;">
      ✅ Matériaux durables<br>✅ Conception ergonomique<br>✅ Facile à utiliser<br>✅ Compatible usage quotidien
    </div>
  </div>
  <div style="background:linear-gradient(135deg,${themeColor} 0%,#764ba2 100%);border-radius:12px;padding:16px;text-align:center;color:#fff;">
    <p style="font-size:14px;font-weight:700;margin:0 0 4px;">Commandez Maintenant !</p>
    <p style="font-size:11px;opacity:.85;margin:0;">Retours faciles • Satisfaction garantie • Support réactif</p>
  </div>
</div>`,
  };
}

function guessProductNameFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = decodeURIComponent(u.pathname)
      .split("/")
      .filter(Boolean)
      .map((p) => p.replace(/[-_]/g, " "))
      .filter((p) => p.length > 3 && !/^(dp|gp|product|item|itm|s)$/i.test(p));
    if (parts.length) {
      const raw = parts[parts.length - 1].replace(/\.(html|htm)$/i, "");
      return raw.charAt(0).toUpperCase() + raw.slice(1).slice(0, 60);
    }
  } catch (_) {}
  return "Produit Premium EBX";
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getDashboardStats(listingCount = 0) {
  return {
    revenue: 2566.57,
    orders: 48,
    listings: listingCount,
    conversion: 3.2,
    margin: 22,
    snipesToday: 3,
    pendingOrders: 5,
  };
}

function getAutoOrders() {
  return [
    { id: "AO-1042", product: "Colle B7000 110ml", buyer: "buyer_fr_221", status: "pending", supplier: "AliExpress", amount: 7.9, created_at: new Date().toISOString() },
    { id: "AO-1041", product: "Support Laptop Alu", buyer: "buyer_fr_118", status: "ordered", supplier: "Amazon", amount: 24.99, created_at: new Date(Date.now() - 86400000).toISOString() },
    { id: "AO-1040", product: "Bande LED RGB 5m", buyer: "buyer_fr_087", status: "shipped", supplier: "AliExpress", amount: 18.9, created_at: new Date(Date.now() - 172800000).toISOString() },
    { id: "AO-1039", product: "Chargeur GaN 65W", buyer: "buyer_fr_044", status: "delivered", supplier: "Amazon", amount: 22.0, created_at: new Date(Date.now() - 345600000).toISOString() },
  ];
}

module.exports = {
  getRankings,
  analyzeTitleKeywords,
  analyzeCompetitor,
  runAutoSnipe,
  buildDescriptionFromUrl,
  getDashboardStats,
  getAutoOrders,
};
