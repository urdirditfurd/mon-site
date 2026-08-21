/**
 * Agent de prospection — sources 100 % gratuites, sans clé API.
 * - BODACC (data.gouv / DILA) : créations d'entreprises du jour
 * - API Recherche d'entreprises (annuaire-entreprises) : NAF, dirigeants, adresse
 * - OpenStreetMap Nominatim : téléphone / e-mail / site si le lieu est cartographié
 * - Brave Search + PagesJaunes via le lecteur Jina (gratuit) : contacts publics
 */

const dns = require("dns").promises;
const express = require("express");

const USER_AGENT = "ClipForge-Prospection/1.0 (+https://github.com/urdirditfurd/mon-site)";
const BODACC_URL = "https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records";
const SIRENE_URL = "https://recherche-entreprises.api.gouv.fr/search";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const JINA_PREFIX = "https://r.jina.ai/";
const BODACC_PAGE_SIZE = 100;

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
  "google.com", "www.google.com", "maps.google.com", "privateaser.com", "www.privateaser.com"
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
  "lefigaro.fr", "figaro.fr"
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
  "62.02A": "Conseil en systèmes et logiciels informatiques"
};

const SECTORS = [
  {
    id: "restauration",
    label: "Restauration, cafés, bars",
    nafPrefixes: ["56"],
    keywords: ["restaurant", "pizzeria", "brasserie", "snack", "traiteur", "café", "bar ", "salon de thé", "food truck", "glacier", "crêperie", "restauration rapide"],
    exclude: ["livraison de commandes restaurant", "coursier", "restauration de bien", "restauration d'immeuble", "restauration et/ou", "commerce de gros"]
  },
  {
    id: "btp",
    label: "BTP / artisanat du bâtiment",
    nafPrefixes: ["41", "42", "43"],
    keywords: ["maçonnerie", "plomberie", "électricité", "couverture", "peinture", "rénovation", "construction", "carrelage", "menuiserie", "plâtrerie", "chauffage"],
    exclude: []
  },
  {
    id: "commerce",
    label: "Commerce de détail",
    nafPrefixes: ["47"],
    keywords: ["commerce de détail", "boutique", "magasin", "épicerie", "prêt à porter", "vente au détail"],
    exclude: []
  },
  {
    id: "immobilier",
    label: "Immobilier",
    nafPrefixes: ["68"],
    keywords: ["agence immobilière", "transaction immobilière", "gestion locative", "marchand de biens"],
    exclude: []
  },
  {
    id: "informatique",
    label: "Informatique / digital",
    nafPrefixes: ["62", "63"],
    keywords: ["informatique", "développement web", "logiciel", "numérique", "digital", "application mobile", "sites internet"],
    exclude: []
  },
  {
    id: "conseil",
    label: "Conseil, gestion, juridique",
    nafPrefixes: ["69", "70", "74"],
    keywords: ["conseil", "consulting", "expertise", "audit", "ressources humaines", "cabinet"],
    exclude: []
  },
  {
    id: "sante",
    label: "Santé / médical",
    nafPrefixes: ["86"],
    keywords: ["médical", "dentaire", "infirmier", "kinésith", "ostéopath", "psycholog", "cabinet médical", "orthophon"],
    exclude: []
  },
  {
    id: "beaute",
    label: "Beauté / coiffure",
    nafPrefixes: ["96"],
    keywords: ["coiffure", "esthétique", "salon de coiffure", "onglerie", "institut de beauté", " barbier"],
    exclude: []
  },
  {
    id: "transport",
    label: "Transport / logistique",
    nafPrefixes: ["49", "52"],
    keywords: ["transport", "taxi", "vtc", "déménagement", "logistique", "livraison"],
    exclude: []
  },
  {
    id: "enseignement",
    label: "Formation / enseignement",
    nafPrefixes: ["85"],
    keywords: ["formation", "enseignement", "coaching", "auto-école", "soutien scolaire"],
    exclude: []
  },
  {
    id: "cinema",
    label: "Cinéma / audiovisuel / production",
    nafPrefixes: ["59", "60"],
    keywords: [
      "cinéma", "cinema", "audiovisuel", "audiovisuelle",
      "tournage", "production audiovisuelle", "production cinématographique",
      "production de films", "réalisation de films", "société de production",
      "post-production", "postproduction", "effets spéciaux",
      "distribution de films", "salle de cinéma", "projection cinématographique",
      "documentaire", "studio de production", "captation audiovisuelle",
      "programme de télévision", "production télévisuelle"
    ],
    exclude: ["salle de sport", "fitness", "yoga", "édition de livres", "application mobile"]
  },
  {
    id: "arts",
    label: "Arts, spectacles, sport",
    nafPrefixes: ["90", "93"],
    keywords: ["spectacle", "théâtre", "theatre", "danse", "musique", "concert", "salle de sport", "fitness", "yoga", "artiste"],
    exclude: ["cinéma", "audiovisuel", "production cinématographique"]
  },
  {
    id: "services",
    label: "Services aux entreprises",
    nafPrefixes: ["81", "82"],
    keywords: ["nettoyage", "sécurité", "secrétariat", "services aux entreprises", "paysagiste"],
    exclude: []
  }
];

