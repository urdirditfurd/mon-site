/**
 * Helpers images produits — hotlink eBay/Amazon + fallbacks visuels stables.
 */

const CATEGORY_FALLBACKS = {
  phone: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=120&h=120&fit=crop",
  glue: "https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?w=120&h=120&fit=crop",
  led: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=120&h=120&fit=crop",
  laptop: "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=120&h=120&fit=crop",
  cable: "https://images.unsplash.com/photo-1558618047-f4b511aab243?w=120&h=120&fit=crop",
  beauty: "https://images.unsplash.com/photo-1596462502278-27bfdd403348?w=120&h=120&fit=crop",
  fashion: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=120&h=120&fit=crop",
  home: "https://images.unsplash.com/photo-1484101403633-562f891dc89a?w=120&h=120&fit=crop",
  gaming: "https://images.unsplash.com/photo-1612287230202-1ff1d85d1bdf?w=120&h=120&fit=crop",
  sport: "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=120&h=120&fit=crop",
  tool: "https://images.unsplash.com/photo-1504148458007-e60cc775b140?w=120&h=120&fit=crop",
  default: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=120&h=120&fit=crop",
};

const NICHE_VISUALS = {
  "High-Tech & Smartphones": { icon: "📱", image: CATEGORY_FALLBACKS.phone, color: "#dbeafe" },
  "Mode & Sneakers": { icon: "👟", image: CATEGORY_FALLBACKS.fashion, color: "#fce7f3" },
  "Maison & Déco": { icon: "🏠", image: CATEGORY_FALLBACKS.home, color: "#fef3c7" },
  "Beauté & Soins": { icon: "💄", image: CATEGORY_FALLBACKS.beauty, color: "#fce7f3" },
  "Bricolage & Outils": { icon: "🔧", image: CATEGORY_FALLBACKS.tool, color: "#e7e5e4" },
  "Sport & Outdoor": { icon: "🏋️", image: CATEGORY_FALLBACKS.sport, color: "#dcfce7" },
  "Gaming & Setup": { icon: "🎮", image: CATEGORY_FALLBACKS.gaming, color: "#ede9fe" },
  Animaux: { icon: "🐾", image: "https://images.unsplash.com/photo-1450778869180-41d0601e046e?w=120&h=120&fit=crop", color: "#ffedd5" },
};

function hashTitle(str) {
  let h = 0;
  for (const c of String(str || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h || 1;
}

function guessCategoryKey(title = "") {
  const t = String(title).toLowerCase();
  if (/iphone|samsung|coque|chargeur|téléphone|phone|verre trempé|magsafe/.test(t)) return "phone";
  if (/colle|b7000|adhésif|glue|époxy/.test(t)) return "glue";
  if (/led|bande|lumière|rgb/.test(t)) return "led";
  if (/laptop|ordinateur|support|pc |notebook|pochett/.test(t)) return "laptop";
  if (/câble|cable|usb|hdmi|vga|adaptateur/.test(t)) return "cable";
  if (/maquillage|beauté|éponge|pinceau|beauty/.test(t)) return "beauty";
  if (/sneaker|mode|sac|chaussure|vêtement/.test(t)) return "fashion";
  if (/maison|déco|organiseur|vaisselle|mug/.test(t)) return "home";
  if (/gaming|souris|tapis|manette|console/.test(t)) return "gaming";
  if (/sport|yoga|fitness|gourde/.test(t)) return "sport";
  if (/outil|bricolage|tournevis|kit/.test(t)) return "tool";
  return "default";
}

/** Image de secours stable (pas picsum aléatoire) selon le titre. */
function fallbackProductImage(title = "") {
  return CATEGORY_FALLBACKS[guessCategoryKey(title)] || CATEGORY_FALLBACKS.default;
}

function withProductImage(item = {}) {
  const image = item.image || fallbackProductImage(item.title || item.name || "");
  return { ...item, image };
}

function enrichItemsImages(items = []) {
  return (items || []).map(withProductImage);
}

function nicheVisual(name = "") {
  return (
    NICHE_VISUALS[name] || {
      icon: "📈",
      image: CATEGORY_FALLBACKS.default,
      color: "#e6e6fa",
    }
  );
}

module.exports = {
  CATEGORY_FALLBACKS,
  NICHE_VISUALS,
  fallbackProductImage,
  withProductImage,
  enrichItemsImages,
  nicheVisual,
  hashTitle,
  guessCategoryKey,
};
