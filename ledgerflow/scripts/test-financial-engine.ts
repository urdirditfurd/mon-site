import assert from "node:assert/strict";
import {
  estimateVatFromTtc,
  getDashboardSnapshot,
  isVatDeductibleChargeAccount,
} from "../src/lib/financial-engine";
import { prisma } from "../src/lib/prisma";

async function main() {
  assert.equal(estimateVatFromTtc(45.5), 7.58);
  assert.equal(estimateVatFromTtc(12.99), 2.17);
  assert.equal(isVatDeductibleChargeAccount("626000"), true);
  assert.equal(isVatDeductibleChargeAccount("671000"), false);

  const snap = await getDashboardSnapshot("month");
  assert.ok(snap.cashflow.currentBalance >= 0);
  assert.ok(Array.isArray(snap.vatHistory) && snap.vatHistory.length === 3);
  assert.ok(snap.receivables.count >= 0);
  assert.equal(typeof snap.vat.collected, "number");
  assert.equal(typeof snap.vat.deductible, "number");

  console.log(
    `dashboard OK · trésorerie ${snap.cashflow.currentBalance} · TVA ${snap.vat.balance} · créances ${snap.receivables.total}`,
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
