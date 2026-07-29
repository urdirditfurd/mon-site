import assert from "node:assert/strict";
import { suggestMatches } from "../src/lib/reconciliation-engine";

const invoices = [
  {
    id: "inv1",
    number: "F-2026-0101",
    partyName: "DUPONT SARL",
    issueDate: "2026-07-10",
    dueDate: "2026-07-25",
    totalTtc: 3000,
    status: "SENT",
    type: "INVOICE",
  },
  {
    id: "inv2",
    number: "F-2026-0102",
    partyName: "Studio Lumière",
    issueDate: "2026-06-20",
    dueDate: "2026-07-05",
    totalTtc: 2160,
    status: "OVERDUE",
    type: "INVOICE",
  },
];

const high = suggestMatches(
  {
    id: "t1",
    bookingDate: "2026-07-24",
    label: "VIR DUPONT SARL F-2026-0101",
    amount: 3000,
  },
  invoices,
);

assert.ok(high.best);
assert.equal(high.best?.matchId, "inv1");
assert.ok((high.best?.confidence ?? 0) >= 80, `confidence=${high.best?.confidence}`);

const mid = suggestMatches(
  {
    id: "t2",
    bookingDate: "2026-07-08",
    label: "VIREMENT STUDIO LUMIERE",
    amount: 2160,
  },
  invoices,
);
assert.ok(mid.best);
assert.equal(mid.best?.matchId, "inv2");

const none = suggestMatches(
  {
    id: "t3",
    bookingDate: "2026-07-12",
    label: "VIR REF INCONNU",
    amount: 450,
  },
  invoices,
);
assert.equal(none.best, null);

console.log("reconciliation-engine OK");
