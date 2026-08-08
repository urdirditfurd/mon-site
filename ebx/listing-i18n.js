/**
 * Langues d’annonce eBay (Import Manuel + description HTML).
 * fr = défaut, en, de.
 */

function normalizeListingLang(lang) {
  const raw = String(lang || "fr")
    .toLowerCase()
    .trim();
  if (raw === "en" || raw === "english" || raw === "anglais" || raw === "gb" || raw === "us") {
    return "en";
  }
  if (raw === "de" || raw === "deutsch" || raw === "allemand" || raw === "german") {
    return "de";
  }
  return "fr";
}

const TITLE_HOOKS = {
  fr: ["Compatible", "Pratique", "Compact", "Universal", "Premium"],
  en: ["Compatible", "Practical", "Compact", "Universal", "Premium"],
  de: ["Kompatibel", "Praktisch", "Kompakt", "Universal", "Premium"],
};

const TITLE_NEW = { fr: "Neuf", en: "New", de: "Neu" };
const TITLE_QUALITY = { fr: "Qualité Neuf", en: "Quality New", de: "Qualität Neu" };
const TITLE_FALLBACK = {
  fr: "Produit Compatible Qualité Premium Neuf",
  en: "Compatible Premium Quality Product New",
  de: "Kompatibles Premium Qualitätsprodukt Neu",
};
const TITLE_FAST_SHIP = {
  fr: "Livraison rapide",
  en: "Fast shipping",
  de: "Schneller Versand",
};

