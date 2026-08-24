const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseBodaccRecord,
  normalizeFrPhone,
  extractEmails,
  extractPhones,
  activityMatchesSector,
  resolveSector,
  nameSimilarity,
  buildProposal,
  decodeDuckDuckGoUrl,
  pageMatchesCompany,
  phoneFitsCompany,
  isSirenTeaserPhone,
  listSectors,
  sanitizeCompanyContact,
  sourceForbidsPhone
} = require("./prospection-agent");

test("normalise les téléphones français et ignore les numéros surtaxés", () => {
  assert.equal(normalizeFrPhone("+33 1 64 21 02 02"), "01 64 21 02 02");
  assert.equal(normalizeFrPhone("06.12.34.56.78"), "06 12 34 56 78");
  assert.equal(normalizeFrPhone("0895853832"), "");
  assert.equal(normalizeFrPhone("0875548900"), ""); // teaser 08 / Pappers
  assert.equal(normalizeFrPhone("09 99 99 99 77"), "");
  assert.equal(normalizeFrPhone("01 23 45 67 89"), "");
});

test("rejette un téléphone teaser dérivé du SIREN", () => {
  const company = { department: "14", siren: "108755489" };
  assert.equal(phoneFitsCompany("02 31 68 53 35", company), true);
  assert.equal(phoneFitsCompany("08 75 54 89 00", company), false);
  assert.equal(phoneFitsCompany("0875548900", company), false);
});

test("rejette tous les teasers Pappers signalés (cinéma Paris)", () => {
  const cases = [
    ["NATISTORY MEDIA", "107935108", "07 93 51 08 00"],
    ["HERITAGE CORP", "107413627", "07 41 36 27 00"],
    ["OSBC PROD", "107684813", "07 68 48 13 00"],
    ["Louboutin Simon", "107569964", "07 56 99 64 00"],
    ["CULTURE RAPIDE", "107463853", "07 46 38 53 00"],
    ["SATOSHI PRAKASH CRUZ", "107541567", "07 54 15 67 00"],
    ["JUICE PROD", "107630113", "07 63 01 13 00"]
  ];
  for (const [name, siren, phone] of cases) {
    const company = { name, siren, department: "75", city: "Paris" };
    assert.equal(isSirenTeaserPhone(phone, company), true, `${name} teaser`);
    assert.equal(phoneFitsCompany(phone, company), false, `${name} fits`);
  }
  // Vrai mobile hors motif SIREN
  assert.equal(phoneFitsCompany("06 89 89 83 10", { siren: "107552028", department: "75" }), true);
});

test("Pappers / societe.com interdisent le téléphone même si fourni", () => {
  assert.equal(sourceForbidsPhone("Pappers (page publique)"), true);
  assert.equal(sourceForbidsPhone("societe.com"), true);
  assert.equal(sourceForbidsPhone("site trajectoire360.fr"), false);
  const company = {
    siren: "107935108",
    department: "75",
    phone: "07 93 51 08 00",
    email: "",
    contactSource: "Pappers (page publique)",
    contactVerified: true,
    contactConfidence: "medium"
  };
  sanitizeCompanyContact(company);
  assert.equal(company.phone, "");
  assert.equal(company.contactVerified, false);
});

test("CULTURE RAPIDE — homonyme Paris sans adresse rejetée", () => {
  const culture = {
    name: "CULTURE RAPIDE",
    siren: "107463853",
    city: "Paris",
    postalCode: "75020",
    address: "103 Rue Julien Lacroix 75020 Paris",
    department: "75",
    naf: "5920Z",
    activity: "Production audiovisuelle"
  };
  assert.equal(
    pageMatchesCompany("Culture Rapide Paris téléphone café bar cocktail", culture),
    false
  );
  assert.equal(
    pageMatchesCompany("Culture Rapide 75020 Paris Rue Julien Lacroix", culture),
    true
  );
  assert.equal(
    pageMatchesCompany(`Culture Rapide SIREN ${culture.siren}`, culture),
    true
  );
});

test("CULTURE RAPIDE — fiche café même adresse rejetée sans SIREN", () => {
  const { activityConflictsWithPage, directoryEvidenceOk } = require("./prospection-agent");
  const culture = {
    name: "CULTURE RAPIDE",
    siren: "107463853",
    city: "Paris",
    postalCode: "75020",
    address: "103 Rue Julien Lacroix 75020 Paris",
    department: "75",
    naf: "5920Z",
    activity: "création production édition œuvres audiovisuelles"
  };
  const pjCafe = `
### Culture Rapide
103 rue Julien Lacroix 75020 Paris
terrasse · concert · bar à bière
Dans l'activité **Cafés, bars**, ces résultats peuvent vous intéresser
tél 06 63 00 00 10
`;
  assert.equal(activityConflictsWithPage(pjCafe, culture), true);
  assert.equal(directoryEvidenceOk(pjCafe, culture), false);
  assert.equal(directoryEvidenceOk(`${pjCafe}\nSIREN ${culture.siren}`, culture), true);
  assert.equal(
    directoryEvidenceOk(`Culture Rapide SIREN ${culture.siren} 103 rue Julien Lacroix 75020 production audiovisuelle`, culture),
    true
  );
});

