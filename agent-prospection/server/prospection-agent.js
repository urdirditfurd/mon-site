/**
 * Agent de prospection — branche juridique / finance / expertise comptable.
 * Sources 100 % gratuites, sans clé API.
 * - API Recherche d'entreprises (SIRENE) : entreprises actives, toutes dates
 * - Zones : communes d'Île-de-France uniquement
 * - Site officiel / annuaires publics / OSM : contacts vérifiés (double contrôle)
 */

const dns = require("dns").promises;
const express = require("express");

const USER_AGENT = "ClipForge-Prospection/1.0 (+https://github.com/urdirditfurd/mon-site)";
const BODACC_URL = "https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records";
const SIRENE_URL = "https://recherche-entreprises.api.gouv.fr/search";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const JINA_PREFIX = "https://r.jina.ai/";
const BODACC_PAGE_SIZE = 100;
const CABINETS_NAF = "69.20Z";
const DEFAULT_SECTOR_ID = "cabinets-comptables";
const DEFAULT_CITY_ID = "city-75056"; // Paris
const IDF_CITIES = require("./idf-cities.json");

/** Sources publiques utilisées pour trouver / vérifier les contacts (affichage UI). */
const CONTACT_SOURCES = [
  { name: "API Recherche d’entreprises (SIRENE)", role: "SIREN, NAF, adresse — toutes dates, villes d’Île-de-France" },
  { name: "Site officiel de l’entreprise", role: "E-mail / téléphone public" },
  { name: "DuckDuckGo / Brave (snippets publics)", role: "Indices de contact publics" },
  { name: "Pages Jaunes", role: "Fiches professionnelles publiques" },
  { name: "118712 / Cylex", role: "Annuaires locaux publics" },
  { name: "Google Maps (données publiques)", role: "Coordonnées affichées publiquement" },
  { name: "OpenStreetMap / Overpass", role: "Téléphones ouverts" },
  { name: "Pappers / Societe.com", role: "E-mail public uniquement (pas de téléphone teaser)" },
  { name: "Annuaire des entreprises", role: "Données administratives publiques" }
];

function listContactSources() {
  return CONTACT_SOURCES.map((row) => ({ ...row }));
}

const STOP_WORDS = new Set([
  "sarl", "sas", "sasu", "eurl", "sci", "selarl", "selas", "snc", "sa", "ei",
  "societe", "ste", "les", "des", "une", "aux", "pour", "avec", "dans", "sur",
  "the", "and", "de", "du", "la", "le", "et", "en", "au", "d", "l", "by", "or", "un"
]);

const DIRECTORY_HOSTS = new Set([
  "societe.com", "www.societe.com", "pappers.fr", "www.pappers.fr",
  "infogreffe.fr", "www.infogreffe.fr", "verif.com", "www.verif.com",
  "manageo.fr", "www.manageo.fr", "score3.fr", "www.score3.fr",
  "annuaire-entreprises.data.gouv.fr", "bodacc.fr", "www.bodacc.fr",
  "entreprise.lefigaro.fr", "entreprises.lefigaro.fr", "www.societeinfo.com", "societeinfo.com",
  "preqin.com", "www.preqin.com", "crunchbase.com", "www.crunchbase.com",
  "pitchbook.com", "www.pitchbook.com", "bloomberg.com", "www.bloomberg.com",
  "opencorporates.com", "www.opencorporates.com", "companieshouse.gov.uk",
  "www.companieshouse.gov.uk", "kompass.com", "fr.kompass.com",
  "europages.fr", "www.europages.fr", "linkedin.com", "www.linkedin.com",
  "facebook.com", "www.facebook.com", "instagram.com", "www.instagram.com",
  "google.com", "www.google.com", "maps.google.com", "privateaser.com", "www.privateaser.com",
  "pagesjaunes.fr", "www.pagesjaunes.fr", "118712.fr", "www.118712.fr",
  "cylex.fr", "www.cylex.fr"
]);

const HUGE_CITIES = new Set([
  "paris", "lyon", "marseille", "toulouse", "lille", "bordeaux", "nantes", "nice", "strasbourg"
]);

const RELAY_HOSTS = new Set([
  "le-site-de.com", "www.le-site-de.com", "telephone.city", "www.telephone.city",
  "svaplus.fr", "www.svaplus.fr"
]);

const EMAIL_BLOCK_DOMAINS = [
  "sentry.io", "example.com", "wixpress.com", "pagesjaunes.fr", "duckduckgo.com",
  "jina.ai", "google.com", "gstatic.com", "schema.org", "societe.com", "pappers.fr",
  "facebook.com", "cloudflare.com", "w3.org", "googleapis.com", "microsoft.com",
  "bing.com", "yahoo.com", "gravatar.com", "treatwell.fr", "treatwell.com",
  "planity.com", "planity.fr", "wavy.co", "booksy.com", "cloudinary.com",
  "privateaser.com", "thefork.com", "lafourchette.com", "tripadvisor.fr",
  "lefigaro.fr", "figaro.fr",
  "cylex.fr", "cylex-france.fr", "118712.fr", "googleusercontent.com",
  "talabat.com", "sentry.wixpress.com"
];

const NAF_LABELS = {
  "01": "Agriculture",
  "10": "Industries alimentaires",
  "41": "Construction de bâtiments",
  "42": "Génie civil",
  "43": "Travaux de construction spécialisés",
  "45": "Commerce et réparation d'automobiles",
  "46": "Commerce de gros",
  "47": "Commerce de détail",
  "49": "Transports terrestres",
  "52": "Entreposage et services auxiliaires de transport",
  "55": "Hébergement",
  "56": "Restauration",
  "59": "Cinéma / audiovisuel / vidéo",
  "60": "Programmation radio / télévision",
  "62": "Programmation, conseil et autres activités informatiques",
  "63": "Services d'information",
  "64": "Activités financières",
  "68": "Activités immobilières",
  "69": "Activités juridiques et comptables",
  "70": "Activités des sièges sociaux ; conseil de gestion",
  "71": "Architecture et ingénierie",
  "73": "Publicité et études de marché",
  "74": "Autres activités spécialisées",
  "81": "Services relatifs aux bâtiments et aménagement paysager",
  "82": "Activités administratives de bureau",
  "85": "Enseignement",
  "86": "Activités pour la santé humaine",
  "90": "Arts, spectacles",
  "93": "Activités sportives, récréatives",
  "96": "Autres services personnels",
  "56.10A": "Restauration traditionnelle",
  "56.10B": "Cafétérias et autres libres-services",
  "56.10C": "Restauration de type rapide",
  "56.30Z": "Débits de boissons",
  "96.02A": "Coiffure",
  "96.02B": "Soins de beauté",
  "68.31Z": "Agences immobilières",
  "62.01Z": "Programmation informatique",
  "62.02A": "Conseil en systèmes et logiciels informatiques",
  "69.20Z": "Activités comptables (expertise comptable)",
  "69.10Z": "Activités juridiques",
  "64.19Z": "Autres intermédiations monétaires",
  "65.12Z": "Autres assurances",
  "66.22Z": "Agents et courtiers d’assurances",
  "70.22Z": "Conseil pour les affaires et autres conseils de gestion"
};

/** Branche juridique / finance / expertise comptable. Défaut : cabinets d'expertise comptable. */
const SECTORS = [
  {
    id: DEFAULT_SECTOR_ID,
    label: "Cabinets d’expertise comptable",
    nafPrefixes: [CABINETS_NAF, "6920Z"],
    nafExact: true,
    sireneNaf: [CABINETS_NAF],
    keywords: [
      "expertise comptable",
      "expert-comptable",
      "expert comptable",
      "cabinet comptable",
      "activités comptables",
      "fiduciaire",
      "commissariat aux comptes",
      "comptable"
    ],
    exclude: ["cabinet médical", "cabinet dentaire"]
  },
  {
    id: "cabinets-avocats",
    label: "Cabinets d’avocats",
    nafPrefixes: ["69.10Z", "6910Z"],
    nafExact: true,
    sireneNaf: ["69.10Z"],
    keywords: ["avocat", "avocats", "barreau", "selarl", "selas"],
    exclude: ["notaire", "huissier", "commissaire-priseur", "cabinet médical"]
  },
  {
    id: "juridique",
    label: "Juridique (notaires, huissiers, juristes)",
    nafPrefixes: ["69.10Z", "6910Z"],
    nafExact: true,
    sireneNaf: ["69.10Z"],
    keywords: [
      "juridique", "avocat", "notaire", "huissier", "juriste",
      "commissaire-priseur", "commissaire de justice", "barreau"
    ],
    exclude: ["cabinet médical", "cabinet dentaire"]
  },
  {
    id: "finance",
    label: "Finance / banque / assurance",
    nafPrefixes: ["64", "65", "66"],
    nafExact: false,
    sireneSection: "K",
    keywords: [
      "banque", "finance", "assurance", "crédit", "courtier",
      "patrimoine", "investissement", "holding", "gestion de fonds"
    ],
    exclude: []
  },
  {
    id: "conseil-gestion",
    label: "Conseil en gestion",
    nafPrefixes: ["70.22Z", "7022Z", "70.10Z", "7010Z"],
    nafExact: true,
    sireneNaf: ["70.22Z", "70.10Z"],
    keywords: ["conseil de gestion", "conseil pour les affaires", "holding", "siège social"],
    exclude: ["cabinet médical"]
  },
  {
    id: "branche-juridique-finance",
    label: "Toute la branche (comptable, juridique, finance)",
    nafPrefixes: ["64", "65", "66", "69", "70.10", "70.22", "7010", "7022"],
    nafExact: false,
    sireneNaf: ["69.20Z", "69.10Z", "70.22Z", "70.10Z"],
    sireneSection: "K",
    keywords: [
      "comptable", "avocat", "juridique", "notaire", "banque",
      "finance", "assurance", "conseil", "fiduciaire"
    ],
    exclude: ["cabinet médical", "cabinet dentaire"]
  }
];

const PROSPECT_ZONES = IDF_CITIES.map((city) => ({ ...city, type: "city" }));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeNaf(code) {
  return String(code || "").replace(/\./g, "").toUpperCase();
}

function listSectors() {
  return SECTORS.map(({ id, label }) => ({ id, label }));
}

function listZones() {
  return PROSPECT_ZONES.map(({ id, label }) => ({ id, label }));
}

function defaultCityZone() {
  return PROSPECT_ZONES.find((z) => z.id === DEFAULT_CITY_ID) || PROSPECT_ZONES[0];
}

function resolveSector(raw) {
  const value = String(raw || "").trim();
  const cabinets = SECTORS.find((s) => s.id === DEFAULT_SECTOR_ID) || SECTORS[0];
  if (!value) return cabinets;
  const byId = SECTORS.find((s) => s.id === value);
  if (byId) return byId;
  const lowered = value.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const byLabel = SECTORS.find((s) => {
    const label = s.label.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    return label.includes(lowered) || lowered.includes(s.id.replace(/-/g, " "));
  });
  if (byLabel) return byLabel;
  if (lowered.includes("avocat")) return SECTORS.find((s) => s.id === "cabinets-avocats") || cabinets;
  if (lowered.includes("jurid")) return SECTORS.find((s) => s.id === "juridique") || cabinets;
  if (lowered.includes("financ") || lowered.includes("banque") || lowered.includes("assur")) {
    return SECTORS.find((s) => s.id === "finance") || cabinets;
  }
  if (lowered.includes("conseil") || lowered.includes("gestion")) {
    return SECTORS.find((s) => s.id === "conseil-gestion") || cabinets;
  }
  if (lowered.includes("comptable") || lowered.includes("expertise") || lowered.includes("fiduciaire")) {
    return cabinets;
  }
  return cabinets;
}

