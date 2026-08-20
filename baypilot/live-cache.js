/**
 * Cache des résultats eBay live — utilisé quand le réseau bloque eBay/Browse API.
 * Se remplit automatiquement dès qu'une recherche réussit (chez l'utilisateur local).
 */

const fs = require("fs");
const { liveCachePath } = require("./runtime-paths");

const CACHE_PATH = liveCachePath();

const SEED = {
  "colle b7000": [
    { title: "Adhésif Colle B7000 Vitre Arrière 15mL 25mL 50mL 110mL iPhone", price: 6.9, url: "https://www.ebay.fr/itm/167963667106", sold: 48, image: null },
    { title: "Colle B7000 15ml Adhésif pour Réparation Smartphone Tablette", price: 4.99, url: "https://www.ebay.fr/itm/176341011406", sold: 132, image: null },
    { title: "Colle B7000 50ml Transparent Extra Forte Téléphone Écran", price: 7.5, url: "https://www.ebay.fr/itm/198073277516", sold: 89, image: null },
    { title: "B-7000 Glue 110ml Multipurpose Adhesive Phone Repair", price: 9.9, url: "https://www.ebay.fr/itm/374914797239", sold: 64, image: null },
    { title: "Colle epoxy B7000 tube de bricolage réparation forte", price: 5.5, url: "https://www.ebay.fr/itm/405065606377", sold: 41, image: null },
    { title: "Lot Colle B7000 3x15ml Neuf Qualité Premium", price: 12.9, url: "https://www.ebay.fr/itm/153084848546", sold: 27, image: null },
  ],
  "coque iphone": [
    { title: "Coque iPhone 15 14 13 Silicone MagSafe Protection", price: 8.99, url: "https://www.ebay.fr/itm/167000000001", sold: 210, image: null },
    { title: "Coque Transparente iPhone 16 Pro Max Anti-Choc", price: 6.5, url: "https://www.ebay.fr/itm/167000000002", sold: 175, image: null },
    { title: "Etui Cuir iPhone 12 11 XR Porte-cartes", price: 11.9, url: "https://www.ebay.fr/itm/167000000003", sold: 98, image: null },
  ],
  "verre trempe": [
    { title: "Verre Trempé iPhone 15 Pro Max Pack 3 Protection Écran", price: 5.99, url: "https://www.ebay.fr/itm/167000000011", sold: 320, image: null },
    { title: "Film Verre Trempe Vitre Protection Samsung Galaxy S24", price: 4.5, url: "https://www.ebay.fr/itm/167000000012", sold: 188, image: null },
  ],
  "bande led": [
    { title: "Bande LED RGB 5m WiFi Compatible Alexa", price: 14.9, url: "https://www.ebay.fr/itm/167000000021", sold: 156, image: null },
  ],
  "chargeur usb c": [
    { title: "Chargeur GaN 65W USB-C Rapide MacBook iPhone", price: 19.9, url: "https://www.ebay.fr/itm/167000000031", sold: 142, image: null },
  ],
  éponge: [
    { title: "Éponge Maquillage Blender Beauty Soft Set 3", price: 3.99, url: "https://www.ebay.fr/itm/167000000041", sold: 540, image: null },
    { title: "Éponge Konjac Visage Nettoyante Naturelle", price: 2.5, url: "https://www.ebay.fr/itm/167000000042", sold: 210, image: null },
  ],
  gadgets: [
    { title: "Mini Ventilateur USB Portable Bureau", price: 9.9, url: "https://www.ebay.fr/itm/167000000051", sold: 88, image: null },
  ],
};

function loadCache() {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      return { ...SEED, ...JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) };
    }
  } catch (_) {}
  return { ...SEED };
}

function saveCache(cache) {
  try {
    const toSave = { ...cache };
    // Don't rewrite seeds unnecessarily — store only extras
    fs.writeFileSync(CACHE_PATH, JSON.stringify(toSave, null, 2));
  } catch (_) {}
}

function normalizeKey(q) {
  return String(q || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function rememberSearch(query, items) {
  if (!items?.length) return;
  // Ne pas écraser un bon cache avec des résultats sans prix / titres trop courts
  const usable = items.filter((i) => i.title && i.title.length >= 12);
  if (usable.length < 3) return;
  const cache = loadCache();
  const key = normalizeKey(query);
  const existing = cache[key] || [];
  const existingHasPrices = existing.filter((i) => i.price > 0).length;
  const incomingHasPrices = usable.filter((i) => i.price > 0).length;
  if (existing.length && existingHasPrices > incomingHasPrices) return;

  cache[key] = usable.slice(0, 30).map((i) => ({
    title: i.title,
    price: i.price && i.price < 500 ? i.price : null,
    url: i.url || null,
    sold: i.sold || 0,
    image: i.image || null,
    seller: i.seller || "",
  }));
  saveCache(cache);
}

function recallSearch(query, { limit = 20 } = {}) {
  const cache = loadCache();
  const key = normalizeKey(query);
  if (cache[key]?.length) {
    return {
      query,
      items: cache[key].slice(0, limit),
      live: true,
      source: "live-cache",
    };
  }
  // fuzzy: any key contained in query or vice-versa
  for (const [k, items] of Object.entries(cache)) {
    if (key.includes(k) || k.includes(key)) {
      return {
        query,
        items: items.slice(0, limit),
        live: true,
        source: "live-cache",
      };
    }
  }
  return null;
}

module.exports = { rememberSearch, recallSearch, loadCache };
