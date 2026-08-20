const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "baypilot-ops-api-"));
process.env.BAYPILOT_ROOT = tmp;
fs.copyFileSync(path.join(__dirname, ".env.example"), path.join(tmp, ".env.example"));

const { app } = require("./operator-server");

let failed = 0;
function check(ok, label) {
  if (!ok) failed += 1;
  console.log(`${ok ? "OK" : "FAIL"}  ${label}`);
}

async function main() {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const health = await fetch(`${base}/api/health`).then((r) => r.json());
    check(health.product === "BayPilot" && health.role === "operator", `health product=${health.product}`);
    check(/ebx/.test(health.note), "health rappelle de ne pas confondre avec ebx");

    const list = await fetch(`${base}/api/clients`).then((r) => r.json());
    check(list.success === true && Array.isArray(list.data), "liste clients");

    const created = await fetch(`${base}/api/clients`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test DFY Local", feeEur: 1800, marketplace: "EBAY_FR" }),
    }).then((r) => r.json());
    check(created.success && created.data.port >= 3101, `client créé port=${created.data?.port}`);

    const report = await fetch(`${base}/api/clients/${created.data.id}/report`).then((r) => r.json());
    check(report.success && report.data.paymentNeverAutonomous === true, "rapport paiement manuel");
    check(report.data.onboarding.autoPublishArmed === false, "nouveau client non armé");

    const html = await fetch(`${base}/offre.html`).then((r) => r.text());
    check(html.includes("1 800") && !/ebx\.army/i.test(html), "offre DFY sans marque EBX");
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (failed) {
    console.error(`\n${failed} échec(s)`);
    process.exit(1);
  }
  console.log("Tous les tests operator-api OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