function resolveZone(raw) {
  const value = String(raw || "").trim();
  if (!value) return defaultCityZone();
  const byId = PROSPECT_ZONES.find((z) => z.id === value);
  if (byId) return byId;
  const lowered = normalizeCityKey(value);
  if (!lowered) return defaultCityZone();
  const exact = PROSPECT_ZONES.find((z) => normalizeCityKey(z.label) === lowered);
  if (exact) return exact;
  const byName = PROSPECT_ZONES.find((z) => (z.cityNames || []).some((n) => normalizeCityKey(n) === lowered));
  if (byName) return byName;
  const starts = PROSPECT_ZONES.find((z) => normalizeCityKey(z.label).startsWith(lowered) || lowered.startsWith(normalizeCityKey(z.label)));
  if (starts) return starts;
  const includes = PROSPECT_ZONES.find((z) => normalizeCityKey(z.label).includes(lowered));
  if (includes) return includes;
  return defaultCityZone();
}

function cleanDisplayName(name) {
  return String(name || "")
    .replace(/["'`«»]/g, " ")
    .replace(/[\u201c\u201d\u00ab\u00bb]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchName(company) {
  const candidates = [company.brandName, company.name, company.legalName]
    .map((value) => cleanDisplayName(value))
    .filter(Boolean);
  const expanded = [];
  for (const candidate of candidates) {
    expanded.push(candidate);
    const withoutParens = candidate.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    if (withoutParens) expanded.push(withoutParens);
    const inner = candidate.match(/\(([^)]+)\)/);
    if (inner && inner[1].trim().length >= 4) expanded.push(inner[1].trim());
  }
  expanded.sort((a, b) => tokenize(b).length - tokenize(a).length || b.length - a.length);
  return expanded[0] || cleanDisplayName(company.name);
}

function isGenericCompanyName(company) {
  const tokens = tokenize(searchName(company));
  if (tokens.some((token) => token.length >= 5)) return false;
  return tokens.length < 2;
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function nameSimilarity(a, b) {
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));
  if (!left.size || !right.size) return 0;
  let hit = 0;
  for (const token of left) {
    if (right.has(token)) hit += 1;
  }
  return hit / Math.min(left.size, right.size);
}

function activityMatchesSector(activity, sector) {
  if (sector && sector.allSectors) return true;
  const text = String(activity || "").toLowerCase();
  if (!text) return false;
  const excluded = (sector.exclude || []).some((needle) => text.includes(needle.toLowerCase()));
  if (excluded) return false;
  const keys = [...(sector.keywords || []), ...(sector.extraKeywords || [])]
    .map((k) => k.toLowerCase().trim())
    .filter(Boolean);
  if (!keys.length) return true;
  return keys.some((key) => text.includes(key.trim()));
}

function nafMatchesSector(naf, sector) {
  const code = normalizeNaf(naf);
  if (!code || !(sector.nafPrefixes || []).length) return true;
  if (sector.nafExact) {
    return sector.nafPrefixes.some((prefix) => normalizeNaf(prefix) === code);
  }
  return sector.nafPrefixes.some((prefix) => code.startsWith(normalizeNaf(prefix)));
}

function normalizeCityKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchesZone(company, zone) {
  if (!zone) return true;
  if (zone.type !== "city") return false;
  const cp = String(company.postalCode || "").trim();
  const cityKey = normalizeCityKey(company.city);
  const names = (zone.cityNames || []).map((n) => normalizeCityKey(n)).filter(Boolean);
  const labelKey = normalizeCityKey(zone.label);
  const nameOk = Boolean(
    cityKey
    && (
      cityKey === labelKey
      || names.some((n) => cityKey === n || cityKey.includes(n) || n.includes(cityKey))
    )
  );
  const cpOk = /^\d{5}$/.test(cp) && Array.isArray(zone.postalCodes) && zone.postalCodes.includes(cp);
  if (cpOk && nameOk) return true;
  if (cpOk && !cityKey) return true;
  if (nameOk && zone.department) return matchesDepartment(company, zone.department);
  return false;
}

function nafLabel(code) {
  if (!code) return "";
  if (NAF_LABELS[code]) return NAF_LABELS[code];
  const two = code.slice(0, 2);
  return NAF_LABELS[two] || "";
}

function parseJsonField(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function firstEtablissement(record) {
  const parsed = parseJsonField(record.listeetablissements);
  if (!parsed) return null;
  const et = parsed.etablissement;
  if (Array.isArray(et)) return et[0] || null;
  return et || null;
}

function extractSiren(record) {
  const registre = record.registre || [];
  for (const item of registre) {
    const digits = String(item || "").replace(/\D/g, "");
    if (digits.length === 9) return digits;
  }
  const personnes = parseJsonField(record.listepersonnes);
  const person = personnes && (Array.isArray(personnes.personne) ? personnes.personne[0] : personnes.personne);
  const raw = person && person.numeroImmatriculation && person.numeroImmatriculation.numeroIdentification;
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length === 9 ? digits : "";
}

function formatPersonName(person) {
  if (!person) return "";
  if (person.denomination) return String(person.denomination).trim();
  const prenom = Array.isArray(person.prenom) ? person.prenom[0] : person.prenom;
  return [prenom, person.nom].filter(Boolean).join(" ").trim();
}

function parseDirectors(record) {
  const personnes = parseJsonField(record.listepersonnes);
  const person = personnes && (Array.isArray(personnes.personne) ? personnes.personne[0] : personnes.personne);
  if (!person) return [];
  if (person.administration) {
    return [String(person.administration).replace(/^Gérant\s*:\s*/i, "").trim()].filter(Boolean);
  }
  const name = formatPersonName(person);
  return name ? [name] : [];
}

function parseBodaccRecord(record) {
  const etab = firstEtablissement(record);
  const adresseObj = (etab && etab.adresse) || {};
  const personnes = parseJsonField(record.listepersonnes);
  const person = personnes && (Array.isArray(personnes.personne) ? personnes.personne[0] : personnes.personne);
  const siegeAdr = person && person.adresseSiegeSocial;
  const addressParts = [
    adresseObj.numeroVoie || (siegeAdr && siegeAdr.numeroVoie),
    adresseObj.typeVoie || (siegeAdr && siegeAdr.typeVoie),
    adresseObj.nomVoie || (siegeAdr && siegeAdr.nomVoie),
    adresseObj.codePostal || (siegeAdr && siegeAdr.codePostal) || record.cp,
    adresseObj.ville || (siegeAdr && siegeAdr.ville) || record.ville
  ].filter(Boolean);
  const acte = parseJsonField(record.acte) || {};
  const createdAt = acte.dateCommencementActivite || record.dateparution || "";
  const commercialName = person && (person.nomCommercial || person.denomination);
  return {
    source: "BODACC",
    bodaccId: record.id || "",
    brandName: cleanDisplayName(commercialName || record.commercant || ""),
    name: cleanDisplayName(commercialName || record.commercant || ""),
    legalName: String(record.commercant || "").trim(),
    activity: String((etab && etab.activite) || "").trim(),
    siren: extractSiren(record),
    createdAt,
    publishedAt: record.dateparution || "",
    address: addressParts.join(" ").replace(/\s+/g, " ").trim(),
    city: String(adresseObj.ville || (siegeAdr && siegeAdr.ville) || record.ville || "").trim(),
    postalCode: String(adresseObj.codePostal || (siegeAdr && siegeAdr.ville && siegeAdr.codePostal) || record.cp || "").trim(),
    department: String(record.numerodepartement || "").trim(),
    directors: parseDirectors(record),
    bodaccUrl: record.url_complete || "",
    naf: "",
    nafLabel: "",
    email: "",
    phone: "",
    website: "",
    contactSource: "",
    contactConfidence: "none"
  };
}

function normalizeFrPhone(raw) {
  if (!raw) return "";
  let digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("33") && digits.length >= 11) {
    digits = `0${digits.slice(2)}`;
  }
  if (digits.length > 10 && digits.startsWith("0")) {
    digits = digits.slice(0, 10);
  }
  if (digits.length !== 10 || !digits.startsWith("0")) return "";
  // 08xx = surtaxés / numéros teaser Pappers (souvent dérivés du SIREN) — jamais retenus.
  if (digits.startsWith("08")) return "";
  if (digits.startsWith("0033")) return "";
  // Placeholders / numéros fictifs fréquents dans les pages d'annuaire.
  if (/^0([1-9])\1{8}$/.test(digits)) return "";
  if (digits.slice(1) === "123456789" || digits.slice(1) === "987654321") return "";
  if (/^0[1-9](?:00){4}$/.test(digits)) return "";
  if (/^0[1-9]99(?:99){3}$/.test(digits) || digits === "0999999977" || digits === "0900000000") return "";
  if (/(\d)\1{5,}/.test(digits.slice(2))) return "";
  const FAKE = new Set(["0601020304", "0102030405", "0909090909", "0999999977"]);
  if (FAKE.has(digits)) return "";
  return `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 6)} ${digits.slice(6, 8)} ${digits.slice(8, 10)}`;
}

function isSirenTeaserPhone(phone, company) {
  const digits = String(phone || "").replace(/\D/g, "");
  const siren = String(company?.siren || "").replace(/\D/g, "");
  if (digits.length !== 10 || siren.length !== 9) return false;
  // Motif Pappers / societe.com dominant : 0 + SIREN[2..8] + 00  (ex. 107935108 → 07 93 51 08 00)
  if (digits === `0${siren.slice(2)}00`) return true;
  if (digits === `0${siren.slice(1)}`.slice(0, 10)) return true;
  if (digits.slice(1, 10) === siren) return true;
  if (digits.slice(0, 9) === siren) return true;
  if (`0${siren.slice(1)}0` === digits) return true;
  if (digits.includes(siren.slice(0, 8))) return true;
  const fromSlice2 = `0${siren.slice(2)}`;
  if (digits.startsWith(fromSlice2) && /^0+$/.test(digits.slice(fromSlice2.length) || "0")) return true;
  const fromSlice1 = `0${siren.slice(1)}`;
  if (fromSlice1.length <= 10 && digits.startsWith(fromSlice1) && /^0*$/.test(digits.slice(fromSlice1.length))) {
    return true;
  }
  // Mobile 06/07 + gros morceau du SIREN (teasers « déguisés »)
  if (/^0[67]/.test(digits)) {
    const body = digits.slice(2); // 8 digits
    if (siren.includes(body) || body.includes(siren.slice(2)) || body.includes(siren.slice(1, 9))) {
      return true;
    }
  }
  // Tout segment SIREN de 6+ chiffres présent dans le numéro (hors 0 initial).
  const phoneBody = digits.slice(1);
  for (let len = 6; len <= siren.length; len += 1) {
    for (let i = 0; i <= siren.length - len; i += 1) {
      if (phoneBody.includes(siren.slice(i, i + len))) return true;
    }
  }
  return false;
}

/** Sources qui publient quasi uniquement des teasers dérivés du SIREN — jamais de téléphone. */
function sourceForbidsPhone(source) {
  const s = String(source || "").toLowerCase();
  return /pappers|societe\.com|societe com|manageo|score3|verif\.com|infogreffe|creditsafe|ellisphere|societeinfo/.test(s);
}

function phoneFitsCompany(phone, company) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length !== 10) return false;
  if (digits.startsWith("08")) return false;
  if (isSirenTeaserPhone(phone, company)) return false;
  // Beaucoup de teasers se terminent par 00 et recyclent le SIREN — déjà couvert, filet large :
  if (/^0[67]\d{6}00$/.test(digits) && company?.siren) {
    const siren = String(company.siren).replace(/\D/g, "");
    if (siren.length === 9 && digits.slice(1, 8) === siren.slice(2)) return false;
  }
  const prefix = digits.slice(0, 2);
  if (prefix === "06" || prefix === "07" || prefix === "09") return true;
  const dep = String(company.department || "").padStart(2, "0");
  const idf = new Set(["75", "77", "78", "91", "92", "93", "94", "95"]);
  if (idf.has(dep) && prefix !== "01") return false;
  if (dep && !idf.has(dep) && prefix === "01") return false;
  return true;
}