/** Libellés UI HTML description. */
const UI = {
  fr: {
    badgePremium: "Premium",
    badgeNew: "Neuf",
    badgeQuality: "Qualité",
    discover: "Découvrez le produit",
    why: "Pourquoi ce produit ?",
    whyQuality: "Qualité",
    whyPractical: "Pratique",
    whyReady: "Prêt à l'emploi",
    benefits: "Bénéfices produit",
    defaultBenefit1: "Produit neuf, prêt à l'emploi",
    defaultBenefit2: "Qualité sélectionnée",
    defaultBenefit3: "Expédition soignée",
    specs: "Caractéristiques techniques",
    conditionNew: "Neuf",
    content: "Contenu",
    contentBody: "Article comme sur les photos",
    selection: "Sélection",
    selectionBody: "Produit vérifié avant envoi",
    returns: "Retours",
    returnsBody: "Selon conditions de l'annonce",
    support: "Support",
    supportBody: "Réponse rapide",
    cta: "Commandez maintenant",
    ctaSub: "Retours selon l’annonce • Support réactif • Expédition soignée",
    imagePlaceholder: "Image produit à ajouter",
    productAlt: "Produit",
    unbranded: "Sans marque / générique",
    conditionLabel: "État",
    brandLabel: "Marque",
    materialLabel: "Matériau",
    dimsLabel: "Dimensions",
    typeLabel: "Type",
    usageLabel: "Usage",
    shortPitchFallback: (title) =>
      `Découvrez ${String(title || "ce produit").slice(0, 90)} — qualité et usage quotidien.`,
    sectionDesc: "Description du produit",
    sectionDescBody: (title) =>
      `${title} — produit neuf, prêt à l'emploi, pensé pour un usage quotidien fiable.`,
    sectionPros: "Points forts",
    sectionProsBody: "Finition soignée, utilisation simple, excellent rapport qualité-prix.",
    sectionWhy: "Pourquoi l'adopter",
    sectionWhyBody: "Sélectionné pour sa praticité et sa demande : une solution concrète, livrée soigneusement.",
    benefitMaterial: (m) => `Matériau : ${m}`,
    benefitMaterials: "Matériaux sélectionnés",
    benefitNew: "Produit neuf, prêt à l'emploi",
    benefitDaily: "Idéal pour un usage quotidien",
    benefitShip: "Expédition soignée",
    aiMarket: "FR",
    aiLangName: "français",
  },
  en: {
    badgePremium: "Premium",
    badgeNew: "New",
    badgeQuality: "Quality",
    discover: "Discover the product",
    why: "Why this product?",
    whyQuality: "Quality",
    whyPractical: "Practical",
    whyReady: "Ready to use",
    benefits: "Product benefits",
    defaultBenefit1: "Brand new, ready to use",
    defaultBenefit2: "Selected quality",
    defaultBenefit3: "Careful shipping",
    specs: "Technical specifications",
    conditionNew: "New",
    content: "Contents",
    contentBody: "Item as shown in photos",
    selection: "Selection",
    selectionBody: "Checked before shipping",
    returns: "Returns",
    returnsBody: "According to listing conditions",
    support: "Support",
    supportBody: "Fast response",
    cta: "Order now",
    ctaSub: "Returns per listing • Responsive support • Careful shipping",
    imagePlaceholder: "Product image to add",
    productAlt: "Product",
    unbranded: "Unbranded / generic",
    conditionLabel: "Condition",
    brandLabel: "Brand",
    materialLabel: "Material",
    dimsLabel: "Dimensions",
    typeLabel: "Type",
    usageLabel: "Usage",
    shortPitchFallback: (title) =>
      `Discover ${String(title || "this product").slice(0, 90)} — quality for everyday use.`,
    sectionDesc: "Product description",
    sectionDescBody: (title) =>
      `${title} — brand new, ready to use, designed for reliable everyday use.`,
    sectionPros: "Key strengths",
    sectionProsBody: "Careful finish, easy to use, great value for money.",
    sectionWhy: "Why choose it",
    sectionWhyBody: "Selected for practicality and demand: a concrete solution, carefully shipped.",
    benefitMaterial: (m) => `Material: ${m}`,
    benefitMaterials: "Selected materials",
    benefitNew: "Brand new, ready to use",
    benefitDaily: "Ideal for everyday use",
    benefitShip: "Careful shipping",
    aiMarket: "US/UK",
    aiLangName: "English",
  },
  de: {
    badgePremium: "Premium",
    badgeNew: "Neu",
    badgeQuality: "Qualität",
    discover: "Entdecken Sie das Produkt",
    why: "Warum dieses Produkt?",
    whyQuality: "Qualität",
    whyPractical: "Praktisch",
    whyReady: "Sofort einsatzbereit",
    benefits: "Produktvorteile",
    defaultBenefit1: "Neuware, sofort einsatzbereit",
    defaultBenefit2: "Ausgewählte Qualität",
    defaultBenefit3: "Sorgfältiger Versand",
    specs: "Technische Daten",
    conditionNew: "Neu",
    content: "Inhalt",
    contentBody: "Artikel wie auf den Fotos",
    selection: "Auswahl",
    selectionBody: "Vor dem Versand geprüft",
    returns: "Rückgaben",
    returnsBody: "Gemäß Angebotsbedingungen",
    support: "Support",
    supportBody: "Schnelle Antwort",
    cta: "Jetzt bestellen",
    ctaSub: "Rückgaben laut Angebot • Reaktiver Support • Sorgfältiger Versand",
    imagePlaceholder: "Produktbild hinzufügen",
    productAlt: "Produkt",
    unbranded: "Ohne Marke / generisch",
    conditionLabel: "Zustand",
    brandLabel: "Marke",
    materialLabel: "Material",
    dimsLabel: "Abmessungen",
    typeLabel: "Typ",
    usageLabel: "Verwendung",
    shortPitchFallback: (title) =>
      `Entdecken Sie ${String(title || "dieses Produkt").slice(0, 90)} — Qualität für den Alltag.`,
    sectionDesc: "Produktbeschreibung",
    sectionDescBody: (title) =>
      `${title} — Neuware, sofort einsatzbereit, für zuverlässigen Alltagseinsatz.`,
    sectionPros: "Stärken",
    sectionProsBody: "Sorgfältige Verarbeitung, einfache Nutzung, gutes Preis-Leistungs-Verhältnis.",
    sectionWhy: "Warum wählen",
    sectionWhyBody: "Ausgewählt wegen Praxisnähe und Nachfrage: eine konkrete Lösung, sorgfältig versandt.",
    benefitMaterial: (m) => `Material: ${m}`,
    benefitMaterials: "Ausgewählte Materialien",
    benefitNew: "Neuware, sofort einsatzbereit",
    benefitDaily: "Ideal für den Alltag",
    benefitShip: "Sorgfältiger Versand",
    aiMarket: "DE",
    aiLangName: "Deutsch",
  },
};

