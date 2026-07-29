import assert from "node:assert/strict";
import { endOfYear, startOfYear } from "date-fns";
import {
  FEC_COLUMNS,
  buildFecFilename,
  formatFecAmount,
  formatFecDate,
  generateFEC,
  rowsToFecCsv,
  sumFecAmounts,
  type FecRow,
} from "../src/lib/fec-generator";
import { DEMO_COMPANY_ID } from "../src/lib/company";
import { prisma } from "../src/lib/prisma";

function sampleRow(overrides: Partial<FecRow> = {}): FecRow {
  return {
    JournalCode: "VT",
    JournalLib: "Journal des ventes",
    EcritureNum: "F-2026-0001",
    EcritureDate: "20260714",
    CompteNum: "411000",
    CompteLib: "Clients",
    CompAuxNum: "",
    CompAuxLib: "",
    PieceRef: "F-2026-0001",
    PieceDate: "20260702",
    EcritureLib: "Test",
    Debit: "120.00",
    Credit: "0.00",
    EcritureLet: "",
    DateLet: "",
    ValidDate: "20260714",
    Montantdevise: "",
    Idevise: "",
    ...overrides,
  };
}

async function main() {
  assert.equal(FEC_COLUMNS.length, 18);
  assert.equal(formatFecDate(new Date("2026-07-25T12:00:00Z")), "20260725");
  assert.equal(formatFecAmount(45), "45.00");
  assert.equal(formatFecAmount(12.5), "12.50");
  assert.equal(
    buildFecFilename("89245678100034", new Date("2026-12-31")),
    "FEC_89245678100034_20261231.txt",
  );

  const csvUnit = rowsToFecCsv([
    sampleRow(),
    sampleRow({
      CompteNum: "706000",
      CompteLib: "Prestations",
      Debit: "0.00",
      Credit: "100.00",
    }),
    sampleRow({
      CompteNum: "445710",
      CompteLib: "TVA collectée",
      Debit: "0.00",
      Credit: "20.00",
    }),
  ]);
  const lines = csvUnit.trim().split("\n");
  assert.equal(lines[0], FEC_COLUMNS.join(";"));
  assert.equal(lines[0].split(";").length, 18);
  assert.ok(lines[1].includes("411000"));

  const unitTotals = sumFecAmounts([
    sampleRow({ Debit: "120.00", Credit: "0.00" }),
    sampleRow({ Debit: "0.00", Credit: "100.00" }),
    sampleRow({ Debit: "0.00", Credit: "20.00" }),
  ]);
  assert.equal(unitTotals.debit, 120);
  assert.equal(unitTotals.credit, 120);
  assert.equal(unitTotals.balanced, true);

  const start = startOfYear(new Date("2026-01-01"));
  const end = endOfYear(new Date("2026-12-31"));
  const fec = await generateFEC(DEMO_COMPANY_ID, start, end);

  assert.ok(fec.rows.length > 0, "Le FEC doit contenir des écritures seedées");
  assert.equal(fec.csv.split("\n")[0], FEC_COLUMNS.join(";"));
  assert.ok(
    fec.filename.startsWith("FEC_") && fec.filename.endsWith(".txt"),
    `Nom de fichier réglementaire attendu, reçu: ${fec.filename}`,
  );
  assert.ok(
    fec.totals.balanced,
    `Débit (${fec.totals.debit}) ≠ Crédit (${fec.totals.credit})`,
  );

  for (const row of fec.rows) {
    assert.equal(Object.keys(row).length >= 18, true);
    assert.match(row.EcritureDate, /^\d{8}$/);
    assert.match(row.PieceDate, /^\d{8}$/);
    assert.match(row.Debit, /^\d+\.\d{2}$/);
    assert.match(row.Credit, /^\d+\.\d{2}$/);
    assert.ok(!row.Debit.includes(","));
    assert.ok(!row.Credit.includes(","));
  }

  const journals = new Set(fec.rows.map((r) => r.JournalCode));
  assert.ok(journals.has("VT"), "Journal VT attendu (factures payées)");
  assert.ok(journals.has("AC"), "Journal AC attendu (notes de frais)");
  assert.ok(journals.has("BQ"), "Journal BQ attendu (banque)");

  console.log(
    `fec OK · ${fec.rows.length} lignes · débit=${fec.totals.debit.toFixed(2)} crédit=${fec.totals.credit.toFixed(2)} · ${fec.filename}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