function extractPhones(text) {
  const matches = String(text || "").match(/(?:\+33|0)\s*[1-9](?:[\s.\-]?\d{2}){4}/g) || [];
  const out = [];
  for (const match of matches) {
    const normalized = normalizeFrPhone(match);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

function extractEmails(text) {
  const matches = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const out = [];
  for (const raw of matches) {
    const email = raw.toLowerCase().replace(/[.,;:]+$/, "");
    if (email.includes("...")) continue;
    const [localPart = "", domainPart = ""] = email.split("@");
    if (/\.(png|jpg|jpeg|gif|svg|webp|css|js)$/i.test(email) || /\.(png|jpg|jpeg|gif|svg|webp|css|js)$/i.test(localPart)) continue;
    if (!domainPart.includes(".")) continue;
    if (EMAIL_BLOCK_DOMAINS.some((blocked) => domainPart === blocked || domainPart.endsWith(`.${blocked}`))) continue;
    if (!out.includes(email)) out.push(email);
  }
  return out;
}

function streetTokensForCompany(company) {
  const city = String(company.city || "").toLowerCase();
  return tokenize(company.address).filter((token) => (
    token !== city
    && !/^\d+$/.test(token)
    && token !== "rue" && token !== "av" && token !== "avenue"
    && token !== "bd" && token !== "boulevard" && token !== "chemin" && token !== "place"
  ));
}

function hasStrongAddressMatch(text, company) {
  const hay = String(text || "").toLowerCase();
  if (company.postalCode && hay.includes(String(company.postalCode).toLowerCase())) return true;
  const streetTokens = streetTokensForCompany(company);
  return streetTokens.length >= 2 && streetTokens.filter((token) => hay.includes(token)).length >= 2;
}

function pageCitesSiren(text, company) {
  const siren = String(company?.siren || "").replace(/\D/g, "");
  return Boolean(siren && String(text || "").includes(siren));
}

/**
 * Détecte un conflit d'activité évident (ex. fiche café/bar pour une société NAF 59 audiovisuel).
 * Utile contre les homonymes à la même adresse (CULTURE RAPIDE).
 */
function activityConflictsWithPage(text, company) {
  const hay = String(text || "").toLowerCase();
  if (!hay) return false;
  const naf = String(company.naf || company.nafCode || "").replace(/\D/g, "");
  const activity = `${company.activity || ""} ${company.nafLabel || ""}`.toLowerCase();
  const isAv = /^(59|60)/.test(naf)
    || /cin[eé]ma|audiovisuel|vid[eé]o|production\s+(de\s+)?film|post[\s-]?production|captation/.test(activity);
  const isFoodishCompany = /^(56)/.test(naf)
    || /restaurant|caf[eé]|bar\b|brasserie|traiteur|d[eé]bit de boisson/.test(activity);
  const pageIsCafeBar = /\b(caf[eé]s?(?:,|\s+bars?)?|bar\s+[àa]\s+bi[eè]re|bar\s+[àa]\s+vin|brasserie|restaurant|cocktail|terrasse|happy\s*hour)\b/.test(hay)
    || /dans l'activit[eé]\s+\*\*caf[eé]s?,?\s*bars?\*\*/i.test(hay);
  const pageIsAv = /\b(cin[eé]ma|audiovisuel|production\s+(de\s+)?film|soci[eé]t[eé]\s+de\s+production|post[\s-]?production|captation)\b/.test(hay);
  if (isAv && pageIsCafeBar && !pageIsAv) return true;
  if (isFoodishCompany && pageIsAv && !pageIsCafeBar) return true;
  return false;
}

/**
 * Sources annuaire (PJ, 118712…) : en grande ville, exiger le SIREN sur la page.
 * Sinon homonymes / commerces historiques à la même adresse polluent le contact.
 */
function directoryEvidenceOk(text, company) {
  // SIREN cité = même entité juridique (même si la fiche parle aussi d'un café).
  if (pageCitesSiren(text, company)) return true;
  if (activityConflictsWithPage(text, company)) return false;
  const city = String(company.city || "").toLowerCase();
  if (HUGE_CITIES.has(city)) return false;
  return hasStrongAddressMatch(text, company);
}

/** Extrait un téléphone proche d'une ancre (SIREN ou tokens d'adresse), pas le 1er de la page. */
function extractPhonesNearEvidence(text, company) {
  const hay = String(text || "");
  const anchors = [];
  if (company.siren) {
    const idx = hay.indexOf(company.siren);
    if (idx >= 0) anchors.push(idx);
  }
  for (const token of streetTokensForCompany(company).slice(0, 4)) {
    const idx = hay.toLowerCase().indexOf(token);
    if (idx >= 0) anchors.push(idx);
  }
  if (company.postalCode) {
    const idx = hay.indexOf(String(company.postalCode));
    if (idx >= 0) anchors.push(idx);
  }
  if (!anchors.length) {
    return extractPhones(hay).filter((phone) => phoneFitsCompany(phone, company));
  }
  const windows = anchors.map((idx) => hay.slice(Math.max(0, idx - 500), idx + 900));
  const out = [];
  for (const win of windows) {
    for (const phone of extractPhones(win)) {
      if (phoneFitsCompany(phone, company) && !out.includes(phone)) out.push(phone);
    }
  }
  return out;
}

function pageMatchesCompany(text, company) {
  const hay = String(text || "").toLowerCase();
  if (company.siren && hay.includes(company.siren)) return true;
  const city = String(company.city || "").toLowerCase();
  const isHugeCity = HUGE_CITIES.has(city);
  const hasPostal = Boolean(company.postalCode && hay.includes(String(company.postalCode).toLowerCase()));
  const streetTokens = streetTokensForCompany(company);
  const hasStreet = streetTokens.length >= 2 && streetTokens.filter((token) => hay.includes(token)).length >= 2;
  const hasPlace = Boolean(
    hasPostal
    || hasStreet
    || (city && hay.includes(city) && !isHugeCity)
  );
  const nameScore = nameSimilarity(company.name, hay.slice(0, 4000));
  const tokens = tokenize(company.name);
  if (tokens.length <= 1) {
    return hasPlace && nameScore >= 0.99;
  }
  // Grandes villes : jamais de match nom seul (homonymes fréquents) — SIREN / CP / rue forte requis.
  if (isHugeCity) {
    return (hasPostal || hasStreet) && nameScore >= 0.34;
  }
  if (hasPlace && nameScore >= 0.34) return true;
  if (nameScore >= 0.8) return true;
  return false;
}

function decodeDuckDuckGoUrl(href) {
  try {
    const parsed = new URL(href, "https://duckduckgo.com/");
    const uddg = parsed.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : href;
  } catch {
    return href;
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isDirectoryHost(url) {
  const host = hostOf(url);
  if (DIRECTORY_HOSTS.has(host)) return true;
  if (host.endsWith(".pagesjaunes.fr")) return true;
  if (host.endsWith(".gouv.fr") && host.includes("annuaire")) return true;
  // Bases B2B / data providers / plateformes (téléphone générique fréquent).
  if (/(^|\.)(preqin|crunchbase|pitchbook|bloomberg|reuters|kompass|europages|dnb|creditsafe|ellisphere|privateaser|thefork|lafourchette|tripadvisor|lefigaro)\./.test(host)) {
    return true;
  }
  if (/(^|\.)google\./.test(host) && !/maps\.google\./.test(host)) return true;
  return false;
}

function isRealCompanyWebsite(url) {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  if (isDirectoryHost(trimmed) || isRelayHost(trimmed)) return false;
  return true;
}

function isRelayHost(url) {
  return RELAY_HOSTS.has(hostOf(url));
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\b(sarl|sas|sasu|eurl|sci|selarl|ste|societe)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function parseMarkdownLinks(markdown) {
  const links = [];
  const re = /\[([^\]]+)\]\((https?:[^)]+)\)/g;
  let match;
  while ((match = re.exec(markdown))) {
    const title = match[1].replace(/\s+/g, " ").trim();
    if (title.startsWith("![") || title.startsWith("Image ")) continue;
    const href = decodeDuckDuckGoUrl(match[2]);
    if (!href.startsWith("http")) continue;
    if (href.includes("duckduckgo.com") || href.includes("jina.ai") || href.includes("r.jina.ai")) continue;
    links.push({ title, href });
  }
  return links;
}

async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = options.timeoutMs || 20000;
  const retries = options.retries ?? 2;
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: options.accept || "application/json,text/html,text/plain;q=0.9,*/*;q=0.8",
          "Accept-Language": "fr-FR,fr;q=0.9",
          ...(options.headers || {})
        },
        signal: controller.signal
      });
      if (response.status === 429 && attempt < retries) {
        const waitSec = Number(response.headers.get("retry-after") || 2);
        await sleep(Math.min(Math.max(waitSec, 1), 8) * 1000);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(600 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error(`Échec de récupération: ${url}`);
}

async function fetchJson(url, options = {}) {
  const response = await fetchWithTimeout(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} pour ${url}`);
  }
  return response.json();
}

async function fetchText(url, options = {}) {
  const response = await fetchWithTimeout(url, { ...options, accept: "text/html,text/plain,*/*" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} pour ${url}`);
  }
  return response.text();
}

async function fetchViaJina(targetUrl) {
  const wrapped = `${JINA_PREFIX}${targetUrl}`;
  return fetchText(wrapped, {
    timeoutMs: 5500,
    retries: 0,
    headers: { "X-No-Cache": "true", Accept: "text/markdown" }
  });
}