function buildAllSectorsMeta() {
  const nafPrefixes = [...new Set(SECTORS.flatMap((s) => s.nafPrefixes || []))];
  const keywords = [...new Set(SECTORS.flatMap((s) => s.keywords || []))];
  const exclude = [...new Set(SECTORS.flatMap((s) => s.exclude || []))];
  return {
    id: "tous",
    label: "Tous les secteurs",
    nafPrefixes,
    keywords,
    exclude,
    allSectors: true
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listSectors() {
  return [
    { id: "tous", label: "Tous les secteurs" },
    ...SECTORS.map(({ id, label }) => ({ id, label }))
  ];
}

function resolveSector(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  const lowered = value.toLowerCase();
  if (lowered === "tous" || lowered === "all" || lowered.includes("tous les secteurs")) {
    return buildAllSectorsMeta();
  }
  const byId = SECTORS.find((s) => s.id === value);
  if (byId) return byId;
  const byLabel = SECTORS.find((s) => lowered.includes(s.id) || s.label.toLowerCase().includes(lowered) || s.keywords.some((k) => lowered.includes(k.trim())));
  if (byLabel) {
    return {
      ...byLabel,
      extraKeywords: [value]
    };
  }
  return {
    id: "custom",
    label: value,
    nafPrefixes: [],
    keywords: [value],
    exclude: [],
    extraKeywords: []
  };
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
  const code = String(naf || "");
  if (!code || !(sector.nafPrefixes || []).length) return true;
  return sector.nafPrefixes.some((prefix) => code.startsWith(prefix));
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
  if (digits.slice(1, 10) === siren) return true;
  if (digits.slice(0, 9) === siren) return true;
  if (`0${siren.slice(1)}0` === digits) return true;
  if (digits.includes(siren.slice(0, 8))) return true;
  return false;
}

function phoneFitsCompany(phone, company) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length !== 10) return false;
  if (digits.startsWith("08")) return false;
  if (isSirenTeaserPhone(phone, company)) return false;
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

function pageMatchesCompany(text, company) {
  const hay = String(text || "").toLowerCase();
  if (company.siren && hay.includes(company.siren)) return true;
  const city = String(company.city || "").toLowerCase();
  const hugeCities = new Set(["paris", "lyon", "marseille", "toulouse", "lille", "bordeaux", "nantes", "nice", "strasbourg"]);
  const streetTokens = tokenize(company.address).filter((token) => token !== city && !/^\d+$/.test(token) && token !== "rue" && token !== "av" && token !== "avenue" && token !== "bd" && token !== "boulevard" && token !== "chemin" && token !== "place");
  const hasStreet = streetTokens.length >= 2 && streetTokens.filter((token) => hay.includes(token)).length >= 2;
  const hasPlace = Boolean(
    (company.postalCode && hay.includes(String(company.postalCode).toLowerCase()))
    || hasStreet
    || (city && hay.includes(city) && !hugeCities.has(city))
  );
  const nameScore = nameSimilarity(company.name, hay.slice(0, 4000));
  const tokens = tokenize(company.name);
  if (tokens.length <= 1) {
    return hasPlace && nameScore >= 0.99;
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
  if (host.endsWith(".gouv.fr") && host.includes("annuaire")) return true;
  // Bases B2B / data providers / plateformes (téléphone générique fréquent).
  if (/(^|\.)(preqin|crunchbase|pitchbook|bloomberg|reuters|kompass|europages|dnb|creditsafe|ellisphere|privateaser|thefork|lafourchette|tripadvisor|lefigaro)\./.test(host)) {
    return true;
  }
  if (/(^|\.)google\./.test(host) && !/maps\.google\./.test(host)) return true;
  return false;
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
    timeoutMs: 8000,
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
    await sleep(200);
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
    const payload = await fetchJson(url, { timeoutMs: 15000, retries: 3 });
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

function applyContact(company, { email, phone, website, source, confidence }) {
  const level = confidence || "medium";
  const rank = { high: 3, medium: 2, low: 1 };
  const currentRank = rank[company.contactConfidence] || 0;
  const nextRank = rank[level] || 0;
  if (level === "low") {
    // Ne jamais valider un contact conjectural (ex. email MX deviné).
    return;
  }
  if (email && (!company.email || nextRank >= currentRank)) company.email = email;
  if (phone && (!company.phone || nextRank >= currentRank)) company.phone = phone;
  if (website && !company.website) company.website = website;
  if ((email || phone) && nextRank >= currentRank) {
    company.contactSource = source;
    company.contactConfidence = level;
    company.contactVerified = level === "high" || level === "medium";
  }
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
  return { website: pageMatchesCompany(combined, company) ? url : "" };
}

function pickBestFromText(text, company, source, href = "", options = {}) {
  if (!options.lenient && !pageMatchesCompany(text, company)) return null;
  if (options.lenient && nameSimilarity(company.name, String(text || "").slice(0, 6000)) < 0.2) return null;
  const hay = String(text || "");
  const lowered = hay.toLowerCase();
  const tokens = tokenize(searchName(company)).sort((a, b) => b.length - a.length);
  const needle = tokens[0] || "";
  const idx = needle ? lowered.indexOf(needle) : 0;
  const sample = options.fullText
    ? hay
    : (idx >= 0 ? hay.slice(Math.max(0, idx - 120), idx + 900) : hay.slice(0, 1800));
  const relayPage = /2,99\s*€|mise en relation|n'est pas le numéro du destinataire/i.test(sample) || isRelayHost(href);
  const emails = extractEmails(sample);
  const phones = (relayPage ? [] : extractPhones(sample)).filter((phone) => phoneFitsCompany(phone, company));
  if (!emails.length && !phones.length) return null;
  return {
    email: emails[0] || "",
    phone: phones[0] || "",
    source,
    confidence: company.postalCode && sample.includes(company.postalCode) ? "high" : "medium"
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
    await sleep(150);
  }
  return { website: pageMatchesCompany(combined, company) ? url : "", html: combined };
}

async function enrichFromSociete(company) {
  if (!company.siren) return false;
  const target = `https://www.societe.com/societe/${slugify(company.name)}-${company.siren}.html`;
  try {
    const markdown = await fetchViaJina(target);
    if (!markdown || markdown.length < 200) return false;
    const phones = extractPhones(markdown).filter((p) => phoneFitsCompany(p, company));
    const emails = extractEmails(markdown);
    if (phones[0] || emails[0]) {
      applyContact(company, {
        email: emails[0] || "",
        phone: phones[0] || "",
        source: "societe.com",
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
  if (!company.siren) return false;
  const target = `https://www.pappers.fr/entreprise/${company.siren}`;
  try {
    const markdown = await fetchViaJina(target);
    if (!markdown || markdown.length < 150) return false;
    if (!pageMatchesCompany(markdown, company) && !markdown.includes(company.siren)) return false;
    const phones = extractPhones(markdown).filter((p) => phoneFitsCompany(p, company));
    const emails = extractEmails(markdown);
    if (phones[0] || emails[0]) {
      applyContact(company, {
        email: emails[0] || "",
        phone: phones[0] || "",
        website: target,
        source: "Pappers (page publique)",
        confidence: phones[0] ? "high" : "medium"
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
        website: target,
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
    const phones = extractPhones(markdown).filter((phone) => phoneFitsCompany(phone, company));
    const emails = extractEmails(markdown);
    const links = parseMarkdownLinks(markdown)
      .map((l) => l.href)
      .filter((href) => href.includes("pagesjaunes.fr/pros/"));
    if (phones[0] || emails[0]) {
      applyContact(company, {
        email: emails[0] || "",
        phone: phones[0] || "",
        website: links[0] || "",
        source: "PagesJaunes",
        confidence: "medium"
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
    const hit = pickBestFromText(text, company, target.source, target.url, { fullText: false, lenient: true });
    if (hit && (hit.email || hit.phone)) {
      applyContact(company, {
        ...hit,
        source: target.source,
        confidence: company.postalCode && text.includes(company.postalCode) ? "high" : "medium"
      });
      return true;
    }
    await sleep(60);
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
        if (scraped.website && !company.website) company.website = scraped.website;
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
        } else if (scraped.website && !company.website) {
          company.website = scraped.website;
        }
      } catch {
        // suivant
      }
      await sleep(400);
    }
    if (company.email || company.phone) return true;
    await sleep(400);
  }
  return Boolean(company.email || company.phone);
}

function buildProposal(company, sender = {}) {
  const who = sender.name || "un expert-comptable partenaire";
  const director = company.directors[0] ? ` ${company.directors[0]}` : "";
  const activity = company.activity || company.nafLabel || "votre activité";
  const subject = `Proposition d'accompagnement comptable — ${company.name}`;
  const body = `Bonjour${director ? ` ${director}` : ""},

Félicitations pour la création de ${company.name}${company.createdAt ? ` (${company.createdAt})` : ""}.

Je me permets de vous contacter car les premières semaines d'une entreprise sont décisives pour poser une gestion comptable simple et fiable (facturation, charges, TVA, trésorerie).

${who} peut vous accompagner sur :
- la mise en place de la comptabilité et du prévisionnel
- le suivi mensuel (recettes / dépenses / TVA)
- la préparation des échéances URSSAF, impôts et bulletins si besoin

Activité déclarée : ${activity}
${company.address ? `Adresse : ${company.address}` : ""}

Si vous le souhaitez, je vous propose un premier échange offert de 20 minutes pour faire le point.

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
  return Boolean(
    company.contactVerified
    && (company.email || company.phone)
    && company.contactConfidence !== "low"
  );
}

function publicCompany(company, sender) {
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
    website: company.website || "",
    contactSource: verified ? (company.contactSource || "") : "",
    contactConfidence: verified ? (company.contactConfidence || "") : "",
    contactVerified: verified,
    hasContact: verified,
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
    const hit = pickBestFromText(text, company, target.source, target.url, { fullText: false, lenient: true });
    if (hit && (hit.email || hit.phone)) {
      applyContact(company, {
        ...hit,
        source: target.source,
        confidence: company.postalCode && text.includes(company.postalCode) ? "high" : "medium"
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
    // Ordre optimisé : snippets / annuaires locaux d'abord (souvent le seul signal pour les créations récentes).
    const steps = [
      enrichFromDuckDuckGoHtml,
      enrichFromCinemaDirectories,
      enrichFromWebSnippets,
      enrichFromPagesJaunes,
      enrichFromLocalDirectories,
      enrichFromDomainGuess,
      enrichFromOverpass,
      enrichFromNominatim,
      enrichFromPappers,
      enrichFromSociete,
      enrichFromDirectorSearch,
      enrichFromAnnuaireEntreprises,
      enrichFromSearch
    ];
    for (const step of steps) {
      if (isVerifiedContact(company)) break;
      try {
        await step(company);
      } catch {
        // source suivante
      }
    }
  }
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

async function selectSectorCompanies(sector, days, department, limit, sender, onEvent, seenKeys, options = {}) {
  const maxAgeDays = options.maxAgeDays || days;
  const emitCompanies = options.emitCompanies !== false;
  const { total, companies } = await fetchBodaccCreations(sector, days, department, limit);
  const localized = companies.filter((company) => matchesDepartment(company, department));
  const selected = [];
  for (const company of localized) {
    if (selected.length >= limit) break;
    const key = companyDedupeKey(company);
    if (seenKeys.has(key)) continue;
    onEvent({ type: "status", message: `Enrichissement SIRENE — ${company.name}` });
    await enrichSirene(company);
    await sleep(60);
    if (!matchesDepartment(company, department)) continue;
    if (!isWithinCreationWindow(company, maxAgeDays)) continue;
    if (company.naf && Array.isArray(sector.nafPrefixes) && sector.nafPrefixes.length) {
      const okNaf = sector.nafPrefixes.some((p) => String(company.naf).startsWith(p));
      if (!okNaf) {
        // Sondage auto : NAF strict pour éviter les hors-secteur.
        if (options.strictNaf) continue;
        const okKw = !sector.allSectors && activityMatchesSector(company.activity || company.nafLabel || "", sector);
        if (!okKw) continue;
      }
    }
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
  totalBodacc,
  results,
  auto = false,
  daysUsed = null,
  scanned = 0
}) {
  return {
    sector: { id: sector.id, label: sector.label },
    days: auto ? "auto" : days,
    daysUsed: daysUsed || days,
    auto,
    department: department || null,
    totalBodacc,
    scanned,
    found: results.length,
    withContact: results.filter((row) => row.hasContact).length,
    sources: [
      "BODACC DILA",
      "API Recherche d'entreprises",
      "DuckDuckGo / Google / Brave (snippets publics)",
      "PagesJaunes",
      "118712 / Cylex / Google Maps",
      "Filière cinéma (Unifrance / Film France / CNC — pages publiques)",
      "OpenStreetMap / Overpass",
      "Site officiel",
      "Pappers (page publique)",
      "Societe.com"
    ],
    note: auto
      ? "Sondage auto (< 1 an) : seuls les contacts publics v\u00e9rifi\u00e9s sont list\u00e9s."
      : "Contacts publi\u00e9s uniquement (pas de conjecture MX). LinkedIn non scrap\u00e9 (CGU)."
  };
}

async function runProspectionAuto(params, onEvent, sector, department, sender) {
  const AUTO_STEPS = [30, 60, 90, 180, 365];
  const targetContacts = Math.min(40, Math.max(5, Number(params.targetContacts) || 15));
  const perStep = Math.min(25, Math.max(8, Number(params.limit) || 18));
  const seenKeys = new Set();
  const withContact = [];
  const usedPhones = new Set();
  const usedEmails = new Set();
  let totalBodacc = 0;
  let scanned = 0;
  let daysUsed = AUTO_STEPS[0];

  const emitProgress = (percent, label) => {
    onEvent({ type: "progress", percent: Math.max(0, Math.min(100, Math.round(percent))), label });
  };

  emitProgress(4, `Sondage ${sector.label} — démarrage`);
  onEvent({
    type: "status",
    message: `Sondage auto — ${sector.label} : entreprises < 1 an, contacts publics uniquement (objectif ${targetContacts}).`
  });

  for (let stepIndex = 0; stepIndex < AUTO_STEPS.length; stepIndex += 1) {
    const days = AUTO_STEPS[stepIndex];
    daysUsed = days;
    if (withContact.length >= targetContacts) break;
    const stepBase = (stepIndex / AUTO_STEPS.length) * 88;
    emitProgress(stepBase + 2, `Fenêtre ${days} j — recherche d’entreprises…`);
    onEvent({
      type: "status",
      message: `Fenêtre auto ${days} j — ${withContact.length}/${targetContacts} contacts validés…`
    });
    const { total, selected } = await selectSectorCompanies(
      sector,
      days,
      department,
      perStep,
      sender,
      onEvent,
      seenKeys,
      { maxAgeDays: 365, emitCompanies: false, strictNaf: true }
    );
    totalBodacc = Math.max(totalBodacc, total);
    if (!selected.length) {
      emitProgress(stepBase + 10, `Fenêtre ${days} j — aucune nouvelle, élargissement…`);
      onEvent({ type: "status", message: `Aucune nouvelle entreprise à ${days} j — élargissement…` });
      continue;
    }
    emitProgress(stepBase + 12, `Vérification de ${selected.length} contacts (${days} j)…`);
    onEvent({
      type: "status",
      message: `Vérification des contacts (${selected.length} nouvelles, fenêtre ${days} j)…`
    });
    let stepDone = 0;
    await mapPool(selected, 4, async (company) => {
      if (withContact.length >= targetContacts) return;
      scanned += 1;
      await enrichCompanyContacts(company, (event) => {
        if (event.type === "status") onEvent(event);
      });
      stepDone += 1;
      const localPct = stepBase + 12 + (stepDone / Math.max(selected.length, 1)) * (88 / AUTO_STEPS.length - 12);
      const contactBoost = Math.min(8, (withContact.length / targetContacts) * 8);
      emitProgress(
        Math.min(96, localPct + contactBoost),
        `${withContact.length}/${targetContacts} contacts · ${company.name.slice(0, 42)}`
      );
      if (!isVerifiedContact(company) || !isWithinCreationWindow(company, 365)) {
        onEvent({ type: "status", message: `Pas de contact public pour ${company.name}` });
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
      message: `Après ${days} j : ${withContact.length} contact(s) validé(s) / ${scanned} scanné(s).`
    });
  }

  const results = withContact
    .map((company) => publicCompany(company, sender))
    .filter((row) => row.hasContact);

  if (!results.length) {
    onEvent({
      type: "status",
      message: "Aucun contact public validé sous 1 an. Essayez un autre secteur, « Tous », ou videz le département."
    });
  }

  emitProgress(100, results.length ? `${results.length} contact(s) validé(s)` : "Aucun contact validé");
  const summary = buildProspectionSummary({
    sector,
    days: daysUsed,
    department,
    totalBodacc,
    results,
    auto: true,
    daysUsed,
    scanned
  });
  onEvent({ type: "done", summary, companies: results });
  return { summary, companies: results };
}

async function runProspection(params = {}, onEvent = () => {}) {
  const sector = resolveSector(params.sector);
  if (!sector) {
    throw new Error("Choisissez un secteur d'activité.");
  }
  const department = String(params.department || "").replace(/\D/g, "").slice(0, 3);
  const sender = {
    name: String(params.senderName || "").trim(),
    email: String(params.senderEmail || "").trim(),
    phone: String(params.senderPhone || "").trim()
  };
  const daysRaw = String(params.days || "auto").trim().toLowerCase();
  const autoMode = daysRaw === "auto" || params.mode === "sondage" || params.auto === true || params.auto === "1";

  if (autoMode) {
    return runProspectionAuto(params, onEvent, sector, department, sender);
  }

  const days = Math.min(365, Math.max(7, Number(params.days) || 30));
  const limit = Math.min(60, Math.max(3, Number(params.limit) || 40));
  const enrichContacts = params.enrichContacts !== false;
  const contactsOnly = params.contactsOnly === true || params.contactsOnly === "1";

  const zoneLabel = department ? ` · d\u00e9partement ${department}` : "";
  onEvent({
    type: "status",
    message: `Recherche BODACC — cr\u00e9ations ${sector.label}, ${days} derniers jours${zoneLabel}.`
  });

  const seenKeys = new Set();
  const { total, selected } = await selectSectorCompanies(
    sector,
    days,
    department,
    limit,
    sender,
    onEvent,
    seenKeys,
    { maxAgeDays: days, emitCompanies: true }
  );
  onEvent({
    type: "status",
    message: `${total} annonces BODACC, ${selected.length} entreprises retenues${zoneLabel || " (France)"}.`
  });

  if (!selected.length) {
    onEvent({
      type: "status",
      message: "Aucun r\u00e9sultat avec ces filtres. Passez en \u00ab Auto \u00bb, \u00ab Tous les secteurs \u00bb, ou videz le d\u00e9partement."
    });
  }

  if (enrichContacts && selected.length) {
    onEvent({
      type: "status",
      message: `Recherche parall\u00e8le de contacts v\u00e9rifi\u00e9s (${selected.length} entreprises)…`
    });
    await mapPool(selected, 4, async (company) => {
      await enrichCompanyContacts(company, onEvent);
    });
  }

  let results = selected.map((company) => publicCompany(company, sender));
  if (contactsOnly) {
    results = results.filter((row) => row.hasContact);
  }
  const summary = buildProspectionSummary({
    sector,
    days,
    department,
    totalBodacc: total,
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
        sector: req.query.sector,
        days: req.query.days,
        limit: req.query.limit,
        department: req.query.department,
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
  createProspectionRouter,
  runProspection,
  listSectors,
  resolveSector,
  parseBodaccRecord,
  normalizeFrPhone,
  extractEmails,
  extractPhones,
  activityMatchesSector,
  nameSimilarity,
  buildProposal,
  decodeDuckDuckGoUrl,
  pageMatchesCompany,
  phoneFitsCompany,
  searchName,
  isGenericCompanyName,
  enrichFromDomainGuess
};
