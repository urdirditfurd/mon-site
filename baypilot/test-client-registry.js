const fs = require("fs");
const os = require("os");
const path = require("path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "baypilot-reg-"));
process.env.BAYPILOT_ROOT = tmpRoot;
fs.copyFileSync(path.join(__dirname, ".env.example"), path.join(tmpRoot, ".env.example"));

const registry = require("./client-registry");

let failed = 0;
function check(ok, label) {
  if (!ok) failed += 1;
  console.log(`${ok ? "OK" : "FAIL"}  ${label}`);
}

check(registry.slugify("Boutique Acmé") === "boutique-acme", `slug=${registry.slugify("Boutique Acmé")}`);

const a = registry.createClient({ name: "Boutique Acmé", email: "a@test.fr", feeEur: 1800, marketplace: "EBAY_FR" });
check(a.id === "boutique-acme" && a.port === 3101, `client A id=${a.id} port=${a.port}`);
check(fs.existsSync(path.join(tmpRoot, "clients", a.id, ".env")), ".env client créé");
check(fs.existsSync(path.join(tmpRoot, "clients", a.id, "data", "ops.json")), "ops.json créé");
const ops = JSON.parse(fs.readFileSync(path.join(tmpRoot, "clients", a.id, "data", "ops.json"), "utf8"));
check(ops.onboarding.autoPublishArmed === false, "nouveau client : Auto-Publish désarmé");

const b = registry.createClient({ name: "Boutique Acmé", marketplace: "EBAY_DE" });
check(b.id === "boutique-acme-2" && b.port === 3102, `collision slug+port → ${b.id} ${b.port}`);

const eco = fs.readFileSync(path.join(tmpRoot, "ecosystem.config.cjs"), "utf8");
check(eco.includes("baypilot-ops") && eco.includes("baypilot-boutique-acme"), "ecosystem PM2");
check(!/"name": "ebx"/.test(eco), "aucun process ebx dans l'ecosystem");

const updated = registry.updateClient(a.id, { status: "active", feeEur: 2200 });
check(updated.status === "active" && updated.feeEur === 2200, "update client");
check(registry.listClients().length === 2, "2 clients au registre");

try {
  registry.createClient({ name: "" });
  check(false, "nom vide doit throw");
} catch (err) {
  check(/nom client/.test(err.message), "nom vide rejeté");
}

fs.rmSync(tmpRoot, { recursive: true, force: true });

if (failed) {
  console.error(`\n${failed} échec(s)`);
  process.exit(1);
}
console.log("Tous les tests client-registry OK");