test("JUICE PROD — teaser Pappers filtré", () => {
  const juice = {
    name: "JUICE PROD",
    siren: "107630113",
    department: "75",
    city: "Paris",
    postalCode: "75002"
  };
  assert.equal(isSirenTeaserPhone("07 63 01 13 00", juice), true);
  assert.equal(phoneFitsCompany("07 63 01 13 00", juice), false);
});

test("extrait e-mails utiles et filtre les faux positifs", () => {
  const text = "Contact: hello@creole-avenue.fr photo.png@cdn.com user@sentry.io";
  assert.deepEqual(extractEmails(text), ["hello@creole-avenue.fr"]);
});

test("filtre l'activité cabinets et exclut le médical / juridique", () => {
  const sector = resolveSector("cabinets-comptables");
  assert.equal(activityMatchesSector("Expertise comptable", sector), true);
  assert.equal(activityMatchesSector("Cabinet comptable fiduciaire", sector), true);
  assert.equal(activityMatchesSector("cabinet médical généraliste", sector), false);
  assert.equal(activityMatchesSector("avocat droit des sociétés", sector), false);
});

test("secteurs de la branche juridique / finance", () => {
  const sector = resolveSector("cabinets-comptables");
  assert.equal(sector.id, "cabinets-comptables");
  assert.ok(sector.nafPrefixes.includes("69.20Z"));
  assert.equal(activityMatchesSector("Expertise comptable", sector), true);
  assert.equal(activityMatchesSector("Cabinet médical", sector), false);
  assert.equal(resolveSector("expertise comptable").id, "cabinets-comptables");
  assert.equal(resolveSector("cabinets-avocats").id, "cabinets-avocats");
  assert.equal(resolveSector("avocat").id, "cabinets-avocats");
  assert.equal(resolveSector("juridique").id, "juridique");
  assert.equal(resolveSector("finance").id, "finance");
  assert.equal(resolveSector("banque").id, "finance");
  assert.equal(resolveSector("conseil-gestion").id, "conseil-gestion");
  assert.equal(resolveSector("cinema").id, "cabinets-comptables");
});

test("NAF exact — 69.20Z accepté, 69.10Z (juridique) rejeté pour les cabinets", () => {
  const { nafMatchesSector } = require("./prospection-agent");
  const sector = resolveSector("cabinets-comptables");
  assert.equal(nafMatchesSector("69.20Z", sector), true);
  assert.equal(nafMatchesSector("6920Z", sector), true);
  assert.equal(nafMatchesSector("69.10Z", sector), false);
  assert.equal(nafMatchesSector("59.11C", sector), false);
  const avocats = resolveSector("cabinets-avocats");
  assert.equal(nafMatchesSector("69.10Z", avocats), true);
  assert.equal(nafMatchesSector("69.20Z", avocats), false);
  const finance = resolveSector("finance");
  assert.equal(nafMatchesSector("64.19Z", finance), true);
  assert.equal(nafMatchesSector("69.20Z", finance), false);
});

test("zones = villes d'Île-de-France uniquement", () => {
  const { resolveZone, matchesZone, listZones } = require("./prospection-agent");
  const zones = listZones();
  assert.ok(zones.length > 1000);
  assert.equal(zones.some((z) => z.id === "idf"), false);
  assert.equal(zones.some((z) => z.id === "92"), false);
  assert.ok(zones.some((z) => z.id === "city-92004"));
  assert.ok(zones.some((z) => z.label === "Paris"));
  const paris = resolveZone("Paris");
  assert.equal(paris.type, "city");
  assert.equal(paris.label, "Paris");
  assert.equal(matchesZone({ department: "75", postalCode: "75008", city: "Paris" }, paris), true);
  assert.equal(matchesZone({ department: "92", postalCode: "92600", city: "Asnières-sur-Seine" }, paris), false);
  const asnieres = resolveZone("Asnières-sur-Seine");
  assert.equal(asnieres.id, "city-92004");
  assert.equal(matchesZone({ department: "92", postalCode: "92600", city: "ASNIERES-SUR-SEINE" }, asnieres), true);
  assert.equal(matchesZone({ department: "92", postalCode: "92400", city: "Courbevoie" }, asnieres), false);
  const gennevilliers = resolveZone("gennevilliers");
  assert.equal(matchesZone({ department: "92", postalCode: "92230", city: "Gennevilliers" }, gennevilliers), true);
});