function buildBodaccWhere(sector, days, department) {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - Math.max(1, Number(days) || 30));
  const iso = start.toISOString().slice(0, 10);
  const clauses = [
    "familleavis='creation'",
    `dateparution>=date'${iso}'`
  ];
  if (department) {
    const dep = String(department).padStart(2, "0");
    clauses.push(`numerodepartement='${dep}'`);
  }
  // "Tous" : pas de filtre mot-clé BODACC (on filtre ensuite par NAF des secteurs listés).
  if (sector.allSectors) {
    return clauses.join(" AND ");
  }
  const keywords = [...(sector.keywords || [])].slice(0, 6);
  if (keywords.length) {
    const likes = keywords.map((kw) => `listeetablissements LIKE '%${kw.replace(/'/g, "''")}%'`);
    clauses.push(`(${likes.join(" OR ")})`);
  }
  return clauses.join(" AND ");
}

async function fetchBodaccCreations(sector, days, department, needed) {
  const where = buildBodaccWhere(sector, days, department);
  const collected = [];
  const seen = new Set();
  let offset = 0;
  let total = Infinity;
  while (collected.length < needed * 3 && offset < total && offset < 2000) {
    const url = `${BODACC_URL}?${new URLSearchParams({
      where,
      limit: String(BODACC_PAGE_SIZE),
      offset: String(offset),
      order_by: "dateparution desc"
    }).toString()}`;
    const payload = await fetchJson(url, { timeoutMs: 25000 });
    total = Number(payload.total_count || 0);
    const rows = payload.results || [];
    if (!rows.length) break;
    for (const row of rows) {
      const company = parseBodaccRecord(row);
      if (!company.name || !company.activity) continue;
      if (!activityMatchesSector(company.activity, sector)) continue;
      const key = company.siren || `${company.name}|${company.city}|${company.createdAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(company);
      if (collected.length >= needed * 3) break;
    }
    offset += rows.length;
    if (rows.length < BODACC_PAGE_SIZE) break;
    await sleep(80);
  }
  return { total, companies: collected };
}

function isNonDiffusible(value) {
  return /NON-DIFFUSIBLE/i.test(String(value || ""));
}

async function enrichSirene(company) {
  if (!company.siren) return company;
  const url = `${SIRENE_URL}?${new URLSearchParams({ q: company.siren }).toString()}`;
  try {
    const payload = await fetchJson(url, { timeoutMs: 12000, retries: 2 });
    const hit = (payload.results || [])[0];
    if (!hit) return company;
    const nom = hit.nom_complet || hit.nom_raison_sociale || "";
    if (nom && !isNonDiffusible(nom)) {
      company.name = nom;
    }
    company.naf = hit.activite_principale || company.naf;
    company.nafLabel = nafLabel(company.naf);
    if (hit.date_creation && !String(hit.date_creation).startsWith("1900")) {
      company.createdAt = hit.date_creation;
    }
    const siege = hit.siege || {};
    const sireneAddress = siege.geo_adresse || siege.adresse || "";
    if (sireneAddress && !isNonDiffusible(sireneAddress)) {
      company.address = sireneAddress;
      company.city = siege.libelle_commune || company.city;
      company.postalCode = siege.code_postal || company.postalCode;
    }
    if (siege.latitude && !isNonDiffusible(sireneAddress)) {
      company.latitude = Number(siege.latitude);
      company.longitude = Number(siege.longitude);
    }
    const dirigeants = Array.isArray(hit.dirigeants) ? hit.dirigeants : [];
    const names = dirigeants
      .map((d) => [d.prenoms, d.nom, d.denomination].filter(Boolean).join(" ").trim())
      .filter((name) => name && !isNonDiffusible(name));
    if (names.length) company.directors = names;
    company.sireneUrl = `https://annuaire-entreprises.data.gouv.fr/entreprise/${company.siren}`;
  } catch {
    // L'annonce BODACC reste exploitable si Sirene est limitée.
  }
  return company;
}

function companyFromSireneHit(hit) {
  const siege = hit.siege || {};
  const nom = hit.nom_complet || hit.nom_raison_sociale || "";
  if (!nom || isNonDiffusible(nom)) return null;
  const naf = hit.activite_principale || siege.activite_principale || "";
  const address = siege.geo_adresse || siege.adresse || "";
  const dirigeants = Array.isArray(hit.dirigeants) ? hit.dirigeants : [];
  const directors = dirigeants
    .map((d) => [d.prenoms, d.nom, d.denomination].filter(Boolean).join(" ").trim())
    .filter((name) => name && !isNonDiffusible(name));
  const dep = String(siege.departement || "").trim()
    || (String(siege.code_postal || "").match(/^(\d{2,3})/) || [])[1]
    || "";
  return {
    source: "SIRENE",
    brandName: cleanDisplayName(siege.nom_commercial || hit.sigle || ""),
    name: cleanDisplayName(nom),
    legalName: cleanDisplayName(hit.nom_raison_sociale || nom),
    activity: nafLabel(naf) || "Activité déclarée",
    naf,
    nafLabel: nafLabel(naf) || "",
    siren: String(hit.siren || "").replace(/\D/g, "").slice(0, 9),
    createdAt: hit.date_creation && !String(hit.date_creation).startsWith("1900") ? hit.date_creation : "",
    publishedAt: "",
    address: address && !isNonDiffusible(address) ? address : "",
    city: siege.libelle_commune || "",
    postalCode: siege.code_postal || "",
    department: dep ? String(dep).replace(/\D/g, "").padStart(2, "0").slice(0, 2) : "",
    directors,
    latitude: siege.latitude ? Number(siege.latitude) : null,
    longitude: siege.longitude ? Number(siege.longitude) : null,
    sireneUrl: hit.siren ? `https://annuaire-entreprises.data.gouv.fr/entreprise/${hit.siren}` : "",
    email: "",
    phone: "",
    website: "",
    contactSource: "",
    contactConfidence: "",
    contactVerified: false
  };
}

function buildSireneSearchParams(sector, zone, page, perPage, variant = {}) {
  const params = {
    etat_administratif: "A",
    per_page: String(perPage),
    page: String(page)
  };
  if (variant.section_activite_principale) {
    params.section_activite_principale = variant.section_activite_principale;
  } else if (variant.activite_principale) {
    params.activite_principale = variant.activite_principale;
  } else if (Array.isArray(sector.sireneNaf) && sector.sireneNaf.length) {
    params.activite_principale = sector.sireneNaf.join(",");
  } else if (sector.sireneSection) {
    params.section_activite_principale = sector.sireneSection;
  } else {
    params.activite_principale = CABINETS_NAF;
  }
  if (zone && zone.type === "city") {
    const codes = Array.isArray(zone.postalCodes) ? zone.postalCodes : [];
    if (variant.code_postal) {
      params.code_postal = variant.code_postal;
    } else if (codes.length === 1) {
      params.code_postal = codes[0];
    } else if (codes.length > 1 && codes.length <= 4) {
      params.code_postal = codes[0];
    } else if (zone.department) {
      params.departement = String(zone.department).padStart(2, "0");
    }
  }
  return params;
}

function sireneActivityVariants(sector) {
  const variants = [];
  if (sector.sireneSection) {
    variants.push({ section_activite_principale: sector.sireneSection });
  }
  if (Array.isArray(sector.sireneNaf) && sector.sireneNaf.length) {
    variants.push({ activite_principale: sector.sireneNaf.join(",") });
  }
  if (!variants.length) {
    variants.push({ activite_principale: CABINETS_NAF });
  }
  return variants;
}

async function fetchSireneCabinets(sector, zone, needed) {
  const collected = [];
  const seen = new Set();
  const perPage = 25;
  const maxPages = 16;
  const activityVariants = sireneActivityVariants(sector);
  const postalQueue = zone && zone.type === "city" && Array.isArray(zone.postalCodes) && zone.postalCodes.length > 1 && zone.postalCodes.length <= 4
    ? [...zone.postalCodes]
    : [null];
  let total = 0;

  for (const activity of activityVariants) {
    for (const postalOverride of postalQueue) {
      let page = 1;
      let localTotal = Infinity;
      while (collected.length < Math.max(needed * 2, needed + 10) && page <= maxPages && (page - 1) * perPage < localTotal) {
        const variant = { ...activity };
        if (postalOverride) variant.code_postal = postalOverride;
        const url = `${SIRENE_URL}?${new URLSearchParams(buildSireneSearchParams(sector, zone, page, perPage, variant)).toString()}`;
        let payload;
        try {
          payload = await fetchJson(url, { timeoutMs: 20000, retries: 2 });
        } catch {
          break;
        }
        localTotal = Number(payload.total_results || payload.total || 0) || localTotal;
        total = Math.max(total, Number.isFinite(localTotal) ? localTotal : 0);
        const rows = payload.results || [];
        if (!rows.length) break;
        for (const hit of rows) {
          const company = companyFromSireneHit(hit);
          if (!company || !company.siren) continue;
          if (!nafMatchesSector(company.naf, sector)) continue;
          if (!matchesZone(company, zone)) continue;
          if (seen.has(company.siren)) continue;
          seen.add(company.siren);
          collected.push(company);
          if (collected.length >= Math.max(needed * 2, needed + 10)) break;
        }
        if (rows.length < perPage) break;
        page += 1;
        await sleep(60);
      }
      if (collected.length >= needed) break;
    }
    if (collected.length >= needed) break;
  }
  return { total: total || collected.length, companies: collected };
}

function applyContact(company, { email, phone, website, source, confidence }) {
  const level = confidence || "medium";
  const rank = { high: 3, medium: 2, low: 1 };
  const currentRank = rank[company.contactConfidence] || 0;
  const nextRank = rank[level] || 0;
  if (level === "low") {
    // Ne jamais valider un contact conjectural (ex. email MX deviné).
    return;
  }
  let safePhone = phone && phoneFitsCompany(phone, company) ? (normalizeFrPhone(phone) || "") : "";
  // Pappers / societe.com / etc. : jamais de téléphone (teasers SIREN).
  if (safePhone && sourceForbidsPhone(source)) safePhone = "";
  if (safePhone && isSirenTeaserPhone(safePhone, company)) safePhone = "";
  const safeEmail = email ? (extractEmails(email)[0] || "") : "";
  if (!safeEmail && !safePhone && !(website && isRealCompanyWebsite(website))) {
    return;
  }
  if (safeEmail && (!company.email || nextRank >= currentRank)) company.email = safeEmail;
  if (safePhone && (!company.phone || nextRank >= currentRank)) company.phone = safePhone;
  // Jamais d'URL d'annuaire (Pappers, PagesJaunes, societe.com, etc.) comme site entreprise.
  if (website && isRealCompanyWebsite(website) && !company.website) company.website = website;
  if ((safeEmail || safePhone) && nextRank >= currentRank) {
    company.contactSource = source;
    company.contactConfidence = level;
    company.contactVerified = level === "high" || level === "medium";
  }
  sanitizeCompanyContact(company);
}

function matchesDepartment(company, department) {
  if (!department) return true;
  const dep = String(department).padStart(2, "0");
  const cp = String(company.postalCode || "").trim();
  // Priorité au code postal français réel (évite les succursales étrangères marquées Paris).
  if (/^\d{5}$/.test(cp)) {
    if (dep.length === 3) return cp.startsWith(dep);
    return cp.startsWith(dep);
  }
  // Code postal présent mais non FR (ex. Irlande "D08", "99") → hors zone.
  if (cp) return false;
  const companyDep = String(company.department || "").padStart(2, "0");
  return companyDep === dep;
}

function writeSse(res, payload) {
  // Padding anti-buffer Cloudflare / proxies (~2 Ko) pour forcer le flush immédiat.
  res.write(`: ${" ".repeat(2048)}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  if (typeof res.flush === "function") res.flush();
}

async function enrichFromNominatim(company) {
  if (!company.city && !company.postalCode) return false;
  const query = [searchName(company), company.postalCode, company.city, "France"].filter(Boolean).join(" ");
  const url = `${NOMINATIM_URL}?${new URLSearchParams({
    q: query,
    format: "json",
    addressdetails: "1",
    extratags: "1",
    limit: "5"
  }).toString()}`;
  try {
    const rows = await fetchJson(url, {
      timeoutMs: 12000,
      headers: { "User-Agent": USER_AGENT }
    });
    for (const row of rows || []) {
      const extra = row.extratags || {};
      const display = `${row.name || ""} ${row.display_name || ""} ${JSON.stringify(extra)}`;
      const sameCity = company.city && display.toLowerCase().includes(String(company.city).toLowerCase());
      const sameCp = company.postalCode && display.includes(company.postalCode);
      if (!sameCity && !sameCp) continue;
      if (nameSimilarity(company.name, row.name || row.display_name) < 0.5) continue;
      const phone = normalizeFrPhone(extra.phone || extra["contact:phone"] || "");
      if (phone && !phoneFitsCompany(phone, company)) continue;
      const email = extractEmails(extra.email || extra["contact:email"] || "")[0] || "";
      const website = extra.website || extra["contact:website"] || "";
      if (phone || email) {
        applyContact(company, {
          email,
          phone,
          website,
          source: "OpenStreetMap",
          confidence: "high"
        });
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

async function enrichFromDomainGuess(company) {
  const base = slugify(searchName(company));
  const city = slugify(company.city);
  if (!base || base.length < 4) return false;
  const parts = base.split("-").filter(Boolean);
  const forms = new Set([base, parts.join("")]);
  if (parts.length >= 3) {
    forms.add(parts.filter((part) => part !== "le" && part !== "la" && part !== "les").join("-"));
  }
  if (city) forms.add(`${base}-${city}`);
  const unique = [...forms].filter((form) => form.length >= 4).slice(0, 5);
  for (const form of unique) {
    for (const tld of [".fr", ".com"]) {
      const host = form + tld;
      try {
        await dns.lookup(host);
      } catch {
        continue;
      }
      const url = `https://${host}`;
      try {
        const scraped = await scrapeWebsiteQuick(url, company);
        if (scraped.email || scraped.phone) {
          applyContact(company, {
            email: scraped.email,
            phone: scraped.phone,
            website: scraped.website || url,
            source: `site ${hostOf(url) || host}`,
            confidence: scraped.confidence || "medium"
          });
          return true;
        }
      } catch {
        // skip
      }
      await sleep(100);
    }
  }
  return false;
}

