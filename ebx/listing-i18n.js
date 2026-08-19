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
    support: "Kundenservice",
    supportBody: "Schnelle Antwort",
    cta: "Jetzt bestellen",
    ctaSub: "Rückgaben laut Angebot • Reaktiver Kundenservice • Sorgfältiger Versand",
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
  if (!specs || typeof specs !== "object") return specs || {};
  const out = {};
  for (const [k, v] of Object.entries(specs)) {
    const key = L === "fr" ? k : localizeSpecKey(k, L);
    out[key] = L === "fr" ? v : localizeValue(v, L);
  }
  // Common value swaps
  for (const [k, v] of Object.entries(out)) {
    if (/^(État|Condition|Zustand)$/i.test(k) && /neuf|new|neu/i.test(String(v))) {
      out[k] = L === "de" ? "Neu" : L === "en" ? "New" : "Neuf";
    }
    if (/^(Marque|Brand|Marke)$/i.test(k) && /sans marque|unbranded|ohne marke/i.test(String(v))) {
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
    protection: "Protection",
    antichoc: "Shockproof",
    léger: "Lightweight",
    leger: "Lightweight",
    fin: "Slim",
    fine: "Slim",
    ultra: "Ultra",
    téléphone: "Phone",
    telephone: "Phone",
    ordinateur: "Laptop",
    maison: "Home",
    bureau: "Office",
    silicone: "Silicone",
    design: "Design",
    portable: "Portable",
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
    schnell: "Schnell",
    compatible: "Kompatibel",
    kompatibel: "Kompatibel",
    practical: "Praktisch",
    pratique: "Praktisch",
    compact: "Kompakt",
    kompakt: "Kompakt",
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
    weich: "Weich",
    case: "Hülle",
    coque: "Hülle",
    hülle: "Hülle",
    huelle: "Hülle",
    charger: "Ladegerät",
    chargeur: "Ladegerät",
    cable: "Kabel",
    câble: "Kabel",
    wireless: "Kabellos",
    portable: "Tragbar",
    tragbar: "Tragbar",
    universal: "Universal",
    universel: "Universal",
    waterproof: "Wasserdicht",
    étanche: "Wasserdicht",
    etanche: "Wasserdicht",
    fidget: "Fidget",
    squeeze: "Quetsch",
    silicone: "Silikon",
    silikon: "Silikon",
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
    lampe: "Lampe",
    lamp: "Lampe",
    bureau: "Büro",
    office: "Büro",
    desk: "Schreibtisch",
    rechargeable: "Aufladbar",
    aufladbar: "Aufladbar",
    rgb: "RGB",
    maison: "Zuhause",
    home: "Zuhause",
    light: "Licht",
    lumière: "Licht",
    lumiere: "Licht",
    protection: "Schutz",
    antichoc: "Stoßfest",
    shockproof: "Stoßfest",
    "anti-choc": "Stoßfest",
    choc: "Stoß",
    léger: "Leicht",
    leger: "Leicht",
    lightweight: "Leicht",
    light: "Leicht",
    fin: "Dünn",
    fine: "Dünn",
    slim: "Dünn",
    ultra: "Ultra",
    téléphone: "Handy",
    telephone: "Handy",
    phone: "Handy",
    handy: "Handy",
    ordinateur: "Laptop",
    laptop: "Laptop",
    computer: "Computer",
    maison: "Zuhause",
    home: "Zuhause",
    bureau: "Büro",
    office: "Büro",
    design: "Design",
    washable: "Abwaschbar",
    abwaschbar: "Abwaschbar",
    elastic: "Elastisch",
    elastisch: "Elastisch",
    butter: "Butter",
    foam: "Schaum",
    mousse: "Schaum",
    emploi: "Einsatz",
    lemploi: "Einsatzbereit",
    pret: "Bereit",
    prêt: "Bereit",
    ready: "Bereit",
    usage: "Nutzung",
    quotidien: "Alltag",
    everyday: "Alltag",
    daily: "Alltag",
    qualité: "Qualität",
    product: "Produkt",
    produit: "Produkt",
    cover: "Hülle",
    screen: "Display",
    écran: "Display",
    ecran: "Display",
    power: "Power",
    bank: "Bank",
    wireless: "Kabellos",
    sans: "Ohne",
    without: "Ohne",
    fil: "Kabel",
    wire: "Kabel",
    pour: "",
    avec: "",
    dans: "",
    und: "",
    for: "",
    with: "",
    the: "",
    and: "",
    une: "",
    des: "",
    les: "",
    der: "",
    die: "",
    das: "",
    aux: "",
    sur: "",
    de: "",
    du: "",
    et: "",
    a: "",
    à: "",
    l: "",
    d: "",
  },
};

