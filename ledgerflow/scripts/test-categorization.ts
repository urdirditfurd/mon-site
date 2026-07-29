import assert from "node:assert/strict";
import {
  categorizeTransaction,
  extractMemorableKeyword,
} from "../src/lib/categorization-engine";

const accounts = [
  { id: "a626", number: "626000", label: "Frais postaux et de télécommunications" },
  { id: "a641", number: "641000", label: "Rémunération du personnel" },
  { id: "a671", number: "671000", label: "Charges exceptionnelles" },
  { id: "a606", number: "606000", label: "Achats non stockés" },
];

const rules = [
  {
    id: "r1",
    keyword: "SPOTIFY",
    accountId: "a626",
    priority: 10,
    account: accounts[0],
  },
];

async function main() {
  const byRule = await categorizeTransaction(
    "PRELEVEMENT SPOTIFY",
    -12.99,
    accounts,
    rules,
  );
  assert.equal(byRule.source, "RULE");
  assert.equal(byRule.confidence, 100);
  assert.equal(byRule.accountNumber, "626000");

  const byHeuristic = await categorizeTransaction(
    "VIR URSSAF",
    -1500,
    accounts,
    [],
  );
  assert.equal(byHeuristic.source, "HEURISTIC");
  assert.equal(byHeuristic.accountNumber, "641000");
  assert.ok(byHeuristic.confidence >= 80);

  const byAws = await categorizeTransaction(
    "CARTE CB AMAZON AWS",
    -45.5,
    accounts,
    [],
  );
  assert.equal(byAws.accountNumber, "626000");

  const fallback = await categorizeTransaction(
    "VIR REF 998877 INCONNU",
    450,
    accounts,
    [],
    { enableLlm: false },
  );
  assert.equal(fallback.source, "FALLBACK");
  assert.equal(fallback.accountNumber, "671000");
  assert.equal(fallback.confidence, 30);

  assert.equal(extractMemorableKeyword("PRELEVEMENT SPOTIFY"), "SPOTIFY");

  console.log("categorization-engine OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