async function scrapeWebsiteQuick(url, company) {
  if (isDirectoryHost(url) || isRelayHost(url)) {
    return { website: "" };
  }
  const paths = ["", "/contact", "/mentions-legales"];
  let combined = "";
  for (const p of paths) {
    const target = p ? new URL(p, url).toString() : url;
    let html = "";
    try {
      html = await fetchText(target, { timeoutMs: 8000, retries: 0 });
    } catch {
      continue;
    }
    if (!html) continue;
    combined += `\n${html}`;
    const picked = pickBestFromText(combined, company, `site ${hostOf(url)}`, target, { fullText: true });
    if (picked && (picked.email || picked.phone)) {
      // Exige un ancrage fort : le nom (ou la ville+SIREN) doit apparaître près du contact.
      if (!pageMatchesCompany(combined, company)) continue;
      return { ...picked, website: url };
    }
  }
  // Site entreprise : SIREN obligatoire en grande ville (homonymes à la même adresse).
  const city = String(company.city || "").toLowerCase();
  const identityOk = company.siren && combined.includes(company.siren)
    ? true
    : (!HUGE_CITIES.has(city) && hasStrongAddressMatch(combined, company));
  const canAttachSite = Boolean(
    identityOk
    && !activityConflictsWithPage(combined, company)
    && pageMatchesCompany(combined, company)
  );
  return { website: canAttachSite && isRealCompanyWebsite(url) ? url : "" };
}

function pickBestFromText(text, company, source, href = "", options = {}) {
  if (activityConflictsWithPage(text, company)) return null;
  if (!options.lenient && !pageMatchesCompany(text, company)) return null;
  if (options.lenient && nameSimilarity(company.name, String(text || "").slice(0, 6000)) < 0.2) return null;
  const hay = String(text || "");
  const lowered = hay.toLowerCase();
  // Snippets qui ne font que renvoyer une fiche Pappers/societe → ignorer les téléphones.
  const directorySnippet = /pappers\.fr|societe\.com|manageo\.fr|score3\.fr|verif\.com/.test(lowered)
    || sourceForbidsPhone(source)
    || isDirectoryHost(href);
  const tokens = tokenize(searchName(company)).sort((a, b) => b.length - a.length);
  const needle = tokens[0] || "";
  const idx = needle ? lowered.indexOf(needle) : 0;
  const sample = options.fullText
    ? hay
    : (idx >= 0 ? hay.slice(Math.max(0, idx - 120), idx + 900) : hay.slice(0, 1800));
  const relayPage = /2,99\s*€|mise en relation|n'est pas le numéro du destinataire/i.test(sample) || isRelayHost(href);
  const emails = extractEmails(sample);
  let phones = (relayPage || directorySnippet) ? [] : extractPhonesNearEvidence(sample, company);
  phones = phones.filter((p) => phoneFitsCompany(p, company) && !isSirenTeaserPhone(p, company));
  if (!emails.length && !phones.length) return null;
  const hasSiren = pageCitesSiren(sample, company) || pageCitesSiren(hay, company);
  return {
    email: emails[0] || "",
    phone: phones[0] || "",
    source,
    confidence: hasSiren ? "high" : "medium"
  };
}

function discoverContactUrls(html, baseUrl) {
  const found = [];
  const re = /href=["']([^"'#]+)["']/gi;
  let match;
  while ((match = re.exec(String(html || "")))) {
    if (!/contact|mention|legal|coordonn|acces|acc[eè]s|rdv|horaire/i.test(match[1])) continue;
    try {
      const absolute = new URL(match[1], baseUrl).toString();
      if (hostOf(absolute) === hostOf(baseUrl) && !found.includes(absolute)) found.push(absolute);
    } catch {
      // ignore
    }
  }
  return found.slice(0, 5);
}

async function scrapeWebsite(url, company) {
  const paths = ["", "/contact", "/mentions-legales"];
  let combined = "";
  let baseText = "";
  const visited = new Set();
  const queue = paths.map((pathName) => (pathName ? new URL(pathName, url).toString() : url));
  for (let i = 0; i < queue.length; i += 1) {
    const target = queue[i];
    if (visited.has(target)) continue;
    visited.add(target);
    let html = "";
    try {
      html = await fetchText(target, { timeoutMs: 8000, retries: 0 });
    } catch {
      try {
        html = await fetchViaJina(target);
      } catch {
        html = "";
      }
    }
    if (!html) continue;
    combined += `\n${html}`;
    if (i === 0) {
      baseText = html;
      for (const extra of discoverContactUrls(html, url)) {
        if (!visited.has(extra)) queue.push(extra);
      }
    }
    const picked = pickBestFromText(combined, company, `site ${hostOf(url)}`, target, { fullText: true });
    if (picked && (picked.email || picked.phone)) {
      return { ...picked, website: url, html: baseText || combined };
    }
    await sleep(40);
  }
  return { website: pageMatchesCompany(combined, company) && !activityConflictsWithPage(combined, company) && isRealCompanyWebsite(url) ? url : "", html: combined };
}

async function enrichFromSociete(company) {
  // societe.com affiche des teasers dérivés du SIREN : on ne prend JAMAIS le téléphone.
  if (!company.siren) return false;
  const target = `https://www.societe.com/societe/${slugify(company.name)}-${company.siren}.html`;
  try {
    const markdown = await fetchViaJina(target);
    if (!markdown || markdown.length < 200) return false;
    if (!markdown.includes(company.siren) && !pageMatchesCompany(markdown, company)) return false;
    const emails = extractEmails(markdown).filter((e) => !/@societe\.com$/i.test(e));
    if (emails[0]) {
      applyContact(company, {
        email: emails[0],
        phone: "",
        source: "societe.com (e-mail)",
        confidence: "medium"
      });
      return true;
    }
  } catch {
    // societe.com might block Jina
  }
  return false;
}

async function enrichFromDirectorSearch(company) {
  const director = (company.directors || [])[0];
  if (!director || director.length < 4) return false;
  const query = `"${director}" "${searchName(company)}" email OR téléphone OR contact ${company.city || ""}`;
  const target = `https://search.brave.com/search?q=${encodeURIComponent(query)}`;
  let markdown = "";
  try {
    markdown = await fetchViaJina(target);
  } catch {
    return false;
  }
  if (!pageMatchesCompany(markdown, company) && !markdown.toLowerCase().includes(searchName(company).toLowerCase())) {
    return false;
  }
  const allEmails = extractEmails(markdown);
  const allPhones = extractPhones(markdown).filter((p) => phoneFitsCompany(p, company));
  const dirTokens = tokenize(director).filter((t) => t.length >= 3);
  const companyTokens = tokenize(searchName(company)).filter((t) => t.length >= 3);
  const relevantEmails = allEmails.filter((e) => {
    const [local = "", domain = ""] = e.split("@");
    const dirHit = dirTokens.some((t) => local.includes(t));
    const companyHit = companyTokens.some((t) => local.includes(t) || domain.includes(t));
    // Refuse les domaines clairement d'une autre activité / marque.
    if (/couture|avocat|notaire|immobilier|assurance|banque|clinique|docteur/.test(domain) && !companyHit) {
      return false;
    }
    return (dirHit && companyHit) || (companyHit && dirHit);
  });
  if (relevantEmails[0] || (allPhones[0] && dirTokens.some((t) => markdown.toLowerCase().includes(t)))) {
    applyContact(company, {
      email: relevantEmails[0] || "",
      phone: allPhones[0] || "",
      source: "recherche dirigeant (snippet public)",
      confidence: relevantEmails[0] && allPhones[0] ? "high" : "medium"
    });
    return true;
  }
  return false;
}

async function enrichFromPappers(company) {
  // Pappers publie des numéros teaser (0 + SIREN[2..] + 00) : téléphone interdit.
  if (!company.siren) return false;
  const target = `https://www.pappers.fr/entreprise/${company.siren}`;
  try {
    const markdown = await fetchViaJina(target);
    if (!markdown || markdown.length < 150) return false;
    if (!pageMatchesCompany(markdown, company) && !markdown.includes(company.siren)) return false;
    const emails = extractEmails(markdown).filter((e) => !/@pappers\.fr$/i.test(e));
    if (emails[0]) {
      applyContact(company, {
        email: emails[0],
        phone: "",
        source: "Pappers (e-mail public)",
        confidence: "medium"
      });
      return true;
    }
  } catch {
    // page publique parfois limitée
  }
  return false;
}

