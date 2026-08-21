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
  listSectors
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

test("JUICE PROD — teaser 0+SIREN[2..]+00 rejeté", () => {
  const juice = {
    name: "JUICE PROD",
    siren: "107630113",
    department: "75",
    city: "Paris",
    postalCode: "75011"
  };
  assert.equal(isSirenTeaserPhone("0763011300", juice), true);
  assert.equal(isSirenTeaserPhone("07 63 01 13 00", juice), true);
  assert.equal(phoneFitsCompany("07 63 01 13 00", juice), false);
  assert.equal(phoneFitsCompany("0763011300", juice), false);
  // Vrai mobile hors SIREN reste accepté.
  assert.equal(phoneFitsCompany("06 12 34 56 78", juice), true);
});

test("CULTURE RAPIDE — homonyme Paris sans adresse rejetée", () => {
  const culture = {
    name: "CULTURE RAPIDE",
    siren: "107463853",
    city: "Paris",
    postalCode: "75020",
    address: "12 Rue des Pyrénées 75020 Paris",
    department: "75"
  };
  assert.equal(
    pageMatchesCompany("Culture Rapide Paris téléphone café bar cocktail", culture),
    false
  );
  assert.equal(
    pageMatchesCompany("Culture Rapide 75020 Paris Rue des Pyrénées", culture),
    true
  );
  assert.equal(
    pageMatchesCompany(`Culture Rapide SIREN ${culture.siren}`, culture),
    true
  );
});

test("extrait e-mails utiles et filtre les faux positifs", () => {
  const text = "Contact: hello@creole-avenue.fr photo.png@cdn.com user@sentry.io";
  assert.deepEqual(extractEmails(text), ["hello@creole-avenue.fr"]);
});

test("filtre l'activité restauration et exclut les livreurs", () => {
  const sector = resolveSector("restauration");
  assert.equal(activityMatchesSector("Restaurant pizzeria", sector), true);
  assert.equal(activityMatchesSector("livraison de commandes restaurants en vélo", sector), false);
});

test("secteur cinéma couvre production audiovisuelle et NAF 59", () => {
  const sector = resolveSector("cinema");
  assert.equal(sector.id, "cinema");
  assert.ok(sector.nafPrefixes.includes("59"));
  assert.ok(sector.nafPrefixes.includes("60"));
  assert.equal(activityMatchesSector("Production cinématographique et audiovisuelle", sector), true);
  assert.equal(activityMatchesSector("Salle de sport et fitness", sector), false);
  const byLabel = resolveSector("cinéma");
  assert.equal(byLabel.id, "cinema");
});

test("secteur tous agrège les NAF de la liste", () => {
  const sector = resolveSector("tous");
  assert.equal(sector.id, "tous");
  assert.equal(sector.allSectors, true);
  assert.ok(sector.nafPrefixes.includes("56"));
  assert.ok(sector.nafPrefixes.includes("59"));
  assert.equal(activityMatchesSector("n'importe quoi", sector), true);
  const listed = listSectors();
  assert.equal(listed[0].id, "tous");
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

test("similarité de nom et proposition comptable", () => {
  assert.ok(nameSimilarity("CREOLE AVENUE CHELLES", "Restaurant Creole Avenue Chelles") > 0.6);
  const proposal = buildProposal({
    name: "SARL ELIA",
    activity: "Restaurant pizzeria",
    createdAt: "2026-08-04",
    directors: ["Marie Dupont"],
    address: "12 Rue de Malte 75011 Paris",
    email: "contact@elia.fr"
  }, { name: "Eva Moreau", email: "eva@cabinet.fr" });
  assert.match(proposal.subject, /accompagnement comptable/);
  assert.match(proposal.body, /gestion comptable/);
  assert.match(proposal.mailto, /^mailto:contact%40elia\.fr/);
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
