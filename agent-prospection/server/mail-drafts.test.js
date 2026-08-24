const test = require("node:test");
const assert = require("node:assert/strict");
const {
  inferClientFocus,
  buildOutreachMail,
  buildFollowUpMail,
  legalFooter
} = require("../mail-drafts");

test("accroche BTP vs accroche générique", () => {
  const btp = inferClientFocus({
    name: "Cabinet Fergec",
    activity: "Expertise comptable spécialisée bâtiment"
  });
  assert.equal(btp.id, "btp");
  assert.match(btp.hook, /bâtiment/);
  const generic = inferClientFocus({
    name: "Cabinet Dupont",
    activity: "Activités comptables"
  });
  assert.equal(generic.id, "general");
});

test("relance et footer légal obligatoires", () => {
  const company = {
    name: "Segora Expertise et Conseil",
    directors: ["Eric Durand"],
    website: "https://www.segora.fr",
    email: "segora1@example.fr"
  };
  const sender = {
    name: "Qusai Ben Zaied",
    role: "Président",
    company: "Comanjo SAS",
    email: "contact@comanjo.net",
    phone: "07 68 50 77 88",
    siren: "999898745",
    address: "27 rue de la Comète, 92600 Asnières-sur-Seine"
  };
  const outreach = buildOutreachMail(company, sender);
  assert.match(outreach.subject, /Segora/);
  assert.match(outreach.body, /Bonjour Eric/);
  assert.match(outreach.body, /stop/);
  const follow = buildFollowUpMail(company, sender);
  assert.match(follow.subject, /Relance/);
  assert.match(follow.body, /précédent message/);
  const footer = legalFooter(sender, company);
  assert.match(footer, /Répondez « stop » pour ne plus être contacté/);
  assert.match(footer, /SIREN 999 898 745/);
  assert.match(footer, /www\.segora\.fr/);
});

test("corps personnalisé garde l'accroche et le pied légal", () => {
  const mail = buildOutreachMail(
    { name: "Cabinet Fergec", activity: "Expertise comptable bâtiment", website: "https://www.fergec.com" },
    { name: "Qusai Ben Zaied", role: "Président", company: "Comanjo SAS", siren: "999898745" },
    { bodyOverride: "Phrase corps unique TEST_OVERRIDE." }
  );
  assert.match(mail.body, /entreprises du bâtiment/);
  assert.match(mail.body, /TEST_OVERRIDE/);
  assert.equal(mail.body.includes("FEC exporté"), false);
  assert.match(mail.body, /stop/);
  assert.match(mail.body, /www\.fergec\.com/);
});