test("listSectors expose la branche juridique / finance, défaut comptable", () => {
  const listed = listSectors();
  assert.ok(listed.length >= 5);
  assert.equal(listed[0].id, "cabinets-comptables");
  assert.ok(listed.some((s) => s.id === "cabinets-avocats"));
  assert.ok(listed.some((s) => s.id === "juridique"));
  assert.ok(listed.some((s) => s.id === "finance"));
});

test("parse une annonce BODACC personne morale", () => {
  const record = {
    id: "A1",
    commercant: "SARL ELIA",
    dateparution: "2026-08-16",
    ville: "Paris",
    cp: "75011",
    numerodepartement: "75",
    registre: ["108468380"],
    url_complete: "https://www.bodacc.fr/x",
    listepersonnes: JSON.stringify({
      personne: {
        typePersonne: "pm",
        denomination: "SARL ELIA",
        administration: "Gérant : DUPONT Marie"
      }
    }),
    listeetablissements: JSON.stringify({
      etablissement: {
        activite: "Restaurant pizzeria",
        adresse: { numeroVoie: "12", typeVoie: "Rue", nomVoie: "de Malte", codePostal: "75011", ville: "Paris" }
      }
    }),
    acte: JSON.stringify({ dateCommencementActivite: "2026-08-04" })
  };
  const company = parseBodaccRecord(record);
  assert.equal(company.name, "SARL ELIA");
  assert.equal(company.siren, "108468380");
  assert.equal(company.activity, "Restaurant pizzeria");
  assert.equal(company.city, "Paris");
  assert.equal(company.directors[0], "DUPONT Marie");
  assert.match(company.address, /Malte/);
});

test("similarité de nom et proposition cabinets", () => {
  assert.ok(nameSimilarity("CREOLE AVENUE CHELLES", "Restaurant Creole Avenue Chelles") > 0.6);
  const proposal = buildProposal({
    name: "FIDUCIAIRE SEINE",
    activity: "Activités comptables",
    createdAt: "2015-08-04",
    directors: ["Marie Dupont"],
    address: "12 Rue de Malte 92600 Asnières-sur-Seine",
    email: "contact@fiduciaire-seine.fr"
  }, { name: "Cabinet Dupont & Associés", email: "contact@dupont.fr" });
  assert.match(proposal.subject, /Échange avec FIDUCIAIRE SEINE/);
  assert.match(proposal.body, /cabinets d'expertise comptable/);
  assert.match(proposal.body, /Cabinet Dupont/);
  assert.match(proposal.mailto, /^mailto:contact%40fiduciaire-seine\.fr/);
});

test("décode les liens DuckDuckGo", () => {
  const href = "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.restaurantelia.com%2F&rut=abc";
  assert.equal(decodeDuckDuckGoUrl(href), "https://www.restaurantelia.com/");
});

test("n'associe pas un site homonyme sans la ville", () => {
  const company = { name: "LA MOUSTACHE", city: "Cheille", postalCode: "37190", siren: "108515347" };
  assert.equal(pageMatchesCompany("La Moustache Production contact@lamoustache.fr Paris", company), false);
  assert.equal(pageMatchesCompany("LA MOUSTACHE 8 HAMEAU DE LA BALLIERE 37190 Cheille", company), true);
});

test("reconnaît la marque officielle même si la ville du site diffère", () => {
  const company = {
    name: "LE QG BY KERT",
    city: "Tournan-en-Brie",
    postalCode: "77220",
    address: "Tournan-en-Brie",
    department: "77"
  };
  assert.equal(
    pageMatchesCompany("Salon de coiffure Le QG By Kert à Ozoir-la-Ferrière. Tél 06 17 92 03 42", company),
    true
  );
});

test("un téléphone 05 n'est pas valable pour Paris", () => {
  const company = { department: "75" };
  assert.equal(phoneFitsCompany("05 53 55 31 20", company), false);
  assert.equal(phoneFitsCompany("01 43 21 00 00", company), true);
  assert.equal(phoneFitsCompany("06 12 34 56 78", company), true);
});

test("extrait plusieurs téléphones uniques", () => {
  assert.deepEqual(extractPhones("tél 01 64 21 02 02 ou 0164210202"), ["01 64 21 02 02"]);
});

test("nettoie le nom de recherche et ignore les noms trop génériques", () => {
  const { searchName, isGenericCompanyName } = require("./prospection-agent");
  assert.equal(searchName({ name: '"LE QG" BY KERT' }), "LE QG BY KERT");
  assert.equal(isGenericCompanyName({ name: "CF" }), true);
  assert.equal(isGenericCompanyName({ name: "LE QG BY KERT" }), false);
});