async function enrichFromAnnuaireEntreprises(company) {
  if (!company.siren) return false;
  const target = `https://annuaire-entreprises.data.gouv.fr/entreprise/${company.siren}`;
  try {
    const markdown = await fetchViaJina(target);
    if (!markdown || !markdown.includes(company.siren)) return false;
    // L'annuaire officiel n'affiche presque jamais d'e-mail ; on récupère seulement un téléphone s'il est public.
    const phones = extractPhones(markdown).filter((p) => phoneFitsCompany(p, company));
    if (phones[0]) {
      applyContact(company, {
        email: "",
        phone: phones[0],
        source: "Annuaire entreprises (officiel)",
        confidence: "high"
      });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

async function enrichFromPagesJaunes(company) {
  const target = `https://www.pagesjaunes.fr/annuaire/chercherlespros?quoiqui=${encodeURIComponent(searchName(company))}&ou=${encodeURIComponent(company.city || "")}`;
  try {
    const markdown = await fetchViaJina(target);
    if (/aucun résultat/i.test(markdown) || /terme manquant/i.test(markdown)) return false;
    if (!pageMatchesCompany(markdown, company)) {
      return false;
    }
    // Grande ville / homonymes : SIREN obligatoire ; sinon adresse forte + activité cohérente.
    if (!directoryEvidenceOk(markdown, company)) {
      return false;
    }
    const phones = extractPhonesNearEvidence(markdown, company);
    const emails = extractEmails(markdown);
    // Jamais de lien PJ comme « site » entreprise (filtrable aussi par applyContact).
    if (phones[0] || emails[0]) {
      applyContact(company, {
        email: emails[0] || "",
        phone: phones[0] || "",
        website: "",
        source: pageCitesSiren(markdown, company) ? "PagesJaunes (SIREN)" : "PagesJaunes",
        confidence: pageCitesSiren(markdown, company) ? "high" : "medium"
      });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** Directories locaux publics (téléphones souvent publiés même pour jeunes structures). */
async function enrichFromLocalDirectories(company) {
  const name = searchName(company);
  const city = company.city || company.postalCode || "";
  if (!name || name.length < 3) return false;
  const targets = [
    {
      url: `https://www.118712.fr/recherche?what=${encodeURIComponent(name)}&where=${encodeURIComponent(city)}`,
      source: "118712"
    },
    {
      url: `https://www.cylex.fr/france/search/?q=${encodeURIComponent(`${name} ${city}`)}`,
      source: "Cylex"
    },
    {
      url: `https://www.google.com/maps/search/${encodeURIComponent(`${name} ${city} France`)}`,
      source: "Google Maps (public)"
    }
  ];
  for (const target of targets) {
    let text = "";
    try {
      text = await fetchViaJina(target.url);
    } catch {
      continue;
    }
    if (!text || text.length < 80) continue;
    if (!pageMatchesCompany(text, company) && !(company.postalCode && text.includes(company.postalCode))) {
      continue;
    }
    if (!directoryEvidenceOk(text, company)) continue;
    const hit = pickBestFromText(text, company, target.source, target.url, { fullText: false, lenient: false });
    if (hit && (hit.email || hit.phone)) {
      applyContact(company, {
        ...hit,
        website: "",
        source: pageCitesSiren(text, company) ? `${target.source} (SIREN)` : target.source,
        confidence: pageCitesSiren(text, company) ? "high" : "medium"
      });
      return true;
    }
    await sleep(30);
  }
  return false;
}

/** DuckDuckGo HTML direct (sans Jina) — snippets téléphone / e-mail + liens site. */
async function enrichFromDuckDuckGoHtml(company) {
  const queries = [
    `"${searchName(company)}" ${company.city || ""} téléphone OR email OR contact`,
    `"${searchName(company)}" ${company.postalCode || ""} contact`
  ];
  for (const query of queries) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    let html = "";
    try {
      html = await fetchText(url, { timeoutMs: 10000, retries: 1, accept: "text/html" });
    } catch {
      continue;
    }
    if (!html || html.length < 200) continue;
    const hit = pickBestFromText(html, company, "DuckDuckGo (snippet)", url, { fullText: false, lenient: true });
    if (hit && (hit.email || hit.phone)) {
      applyContact(company, {
        ...hit,
        source: "DuckDuckGo (snippet public)",
        confidence: company.postalCode && html.includes(company.postalCode) ? "high" : "medium"
      });
      return true;
    }
    const hrefRe = /uddg=([^&"]+)/g;
    const candidates = [];
    let match;
    while ((match = hrefRe.exec(html))) {
      try {
        const href = decodeURIComponent(match[1]);
        const host = hostOf(href);
        if (!host || isDirectoryHost(href) || isRelayHost(href)) continue;
        if (/duckduckgo\.|google\.|facebook\.|linkedin\.|instagram\.|youtube\./.test(host)) continue;
        if (nameSimilarity(searchName(company), `${host} ${href}`) < 0.18) continue;
        if (!candidates.includes(href)) candidates.push(href);
      } catch {
        // ignore
      }
      if (candidates.length >= 3) break;
    }
    for (const href of candidates.slice(0, 2)) {
      try {
        const scraped = await scrapeWebsiteQuick(href, company);
        if (scraped.email || scraped.phone) {
          applyContact(company, {
            email: scraped.email,
            phone: scraped.phone,
            website: scraped.website || href,
            source: `site ${hostOf(href)}`,
            confidence: scraped.confidence || "medium"
          });
          return true;
        }
        if (scraped.website && isRealCompanyWebsite(scraped.website) && !company.website) {
          company.website = scraped.website;
        }
      } catch {
        // suivant
      }
    }
    await sleep(80);
  }
  return isVerifiedContact(company);
}

async function enrichFromSearch(company) {
  const queries = [
    `${searchName(company)} ${company.city || ""} téléphone email`.trim(),
    `"${searchName(company)}" téléphone email`
  ];
  const seenHref = new Set();
  for (const query of queries) {
    const target = `https://search.brave.com/search?q=${encodeURIComponent(query)}`;
    let markdown = "";
    try {
      markdown = await fetchViaJina(target);
    } catch {
      continue;
    }
    const snippetHit = pickBestFromText(markdown, company, "Brave Search");
    if (snippetHit && (snippetHit.email || snippetHit.phone)) {
      applyContact(company, snippetHit);
      return true;
    }
    const links = parseMarkdownLinks(markdown);
    const candidates = [];
    for (const link of links) {
      if (seenHref.has(link.href)) continue;
      const host = hostOf(link.href);
      if (host.includes("brave.com") || host.includes("search.brave")) continue;
      if (host.includes("linkedin.com") || host.includes("facebook.com") || host.includes("instagram.com")) continue;
      if (isDirectoryHost(link.href) && !link.href.includes("pagesjaunes.fr/pros/")) continue;
      if (isRelayHost(link.href)) continue;
      const score = nameSimilarity(searchName(company), `${link.title} ${link.href}`);
      if (score < 0.2 && !/pagesjaunes\.fr\/pros\//.test(link.href)) continue;
      seenHref.add(link.href);
      candidates.push({ ...link, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    for (const candidate of candidates.slice(0, 2)) {
      if (company.email && company.phone) break;
      try {
        const scraped = await scrapeWebsite(candidate.href, company);
        if (scraped.email || scraped.phone) {
          applyContact(company, {
            email: scraped.email,
            phone: scraped.phone,
            website: scraped.website || candidate.href,
            source: scraped.source || `web ${hostOf(candidate.href)}`,
            confidence: scraped.confidence || "medium"
          });
        } else if (scraped.website && isRealCompanyWebsite(scraped.website) && !company.website) {
          company.website = scraped.website;
        }
      } catch {
        // suivant
      }
      await sleep(80);
    }
    if (company.email || company.phone) return true;
    await sleep(60);
  }
  return Boolean(company.email || company.phone);
}

function buildProposal(company, sender = {}) {
  const who = sender.name || "notre société";
  const director = company.directors[0] ? ` ${company.directors[0]}` : "";
  const activity = company.activity || company.nafLabel || "expertise comptable";
  const subject = `Échange avec ${company.name}`;
  const body = `Bonjour${director ? ` ${director}` : ""},

Je me permets de vous contacter au sujet de ${company.name}.

${who} souhaite échanger avec les cabinets d'expertise comptable de votre secteur afin de présenter une collaboration adaptée à votre activité (${activity}).

${company.address ? `Adresse : ${company.address}` : ""}

Si vous le souhaitez, je vous propose un premier échange de 20 minutes.

Cordialement,
${sender.name || ""}
${sender.email || ""}
${sender.phone || ""}`.replace(/\n{3,}/g, "\n\n").trim();

  const mailto = company.email
    ? `mailto:${encodeURIComponent(company.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : "";
  return { subject, body, mailto };
}

function isVerifiedContact(company) {
  sanitizeCompanyContact(company);
  return Boolean(
    company.contactVerified
    && (company.email || company.phone)
    && company.contactConfidence !== "low"
  );
}

/** Filet final : retire teasers / sites d'annuaire avant publication. */
function sanitizeCompanyContact(company) {
  if (!company) return company;
  if (company.phone) {
    const normalized = normalizeFrPhone(company.phone);
    if (
      !normalized
      || !phoneFitsCompany(normalized, company)
      || isSirenTeaserPhone(normalized, company)
      || sourceForbidsPhone(company.contactSource)
    ) {
      company.phone = "";
    } else {
      company.phone = normalized;
    }
  }
  if (company.email) {
    const emails = extractEmails(company.email);
    company.email = emails[0] || "";
  }
  if (company.website && !isRealCompanyWebsite(company.website)) {
    company.website = "";
  }
  if (!company.email && !company.phone) {
    company.contactVerified = false;
    company.contactConfidence = "none";
    company.contactSource = "";
  }
  return company;
}

function publicCompany(company, sender) {
  sanitizeCompanyContact(company);
  const verified = isVerifiedContact(company);
  const proposal = verified && company.email ? buildProposal(company, sender) : null;
  return {
    name: company.name,
    legalName: company.legalName,
    activity: company.activity,
    naf: company.naf,
    nafLabel: company.nafLabel,
    siren: company.siren,
    createdAt: company.createdAt,
    publishedAt: company.publishedAt,
    address: company.address,
    city: company.city,
    postalCode: company.postalCode,
    department: company.department,
    directors: company.directors,
    email: verified ? (company.email || "") : "",
    phone: verified ? (company.phone || "") : "",
    website: verified && company.website ? company.website : (company.website && isRealCompanyWebsite(company.website) ? company.website : ""),
    contactSource: verified ? (company.contactSource || "") : "",
    contactConfidence: verified ? (company.contactConfidence || "") : "",
    contactVerified: verified,
    hasContact: verified,
    preferredChannel: verified
      ? (company.phone ? "sms" : (company.email ? "mail" : ""))
      : "",
    bodaccUrl: company.bodaccUrl,
    sireneUrl: company.sireneUrl || (company.siren ? `https://annuaire-entreprises.data.gouv.fr/entreprise/${company.siren}` : ""),
    pappersUrl: company.siren ? `https://www.pappers.fr/entreprise/${company.siren}` : "",
    proposal
  };
}

function looksLikeCinemaCompany(company) {
  const naf = String(company.naf || "");
  if (naf.startsWith("59") || naf.startsWith("60")) return true;
  const hay = `${company.activity || ""} ${company.nafLabel || ""} ${company.name || ""}`.toLowerCase();
  return /cin[eé]ma|audiovis|film|tournage|post-?\s*prod|t[eé]l[eé]vision|documentaire|vid[eé]o\s|production\s+(cin|audio)/i.test(hay);
}

/** Directories / pages métier cinéma-audiovisuel (contacts souvent publics). */
async function enrichFromCinemaDirectories(company) {
  if (!looksLikeCinemaCompany(company)) return false;
  const name = searchName(company);
  const city = company.city || "";
  const targets = [
    {
      url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`"${name}" ${city} (unifrance OR "film france" OR cnc OR "société de production") (téléphone OR email OR contact)`)}`,
      source: "recherche filière cinéma"
    },
    {
      url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`site:unifrance.org "${name}"`)}`,
      source: "Unifrance (public)"
    },
    {
      url: `https://www.pagesjaunes.fr/annuaire/chercherlespros?quoiqui=${encodeURIComponent(`${name} production audiovisuelle`)}&ou=${encodeURIComponent(city)}`,
      source: "PagesJaunes audiovisuel"
    }
  ];
  for (const target of targets) {
    let text = "";
    try {
      if (target.url.includes("duckduckgo.com")) {
        text = await fetchText(target.url, { timeoutMs: 10000, retries: 1 });
      } else {
        text = await fetchViaJina(target.url);
      }
    } catch {
      continue;
    }
    if (!text || text.length < 80) continue;
    if (!pageMatchesCompany(text, company) && !(company.siren && text.includes(company.siren))) {
      continue;
    }
    // PagesJaunes filière : mêmes garde-fous SIREN / activité que l'annuaire général.
    if (/pagesjaunes\.fr/i.test(target.url) && !directoryEvidenceOk(text, company)) {
      continue;
    }
    const hit = pickBestFromText(text, company, target.source, target.url, {
      fullText: false,
      lenient: !/pagesjaunes\.fr/i.test(target.url)
    });
    if (hit && (hit.email || hit.phone)) {
      applyContact(company, {
        ...hit,
        website: "",
        source: target.source,
        confidence: pageCitesSiren(text, company) ? "high" : "medium"
      });
      return true;
    }
    // Liens candidats vers le site de la boîte de prod
    const links = [
      ...parseMarkdownLinks(text).map((l) => l.href),
      ...((text.match(/https?:\/\/[^\s"'<>]+/g) || []).map((href) => decodeDuckDuckGoUrl(href)))
    ].filter((href) => {
      const host = hostOf(href);
      if (!host || isDirectoryHost(href) || isRelayHost(href)) return false;
      if (/duckduckgo\.|google\.|facebook\.|linkedin\.|instagram\.|youtube\.|imdb\./.test(host)) return false;
      return nameSimilarity(name, `${host} ${href}`) >= 0.18;
    }).slice(0, 2);
    for (const href of links) {
      try {
        const scraped = await scrapeWebsiteQuick(href, company);
        if (scraped.email || scraped.phone) {
          applyContact(company, {
            email: scraped.email,
            phone: scraped.phone,
            website: scraped.website || href,
            source: `site ${hostOf(href)}`,
            confidence: scraped.confidence || "medium"
          });
          return true;
        }
      } catch {
        // suivant
      }
    }
    await sleep(60);
  }
  return false;
}

async function enrichFromWebSnippets(company) {
  const cinemaBoost = looksLikeCinemaCompany(company)
    ? [
      `"${searchName(company)}" production audiovisuelle téléphone OR email OR contact`,
      `"${searchName(company)}" cinéma OR film contact ${company.city || ""}`
    ]
    : [];
  const queries = [
    ...cinemaBoost,
    `"${searchName(company)}" ${company.city || ""} téléphone OR email OR contact`,
    `"${searchName(company)}" ${company.postalCode || ""} téléphone`,
    (company.directors || [])[0]
      ? `"${(company.directors || [])[0]}" "${searchName(company)}" email OR téléphone`
      : ""
  ].filter(Boolean);
  const engines = [
    (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=fr&num=8`,
    (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`
  ];
  for (const query of queries.slice(0, 2)) {
    for (const build of engines) {
      let markdown = "";
      try {
        markdown = await fetchViaJina(build(query));
      } catch {
        continue;
      }
      if (!markdown || markdown.length < 80) continue;
      const hit = pickBestFromText(markdown, company, "moteur de recherche public", "", { fullText: false });
      if (hit && (hit.email || hit.phone)) {
        applyContact(company, {
          ...hit,
          source: hit.source || "moteur de recherche public",
          confidence: company.postalCode && markdown.includes(company.postalCode) ? "high" : "medium"
        });
        return true;
      }
      // Sites candidats dans les résultats → scrape rapide
      const links = parseMarkdownLinks(markdown)
        .map((l) => l.href)
        .filter((href) => {
          const host = hostOf(href);
          if (!host || isDirectoryHost(href) || isRelayHost(href)) return false;
          if (/google\.|duckduckgo\.|brave\.|bing\.|facebook\.|linkedin\.|instagram\./.test(host)) return false;
          return nameSimilarity(searchName(company), `${host} ${href}`) >= 0.18;
        })
        .slice(0, 2);
      for (const href of links) {
        try {
          const scraped = await scrapeWebsiteQuick(href, company);
          if (scraped.email || scraped.phone) {
            applyContact(company, {
              email: scraped.email,
              phone: scraped.phone,
              website: scraped.website || href,
              source: `site ${hostOf(href)}`,
              confidence: scraped.confidence || "medium"
            });
            return true;
          }
        } catch {
          // suivant
        }
      }
      await sleep(80);
    }
  }
  return isVerifiedContact(company);
}

async function enrichFromOverpass(company) {
  if (!company.latitude || !company.longitude) return false;
  const name = searchName(company).replace(/"/g, "");
  if (!name || name.length < 3) return false;
  const lat = Number(company.latitude);
  const lon = Number(company.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const query = `
    [out:json][timeout:8];
    (
      node(around:250,${lat},${lon})["name"~"${name.split(/\s+/).slice(0, 2).join(".*")}",i]["phone"];
      way(around:250,${lat},${lon})["name"~"${name.split(/\s+/).slice(0, 2).join(".*")}",i]["phone"];
      node(around:250,${lat},${lon})["name"~"${name.split(/\s+/).slice(0, 2).join(".*")}",i]["contact:phone"];
    );
    out tags 8;
  `.replace(/\s+/g, " ").trim();
  try {
    const payload = await fetchJson(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`, {
      timeoutMs: 10000,
      retries: 0
    });
    for (const el of payload.elements || []) {
      const tags = el.tags || {};
      if (nameSimilarity(name, tags.name || "") < 0.4) continue;
      const phone = normalizeFrPhone(tags.phone || tags["contact:phone"] || "");
      const email = extractEmails(tags.email || tags["contact:email"] || "")[0] || "";
      const website = tags.website || tags["contact:website"] || "";
      if ((phone && phoneFitsCompany(phone, company)) || email) {
        applyContact(company, {
          email,
          phone: phone && phoneFitsCompany(phone, company) ? phone : "",
          website,
          source: "OpenStreetMap Overpass",
          confidence: "high"
        });
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let index = 0;
  async function next() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => next()));
  return results;
}

async function enrichCompanyContacts(company, onEvent) {
  onEvent({ type: "status", message: `Recherche de contact v\u00e9rifi\u00e9 — ${company.name}` });
  if (!isGenericCompanyName(company)) {
    // Vagues parallèles : on garde les mêmes sources et filtres, on gagne du temps
    // en interrogeant plusieurs canaux en même temps, puis on s’arrête dès qu’un contact est validé.
    const waves = [
      [enrichFromDomainGuess, enrichFromDuckDuckGoHtml, enrichFromOverpass, enrichFromNominatim],
      [enrichFromCinemaDirectories, enrichFromWebSnippets, enrichFromPagesJaunes, enrichFromLocalDirectories],
      [enrichFromDirectorSearch, enrichFromSearch, enrichFromAnnuaireEntreprises, enrichFromPappers, enrichFromSociete]
    ];
    for (const wave of waves) {
      if (isVerifiedContact(company)) break;
      await Promise.all(
        wave.map(async (step) => {
          if (isVerifiedContact(company)) return;
          try {
            await step(company);
          } catch {
            // source suivante
          }
        })
      );
      sanitizeCompanyContact(company);
    }
  }
  sanitizeCompanyContact(company);
  const published = publicCompany(company);
  onEvent({ type: "contact", siren: company.siren, company: published });
  onEvent({
    type: "status",
    message: published.hasContact
      ? `Contact v\u00e9rifi\u00e9 (${published.contactSource}) pour ${company.name}`
      : `Pas de contact public v\u00e9rifi\u00e9 pour ${company.name}`
  });
  return published;
}

function isWithinCreationWindow(company, maxDays) {
  const raw = company.createdAt || company.publishedAt || "";
  if (!raw) return true;
  const stamp = Date.parse(String(raw).slice(0, 10));
  if (!Number.isFinite(stamp)) return true;
  const ageDays = (Date.now() - stamp) / 86400000;
  return ageDays >= 0 && ageDays <= maxDays;
}

function companyDedupeKey(company) {
  return company.siren || `${company.name}|${company.city}|${company.createdAt}`;
}

async function selectSectorCompanies(sector, zone, limit, sender, onEvent, seenKeys, options = {}) {
  const emitCompanies = options.emitCompanies !== false;
  const skipAgeFilter = options.skipAgeFilter !== false;
  const { total, companies } = await fetchSireneCabinets(sector, zone, limit);
  const localized = companies.filter((company) => matchesZone(company, zone));
  const candidates = [];
  for (const company of localized) {
    if (candidates.length >= Math.max(limit * 2, limit + 8)) break;
    const key = companyDedupeKey(company);
    if (seenKeys.has(key)) continue;
    candidates.push(company);
  }

  onEvent({ type: "status", message: `Contrôle SIRENE / NAF — ${candidates.length} cabinet(s)…` });
  await mapPool(candidates, 6, async (company) => {
    await enrichSirene(company);
  });

  const selected = [];
  for (const company of candidates) {
    if (selected.length >= limit) break;
    const key = companyDedupeKey(company);
    if (seenKeys.has(key)) continue;
    if (!matchesZone(company, zone)) continue;
    if (!skipAgeFilter && options.maxAgeDays && !isWithinCreationWindow(company, options.maxAgeDays)) continue;
    if (!nafMatchesSector(company.naf, sector)) continue;
    const blob = `${company.name} ${company.activity} ${company.nafLabel}`.toLowerCase();
    if ((sector.exclude || []).some((needle) => needle && blob.includes(String(needle).toLowerCase()))) continue;
    seenKeys.add(key);
    selected.push(company);
    if (emitCompanies) {
      onEvent({ type: "company", company: publicCompany(company, sender) });
    }
  }
  return { total, selected };
}

function buildProspectionSummary({
  sector,
  days,
  department,
  zone,
  totalBodacc,
  totalSirene,
  results,
  auto = false,
  daysUsed = null,
  scanned = 0
}) {
  const zoneMeta = zone || null;
  return {
    sector: { id: sector.id, label: sector.label },
    days: "all",
    daysUsed: null,
    auto,
    department: zoneMeta && zoneMeta.department ? zoneMeta.department : (department || null),
    zone: zoneMeta ? { id: zoneMeta.id, label: zoneMeta.label, type: zoneMeta.type } : null,
    totalBodacc: totalBodacc || 0,
    totalSirene: totalSirene || totalBodacc || 0,
    scanned,
    found: results.length,
    withContact: results.filter((row) => row.hasContact).length,
    sources: CONTACT_SOURCES.map((row) => `${row.name} — ${row.role}`),
    note: `${sector.label} — villes d’Île-de-France, toutes dates. Contacts publics vérifiés (double contrôle). Tél. Pappers/Societe.com exclus.`
  };
}

async function runProspectionAuto(params, onEvent, sector, zone, sender) {
  const targetContacts = Math.min(40, Math.max(5, Number(params.targetContacts) || 15));
  const perStep = Math.min(30, Math.max(10, Number(params.limit) || 25));
  const seenKeys = new Set();
  const withContact = [];
  const usedPhones = new Set();
  const usedEmails = new Set();
  let totalSirene = 0;
  let scanned = 0;

  const emitProgress = (percent, label) => {
    onEvent({ type: "progress", percent: Math.max(0, Math.min(100, Math.round(percent))), label });
  };

  const zoneLabel = zone && zone.id !== "france" ? ` · ${zone.label}` : "";
  emitProgress(4, `Cabinets d’expertise comptable${zoneLabel}`);
  onEvent({
    type: "status",
    message: `Recherche SIRENE — cabinets NAF 69.20Z${zoneLabel}, toutes dates (objectif ${targetContacts} contacts).`
  });

  const rounds = 3;
  for (let stepIndex = 0; stepIndex < rounds; stepIndex += 1) {
    if (withContact.length >= targetContacts) break;
    const stepBase = (stepIndex / rounds) * 88;
    emitProgress(stepBase + 2, `Vague ${stepIndex + 1} — recherche de cabinets…`);
    onEvent({
      type: "status",
      message: `Vague ${stepIndex + 1} — ${withContact.length}/${targetContacts} contacts validés…`
    });
    const { total, selected } = await selectSectorCompanies(
      sector,
      zone,
      perStep + stepIndex * 8,
      sender,
      onEvent,
      seenKeys,
      { skipAgeFilter: true, emitCompanies: false, strictNaf: true }
    );
    totalSirene = Math.max(totalSirene, total);
    if (!selected.length) {
      emitProgress(stepBase + 10, `Vague ${stepIndex + 1} — aucun nouveau cabinet`);
      onEvent({ type: "status", message: "Aucun nouveau cabinet dans cette vague." });
      break;
    }
    emitProgress(stepBase + 12, `Vérification de ${selected.length} contacts…`);
    onEvent({
      type: "status",
      message: `Double vérification des contacts (${selected.length} cabinets)…`
    });
    let stepDone = 0;
    await mapPool(selected, 6, async (company) => {
      if (withContact.length >= targetContacts) return;
      scanned += 1;
      await enrichCompanyContacts(company, (event) => {
        if (event.type === "status") onEvent(event);
      });
      // Second passage sanitize (filet final).
      sanitizeCompanyContact(company);
      stepDone += 1;
      const localPct = stepBase + 12 + (stepDone / Math.max(selected.length, 1)) * (88 / rounds - 12);
      const contactBoost = Math.min(8, (withContact.length / targetContacts) * 8);
      emitProgress(
        Math.min(96, localPct + contactBoost),
        `${withContact.length}/${targetContacts} contacts · ${company.name.slice(0, 42)}`
      );
      if (!isVerifiedContact(company)) {
        onEvent({ type: "status", message: `Pas de contact public pour ${company.name}` });
        return;
      }
      if (!nafMatchesSector(company.naf, sector)) {
        onEvent({ type: "status", message: `NAF hors cible ignoré — ${company.name}` });
        return;
      }
      const phoneKey = String(company.phone || "").replace(/\D/g, "");
      const emailKey = String(company.email || "").toLowerCase();
      if (phoneKey && usedPhones.has(phoneKey)) company.phone = "";
      if (emailKey && usedEmails.has(emailKey)) company.email = "";
      if (!company.phone && !company.email) {
        company.contactVerified = false;
        onEvent({ type: "status", message: `Contact doublon ignoré pour ${company.name}` });
        return;
      }
      if (phoneKey && company.phone) usedPhones.add(phoneKey);
      if (emailKey && company.email) usedEmails.add(emailKey);
      const published = publicCompany(company, sender);
      if (!published.hasContact) return;
      withContact.push(company);
      onEvent({ type: "company", company: published });
      onEvent({ type: "contact", siren: published.siren, company: published });
      onEvent({
        type: "status",
        message: `Contact validé — ${published.name} (${published.contactSource || "public"})`
      });
    });
    onEvent({
      type: "status",
      message: `Après vague ${stepIndex + 1} : ${withContact.length} contact(s) validé(s) / ${scanned} scanné(s).`
    });
  }

  const results = withContact
    .map((company) => publicCompany(company, sender))
    .filter((row) => row.hasContact);

  if (!results.length) {
    onEvent({
      type: "status",
      message: "Aucun contact public validé. Essayez une autre ville d’Île-de-France."
    });
  }

  emitProgress(100, results.length ? `${results.length} contact(s) validé(s)` : "Aucun contact validé");
  const summary = buildProspectionSummary({
    sector,
    days: "all",
    department: zone && zone.department,
    zone,
    totalSirene,
    results,
    auto: true,
    scanned
  });
  onEvent({ type: "done", summary, companies: results });
  return { summary, companies: results };
}

async function runProspection(params = {}, onEvent = () => {}) {
  const sector = resolveSector(params.sector || DEFAULT_SECTOR_ID);
  if (!sector) {
    throw new Error("Secteur cabinets d'expertise comptable indisponible.");
  }
  const zone = resolveZone(params.zone || params.department || DEFAULT_CITY_ID);
  const sender = {
    name: String(params.senderName || "").trim(),
    email: String(params.senderEmail || "").trim(),
    phone: String(params.senderPhone || "").trim()
  };
  const daysRaw = String(params.days || "all").trim().toLowerCase();
  const autoMode = daysRaw === "auto"
    || daysRaw === "all"
    || params.mode === "sondage"
    || params.auto === true
    || params.auto === "1"
    || !params.days;

  if (autoMode) {
    return runProspectionAuto(params, onEvent, sector, zone, sender);
  }

  const limit = Math.min(60, Math.max(3, Number(params.limit) || 40));
  const enrichContacts = params.enrichContacts !== false;
  const contactsOnly = params.contactsOnly === true || params.contactsOnly === "1";

  const zoneLabel = zone && zone.id !== "france" ? ` · ${zone.label}` : "";
  onEvent({
    type: "status",
    message: `Recherche SIRENE — cabinets d’expertise comptable (NAF 69.20Z), toutes dates${zoneLabel}.`
  });

  const seenKeys = new Set();
  const { total, selected } = await selectSectorCompanies(
    sector,
    zone,
    limit,
    sender,
    onEvent,
    seenKeys,
    { skipAgeFilter: true, emitCompanies: true }
  );
  onEvent({
    type: "status",
    message: `${total} cabinets SIRENE, ${selected.length} retenus après filtre NAF / zone${zoneLabel || " (France)"}.`
  });

  if (!selected.length) {
    onEvent({
      type: "status",
      message: "Aucun résultat avec ces filtres. Essayez une autre ville d’Île-de-France."
    });
  }

  if (enrichContacts && selected.length) {
    onEvent({
      type: "status",
      message: `Double vérification des contacts (${selected.length} cabinets)…`
    });
    await mapPool(selected, 6, async (company) => {
      await enrichCompanyContacts(company, onEvent);
      sanitizeCompanyContact(company);
    });
  }

  let results = selected
    .filter((company) => nafMatchesSector(company.naf, sector))
    .map((company) => publicCompany(company, sender));
  if (contactsOnly) {
    results = results.filter((row) => row.hasContact);
  }
  const summary = buildProspectionSummary({
    sector,
    days: "all",
    department: zone && zone.department,
    zone,
    totalSirene: total,
    results,
    scanned: selected.length
  });
  onEvent({ type: "done", summary, companies: results });
  return { summary, companies: results };
}

function createProspectionRouter() {
  const router = express.Router();

  router.get("/sectors", (_req, res) => {
    res.json({ sectors: listSectors() });
  });

  router.get("/zones", (_req, res) => {
    res.json({ zones: listZones() });
  });

  router.get("/sources", (_req, res) => {
    res.json({ sources: listContactSources() });
  });

  router.post("/search", async (req, res) => {
    try {
      const result = await runProspection(req.body || {});
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Recherche impossible" });
    }
  });

  router.get("/stream", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    // Heartbeat pour empêcher les proxies de couper / bufferiser le flux.
    const heartbeat = setInterval(() => {
      try {
        res.write(`: ping ${Date.now()}\n\n`);
        if (typeof res.flush === "function") res.flush();
      } catch {
        clearInterval(heartbeat);
      }
    }, 4000);
    req.on("close", () => clearInterval(heartbeat));
    try {
      await runProspection({
        sector: req.query.sector || DEFAULT_SECTOR_ID,
        days: req.query.days || "all",
        limit: req.query.limit,
        department: req.query.department,
        zone: req.query.zone || req.query.department || DEFAULT_CITY_ID,
        senderName: req.query.senderName,
        senderEmail: req.query.senderEmail,
        senderPhone: req.query.senderPhone,
        enrichContacts: req.query.enrichContacts !== "0",
        targetContacts: req.query.targetContacts,
        mode: req.query.mode,
        auto: req.query.auto,
        contactsOnly: req.query.contactsOnly
      }, (event) => writeSse(res, event));
    } catch (error) {
      writeSse(res, { type: "error", message: error instanceof Error ? error.message : "Recherche impossible" });
    }
    clearInterval(heartbeat);
    res.end();
  });

  return router;
}

module.exports = {
  SECTORS,
  PROSPECT_ZONES,
  CONTACT_SOURCES,
  CABINETS_NAF,
  DEFAULT_SECTOR_ID,
  DEFAULT_CITY_ID,
  createProspectionRouter,
  runProspection,
  listSectors,
  listZones,
  listContactSources,
  resolveSector,
  resolveZone,
  parseBodaccRecord,
  normalizeFrPhone,
  extractEmails,
  extractPhones,
  activityMatchesSector,
  nafMatchesSector,
  matchesZone,
  matchesDepartment,
  nameSimilarity,
  buildProposal,
  decodeDuckDuckGoUrl,
  pageMatchesCompany,
  phoneFitsCompany,
  isSirenTeaserPhone,
  activityConflictsWithPage,
  directoryEvidenceOk,
  sanitizeCompanyContact,
  sourceForbidsPhone,
  companyFromSireneHit,
  searchName,
  isGenericCompanyName,
  enrichFromDomainGuess
};