/** Expressions multi-mots avant découpage token. */
const TITLE_PHRASES = {
  en: [
    [/pr[eê]t\s+[àa]\s+l['']?emploi/gi, "Ready to use"],
    [/anti[-\s]?choc/gi, "Shockproof"],
    [/anti[-\s]?stress/gi, "Stress-relief"],
    [/livraison\s+rapide/gi, "Fast shipping"],
    [/ultra\s+fine?/gi, "Ultra slim"],
    [/sans\s+fil/gi, "Wireless"],
  ],
  de: [
    [/pr[eê]t\s+[àa]\s+l['']?emploi/gi, "Sofort einsatzbereit"],
    [/ready\s+to\s+use/gi, "Sofort einsatzbereit"],
    [/anti[-\s]?choc/gi, "Stoßfest"],
    [/shock\s*proof/gi, "Stoßfest"],
    [/anti[-\s]?stress/gi, "Anti-Stress"],
    [/stress[-\s]?relief/gi, "Anti-Stress"],
    [/livraison\s+rapide/gi, "Schneller Versand"],
    [/fast\s+shipping/gi, "Schneller Versand"],
    [/ultra\s+fine?/gi, "Ultra dünn"],
    [/ultra\s+slim/gi, "Ultra dünn"],
    [/sans\s+fil/gi, "Kabellos"],
    [/charge\s+rapide/gi, "Schnellladen"],
    [/fast\s+charg(?:e|ing)/gi, "Schnellladen"],
    [/usage\s+quotidien/gi, "Alltagsnutzung"],
    [/everyday\s+use/gi, "Alltagsnutzung"],
    [/qualit[eé]\s+premium/gi, "Premium Qualität"],
    [/premium\s+quality/gi, "Premium Qualität"],
    [/matière\s+souple/gi, "Weiches Material"],
    [/soft\s+material/gi, "Weiches Material"],
    [/protection\s+anti[-\s]?choc/gi, "Stoßschutz"],
    [/sans\s+fil/gi, "Kabellos"],
    [/rechargeable/gi, "Aufladbar"],
    [/lampe\s+led/gi, "LED-Lampe"],
    [/led\s+lampe/gi, "LED-Lampe"],
    [/led\s+desk\s+lamp/gi, "LED-Schreibtischlampe"],
  ],
};

const VALUE_LEXICON = {
  en: {
    silicone: "Silicone",
    silikon: "Silicone",
    plastique: "Plastic",
    plastic: "Plastic",
    métal: "Metal",
    metal: "Metal",
    bois: "Wood",
    wood: "Wood",
    coton: "Cotton",
    cotton: "Cotton",
    neuf: "New",
    neu: "New",
    "mousse pu": "PU foam",
    "pu-schaum": "PU foam",
  },
  de: {
    silicone: "Silikon",
    silikon: "Silikon",
    plastic: "Kunststoff",
    plastique: "Kunststoff",
    metal: "Metall",
    métal: "Metall",
    wood: "Holz",
    bois: "Holz",
    cotton: "Baumwolle",
    coton: "Baumwolle",
    new: "Neu",
    neuf: "Neu",
    "pu foam": "PU-Schaum",
    "mousse pu": "PU-Schaum",
  },
};

function applyTitlePhrases(text, lang) {
  const L = normalizeListingLang(lang);
  let out = String(text || "");
  for (const [re, repl] of TITLE_PHRASES[L] || []) {
    out = out.replace(re, repl);
  }
  return out.replace(/\s+/g, " ").trim();
}

function localizeValue(value, lang) {
  const L = normalizeListingLang(lang);
  if (L === "fr") return value;
  const map = VALUE_LEXICON[L] || {};
  const raw = String(value || "").trim();
  if (!raw) return raw;
  const hit = map[raw.toLowerCase()];
  if (hit) return hit;
  // Token-level fallback
  return localizeTitleTokens(raw, L);
}

function localizeTitleTokens(title, lang) {
  const L = normalizeListingLang(lang);
  if (L === "fr") return String(title || "");
  let out = applyTitlePhrases(title, L);
  const map = TITLE_LEXICON[L] || {};
  out = out
    .split(/\s+/)
    .map((tok) => {
      const clean = tok.replace(/[^a-zA-ZÀ-ÿÄÖÜäöüß0-9+-]/g, "");
      const key = clean.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      // also try with accents preserved
      const keyAcc = clean.toLowerCase();
      if (!clean) return "";
      if (Object.prototype.hasOwnProperty.call(map, keyAcc)) return map[keyAcc];
      if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
      // Drop leftover FR fragments when targeting DE/EN
      if (L === "de" || L === "en") {
        if (/^(lemploi|lemploi|l'|d'|qu|aux)$/i.test(clean)) return "";
        if (/[àâäéèêëïîôùûüç]/i.test(clean) && !map[keyAcc] && !map[key]) {
          // keep brand-like tokens with accents only if long; else drop unknown FR words
          if (clean.length <= 6) return "";
        }
      }
      return tok;
    })
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return out;
}

/** Nettoyage agressif des résidus FR/EN hors langue cible (titres). */
function scrubTitleForLanguage(title, lang) {
  const L = normalizeListingLang(lang);
  let out = localizeTitleTokens(title, L);
  if (L === "de") {
    out = out
      .replace(/\b(pour|avec|dans|une|des|les|sur|aux|pret|prêt|emploi|lemploi|qualité|produit|découvrez|livraison|souple|léger|leger|chargeur|coque|pratique|rapide|neuf|nouveau|fine?)\b/gi, "")
      .replace(/\b(for|with|the|and|soft|case|charger|fast|new|lightweight|washable|toy|ball|portable|compatible|compact|protection)\b/gi, (m) => {
        const map = TITLE_LEXICON.de;
        const k = m.toLowerCase();
        return map[k] || "";
      })
      .replace(/\s+/g, " ")
      .trim();
    out = localizeTitleTokens(out, "de");
  } else if (L === "en") {
    out = out
      .replace(/\b(pour|avec|dans|une|des|les|sur|aux|prêt|pret|emploi|lemploi|qualité|produit|découvrez|livraison|souple|léger|leger|chargeur|coque|pratique|rapide|neuf|nouveau)\b/gi, (m) => {
        const map = TITLE_LEXICON.en;
        const k = m.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return map[m.toLowerCase()] || map[k] || "";
      })
      .replace(/\s+/g, " ")
      .trim();
    out = localizeTitleTokens(out, "en");
  }
  return out.replace(/\s+/g, " ").trim();
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
  localizeValue,
  scrubTitleForLanguage,
  applyTitlePhrases,
};