function getListingUi(lang) {
  return UI[normalizeListingLang(lang)] || UI.fr;
}

function titleHooksFor(lang) {
  return TITLE_HOOKS[normalizeListingLang(lang)] || TITLE_HOOKS.fr;
}

function titleNewWord(lang) {
  return TITLE_NEW[normalizeListingLang(lang)] || TITLE_NEW.fr;
}

function titleQualityTail(lang) {
  return TITLE_QUALITY[normalizeListingLang(lang)] || TITLE_QUALITY.fr;
}

function titleFallback(lang) {
  return TITLE_FALLBACK[normalizeListingLang(lang)] || TITLE_FALLBACK.fr;
}

function titleShipHook(lang) {
  return TITLE_FAST_SHIP[normalizeListingLang(lang)] || TITLE_FAST_SHIP.fr;
}

/** Relabel common FR spec keys when targeting EN/DE. */
function localizeSpecKey(key, lang) {
  const L = normalizeListingLang(lang);
  if (L === "fr") return key;
  const map = {
    État: L === "de" ? "Zustand" : "Condition",
    Marque: L === "de" ? "Marke" : "Brand",
    Matériau: L === "de" ? "Material" : "Material",
    Dimensions: L === "de" ? "Abmessungen" : "Dimensions",
    Poids: L === "de" ? "Gewicht" : "Weight",
    Type: "Type",
    Usage: L === "de" ? "Verwendung" : "Usage",
    Origine: L === "de" ? "Herkunft" : "Origin",
    "Âge recommandé": L === "de" ? "Empfohlenes Alter" : "Recommended age",
    "Sans BPA": L === "de" ? "BPA-frei" : "BPA-free",
  };
  return map[key] || key;
}

function localizeSpecsObject(specs, lang) {
  const L = normalizeListingLang(lang);
  if (L === "fr" || !specs || typeof specs !== "object") return specs || {};
  const out = {};
  for (const [k, v] of Object.entries(specs)) {
    out[localizeSpecKey(k, L)] = v;
  }
  // Common value swaps
  for (const [k, v] of Object.entries(out)) {
    if (/^(État|Condition|Zustand)$/i.test(k) && /neuf/i.test(String(v))) {
      out[k] = L === "de" ? "Neu" : "New";
    }
    if (/^(Marque|Brand|Marke)$/i.test(k) && /sans marque|unbranded/i.test(String(v))) {
      out[k] = getListingUi(L).unbranded;
    }
  }
  return out;
}

function languageLabel(lang) {
  const L = normalizeListingLang(lang);
  if (L === "en") return "Anglais";
  if (L === "de") return "Allemand";
  return "Français";
}

/**
 * Heuristique : le texte ressemble-t-il à la langue cible ?
 * Utilisé pour éviter de garder une description FR/EN quand on demande DE.
 */
function copyMatchesLanguage(text, lang) {
  const s = String(text || "").trim();
  if (s.length < 12) return false;
  const L = normalizeListingLang(lang);
  const hasFrChars = /[àâäéèêëïîôùûüç]/i.test(s);
  const hasDeChars = /[äöüß]/i.test(s);
  const hasFr =
    hasFrChars ||
    /\b(le|la|les|des|une|pour|avec|dans|neuf|livraison|produit|qualité|découvrez|commande[rz]?|matière|idéal|souple|quotidien)\b/i.test(
      s
    );
  const hasDe =
    hasDeChars ||
    /\b(und|mit|für|nicht|oder|qualität|versand|neu|produkt|entdecken|bestellen|sofort|gebrauch|widerstand|angenehm|gedrückt|dehnen|spielzeug|jetzt)\b/i.test(
      s
    );
  const hasEn =
    /\b(the|and|with|for|this|product|shipping|quality|discover|order|ready|everyday|soft|stretch|designed|pleasant|without)\b/i.test(
      s
    );

  if (L === "de") {
    if (hasDeChars || hasDe) return true;
    if (hasFr || hasEn) return false;
    return false;
  }
  if (L === "en") {
    if (hasFrChars || hasDeChars) return false;
    if (hasFr && !hasEn) return false;
    if (hasDe && !hasEn) return false;
    if (hasEn) return true;
    // Titres produit EN sans mots-outils : OK si pas de FR/DE fort
    return !hasFr && !hasDe;
  }
  // fr
  if (hasFrChars || hasFr) return true;
  if (hasDeChars || hasDe) return false;
  return true;
}

/** Lexique titre eBay courant FR/EN → langue cible (garde les noms de marque/modèle). */
const TITLE_LEXICON = {
  en: {
    neuf: "New",
    nouveau: "New",
    nouvelle: "New",
    livraison: "Shipping",
    rapide: "Fast",
    compatible: "Compatible",
    pratique: "Practical",
    compact: "Compact",
    premium: "Premium",
    qualité: "Quality",
    jouet: "Toy",
    "anti-stress": "Stress-relief",
    antistress: "Stress-relief",
    souple: "Soft",
    coque: "Case",
    chargeur: "Charger",
    câble: "Cable",
    cable: "Cable",
    sans: "Without",
    fil: "Wire",
    universel: "Universal",
    étanche: "Waterproof",
    etanche: "Waterproof",
  },
  de: {
    neuf: "Neu",
    new: "Neu",
    nouveau: "Neu",
    nouvelle: "Neu",
    livraison: "Versand",
    shipping: "Versand",
    rapide: "Schnell",
    fast: "Schnell",
    compatible: "Kompatibel",
    practical: "Praktisch",
    pratique: "Praktisch",
    compact: "Kompakt",
    premium: "Premium",
    quality: "Qualität",
    qualité: "Qualität",
    toy: "Spielzeug",
    jouet: "Spielzeug",
    balle: "Ball",
    ball: "Ball",
    "anti-stress": "Anti-Stress",
    antistress: "Anti-Stress",
    "stress-relief": "Anti-Stress",
    soft: "Weich",
    souple: "Weich",
    case: "Hülle",
    coque: "Hülle",
    charger: "Ladegerät",
    chargeur: "Ladegerät",
    cable: "Kabel",
    câble: "Kabel",
    wireless: "Kabellos",
    portable: "Tragbar",
    universal: "Universal",
    universel: "Universal",
    waterproof: "Wasserdicht",
    étanche: "Wasserdicht",
    etanche: "Wasserdicht",
    fidget: "Fidget",
    squeeze: "Quetsch",
    silicone: "Silikon",
    plastic: "Kunststoff",
    plastique: "Kunststoff",
    metal: "Metall",
    métal: "Metall",
    wood: "Holz",
    bois: "Holz",
    cotton: "Baumwolle",
    coton: "Baumwolle",
    led: "LED",
    set: "Set",
    pack: "Pack",
    idéal: "Ideal",
    ideal: "Ideal",
  },
};

function localizeTitleTokens(title, lang) {
  const L = normalizeListingLang(lang);
  if (L === "fr") return String(title || "");
  const map = TITLE_LEXICON[L] || {};
  return String(title || "")
    .split(/\s+/)
    .map((tok) => {
      const clean = tok.replace(/[^a-zA-ZÀ-ÿÄÖÜäöüß0-9+-]/g, "");
      const key = clean.toLowerCase();
      if (!key || !map[key]) return tok;
      const localized = map[key];
      // Preserve trailing punctuation from original token
      const suffix = tok.slice(clean.length);
      const prefix = tok.slice(0, tok.indexOf(clean) === -1 ? 0 : tok.indexOf(clean));
      return `${prefix}${localized}${suffix}`;
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = {
  normalizeListingLang,
  getListingUi,
  titleHooksFor,
  titleNewWord,
  titleQualityTail,
  titleFallback,
  titleShipHook,
  localizeSpecKey,
  localizeSpecsObject,
  languageLabel,
  copyMatchesLanguage,
  localizeTitleTokens,
};
