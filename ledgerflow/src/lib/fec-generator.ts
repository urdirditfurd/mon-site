import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { DEMO_COMPANY_ID, ensureDemoCompany } from "@/lib/company";

/** Les 18 colonnes obligatoires du FEC (art. A47 A-1 du LPF). */
export const FEC_COLUMNS = [
  "JournalCode",
  "JournalLib",
  "EcritureNum",
  "EcritureDate",
  "CompteNum",
  "CompteLib",
  "CompAuxNum",
  "CompAuxLib",
  "PieceRef",
  "PieceDate",
  "EcritureLib",
  "Debit",
  "Credit",
  "EcritureLet",
  "DateLet",
  "ValidDate",
  "Montantdevise",
  "Idevise",
] as const;

export type FecColumn = (typeof FEC_COLUMNS)[number];

export interface FecRow {
  JournalCode: string;
  JournalLib: string;
  EcritureNum: string;
  EcritureDate: string;
  CompteNum: string;
  CompteLib: string;
  CompAuxNum: string;
  CompAuxLib: string;
  PieceRef: string;
  PieceDate: string;
  EcritureLib: string;
  Debit: string;
  Credit: string;
  EcritureLet: string;
  DateLet: string;
  ValidDate: string;
  Montantdevise: string;
  Idevise: string;
}

export interface FecExportResult {
  companyId: string;
  companyName: string;
  siret: string;
  startDate: Date;
  endDate: Date;
  rows: FecRow[];
  filename: string;
  csv: string;
  totals: { debit: number; credit: number; balanced: boolean };
}

const JOURNAL = {
  VT: { code: "VT", lib: "Journal des ventes" },
  AC: { code: "AC", lib: "Journal des achats" },
  BQ: { code: "BQ", lib: "Journal de banque" },
} as const;

const FALLBACK_ACCOUNTS = {
  bank: { number: "512000", label: "Banque" },
  customers: { number: "411000", label: "Clients" },
  suppliers: { number: "401000", label: "Fournisseurs" },
  revenue: { number: "706000", label: "Prestations de services" },
  vatCollected: { number: "445710", label: "TVA collectée" },
  vatDeductible: { number: "445660", label: "TVA déductible" },
  charges: { number: "625000", label: "Déplacements, missions et réceptions" },
} as const;

function toNumber(
  value: { toNumber?: () => number } | number | string | null | undefined,
): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value.toNumber === "function") return value.toNumber();
  return Number(value) || 0;
}

/** Format réglementaire AAAAMMJJ. */
export function formatFecDate(date: Date): string {
  return format(date, "yyyyMMdd");
}

/** Montant FEC : point décimal, 2 décimales. */
export function formatFecAmount(value: number): string {
  const n = Number.isFinite(value) ? Math.abs(value) : 0;
  return n.toFixed(2);
}

function emptyRow(partial: Partial<FecRow> & Pick<
  FecRow,
  | "JournalCode"
  | "JournalLib"
  | "EcritureNum"
  | "EcritureDate"
  | "CompteNum"
  | "CompteLib"
  | "PieceRef"
  | "PieceDate"
  | "EcritureLib"
  | "Debit"
  | "Credit"
  | "ValidDate"
>): FecRow {
  return {
    CompAuxNum: "",
    CompAuxLib: "",
    EcritureLet: "",
    DateLet: "",
    Montantdevise: "",
    Idevise: "",
    ...partial,
  };
}

type FecLineBase = {
  JournalCode: string;
  JournalLib: string;
  EcritureNum: string;
  EcritureDate: string;
  PieceRef: string;
  PieceDate: string;
  EcritureLib: string;
  ValidDate: string;
  CompAuxNum?: string;
  CompAuxLib?: string;
  EcritureLet?: string;
  DateLet?: string;
  Montantdevise?: string;
  Idevise?: string;
};

function pushBalancedPair(
  rows: FecRow[],
  base: FecLineBase,
  debit: { number: string; label: string; amount: number; auxNum?: string; auxLib?: string },
  credit: { number: string; label: string; amount: number; auxNum?: string; auxLib?: string },
) {
  if (debit.amount <= 0 && credit.amount <= 0) return;

  rows.push(
    emptyRow({
      ...base,
      CompteNum: debit.number,
      CompteLib: debit.label,
      CompAuxNum: debit.auxNum ?? base.CompAuxNum ?? "",
      CompAuxLib: debit.auxLib ?? base.CompAuxLib ?? "",
      Debit: formatFecAmount(debit.amount),
      Credit: "0.00",
    }),
  );
  rows.push(
    emptyRow({
      ...base,
      CompteNum: credit.number,
      CompteLib: credit.label,
      CompAuxNum: credit.auxNum ?? base.CompAuxNum ?? "",
      CompAuxLib: credit.auxLib ?? base.CompAuxLib ?? "",
      Debit: "0.00",
      Credit: formatFecAmount(credit.amount),
    }),
  );
}

/**
 * Sérialise les lignes FEC en CSV séparateur point-virgule (norme FR Excel).
 * UTF-8, sans BOM (les logiciels modernes l'acceptent ; Excel FR gère le `;`).
 */
export function rowsToFecCsv(rows: FecRow[]): string {
  const header = FEC_COLUMNS.join(";");
  const body = rows.map((row) =>
    FEC_COLUMNS.map((col) => sanitizeCsvCell(row[col] ?? "")).join(";"),
  );
  return [header, ...body].join("\n") + (body.length ? "\n" : "");
}

function sanitizeCsvCell(value: string): string {
  const raw = value ?? "";
  if (/[;\n\r"]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function sumFecAmounts(rows: FecRow[]): {
  debit: number;
  credit: number;
  balanced: boolean;
} {
  let debit = 0;
  let credit = 0;
  for (const row of rows) {
    debit += Number(row.Debit) || 0;
    credit += Number(row.Credit) || 0;
  }
  debit = Math.round(debit * 100) / 100;
  credit = Math.round(credit * 100) / 100;
  return {
    debit,
    credit,
    balanced: Math.abs(debit - credit) < 0.005,
  };
}

export function buildFecFilename(siret: string, endDate: Date): string {
  const clean = (siret || "00000000000000").replace(/\D/g, "").padStart(9, "0");
  return `FEC_${clean}_${formatFecDate(endDate)}.txt`;
}

type AccountRef = { number: string; label: string };

async function loadAccountMap(companyId: string): Promise<{
  byNumber: Map<string, AccountRef>;
  byId: Map<string, AccountRef>;
}> {
  const accounts = await prisma.account.findMany({
    where: { companyId, isActive: true },
    select: { id: true, number: true, label: true },
  });
  const byNumber = new Map<string, AccountRef>();
  const byId = new Map<string, AccountRef>();
  for (const a of accounts) {
    const ref = { number: a.number, label: a.label };
    byNumber.set(a.number, ref);
    byId.set(a.id, ref);
  }
  return { byNumber, byId };
}

function resolveAccount(
  map: Map<string, AccountRef>,
  number: string,
  fallback: AccountRef,
): AccountRef {
  return map.get(number) ?? fallback;
}

function resolveAccountById(
  map: Map<string, AccountRef>,
  accountId: string | null | undefined,
  fallback: AccountRef,
): AccountRef {
  if (!accountId) return fallback;
  return map.get(accountId) ?? fallback;
}

/**
 * Génère le FEC pour une société et une période.
 *
 * Sources validées :
 * - Factures PAID → journal VT (partie double Clients / Produits+TVA)
 * - Notes de frais APPROVED|REIMBURSED → journal AC
 * - Transactions bancaires MATCHED ou catégorisées → journal BQ
 *
 * En production, brancher éventuellement les AccountingEntry validées
 * si le journal général devient la source de vérité unique.
 */
export async function generateFEC(
  companyId: string,
  startDate: Date,
  endDate: Date,
): Promise<FecExportResult> {
  const id = companyId || DEMO_COMPANY_ID;
  await ensureDemoCompany();

  const company = await prisma.company.findUniqueOrThrow({
    where: { id },
  });

  const { byNumber: accountMap, byId: accountById } = await loadAccountMap(id);
  const bank = resolveAccount(accountMap, "512000", FALLBACK_ACCOUNTS.bank);
  const customers = resolveAccount(accountMap, "411000", FALLBACK_ACCOUNTS.customers);
  const suppliers = resolveAccount(accountMap, "401000", FALLBACK_ACCOUNTS.suppliers);
  const revenue = resolveAccount(accountMap, "706000", FALLBACK_ACCOUNTS.revenue);
  const vatCollected = resolveAccount(
    accountMap,
    "445710",
    FALLBACK_ACCOUNTS.vatCollected,
  );
  const vatDeductible = resolveAccount(
    accountMap,
    "445660",
    FALLBACK_ACCOUNTS.vatDeductible,
  );
  const defaultCharge = resolveAccount(
    accountMap,
    "625000",
    FALLBACK_ACCOUNTS.charges,
  );

  const rows: FecRow[] = [];

  // ─── Journal des ventes (factures payées) ─────────────────────────────────
  const invoices = await prisma.invoice.findMany({
    where: {
      companyId: id,
      status: "PAID",
      OR: [
        { paidAt: { gte: startDate, lte: endDate } },
        {
          AND: [
            { paidAt: null },
            { issueDate: { gte: startDate, lte: endDate } },
          ],
        },
      ],
    },
    include: { party: true },
    orderBy: [{ paidAt: "asc" }, { issueDate: "asc" }, { number: "asc" }],
  });

  for (const inv of invoices) {
    const pieceDate = inv.issueDate;
    const ecritureDate = inv.paidAt ?? inv.issueDate;
    const pieceRef = inv.number ?? inv.id;
    const lib =
      inv.notes?.trim() ||
      `Facture ${pieceRef} — ${inv.party.name}`;
    const ht = toNumber(inv.subtotalHt);
    const vat = toNumber(inv.vatAmount);
    const ttc = toNumber(inv.totalTtc);
    const validDate = formatFecDate(inv.paidAt ?? inv.updatedAt);
    const auxNum = inv.party.siret ?? "";
    const auxLib = inv.party.name;

    const base = {
      JournalCode: JOURNAL.VT.code,
      JournalLib: JOURNAL.VT.lib,
      EcritureNum: pieceRef,
      EcritureDate: formatFecDate(ecritureDate),
      PieceRef: pieceRef,
      PieceDate: formatFecDate(pieceDate),
      EcritureLib: lib,
      ValidDate: validDate,
      CompAuxNum: auxNum,
      CompAuxLib: auxLib,
    };

    // Débit clients TTC
    rows.push(
      emptyRow({
        ...base,
        CompteNum: customers.number,
        CompteLib: customers.label,
        Debit: formatFecAmount(ttc),
        Credit: "0.00",
      }),
    );
    // Crédit produits HT
    rows.push(
      emptyRow({
        ...base,
        CompteNum: revenue.number,
        CompteLib: revenue.label,
        CompAuxNum: "",
        CompAuxLib: "",
        Debit: "0.00",
        Credit: formatFecAmount(ht),
      }),
    );
    // Crédit TVA collectée (si > 0)
    if (vat > 0) {
      rows.push(
        emptyRow({
          ...base,
          CompteNum: vatCollected.number,
          CompteLib: vatCollected.label,
          CompAuxNum: "",
          CompAuxLib: "",
          Debit: "0.00",
          Credit: formatFecAmount(vat),
        }),
      );
    }
  }

  // ─── Journal des achats (notes de frais validées) ─────────────────────────
  const expenses = await prisma.expense.findMany({
    where: {
      companyId: id,
      status: { in: ["APPROVED", "REIMBURSED"] },
      expenseDate: { gte: startDate, lte: endDate },
    },
    include: { party: true, account: true },
    orderBy: [{ expenseDate: "asc" }, { createdAt: "asc" }],
  });

  let expenseSeq = 1;
  for (const exp of expenses) {
    const date = exp.expenseDate ?? exp.approvedAt ?? exp.createdAt;
    const pieceRef = `NDF-${formatFecDate(date)}-${String(expenseSeq).padStart(4, "0")}`;
    expenseSeq += 1;
    const vendor = exp.merchantName ?? exp.party?.name ?? "Fournisseur";
    const lib =
      exp.description?.trim() ||
      exp.note?.trim() ||
      `Note de frais ${vendor}`;
    const ttc = toNumber(exp.amountTtc);
    const vat = toNumber(exp.vatAmount);
    const ht =
      toNumber(exp.amountHt) ||
      Math.round((ttc - vat) * 100) / 100 ||
      ttc;
    const charge: AccountRef = exp.account
      ? { number: exp.account.number, label: exp.account.label }
      : defaultCharge;
    const validDate = formatFecDate(exp.approvedAt ?? exp.updatedAt);
    const auxNum = exp.party?.siret ?? "";
    const auxLib = vendor;

    const base = {
      JournalCode: JOURNAL.AC.code,
      JournalLib: JOURNAL.AC.lib,
      EcritureNum: pieceRef,
      EcritureDate: formatFecDate(date),
      PieceRef: pieceRef,
      PieceDate: formatFecDate(date),
      EcritureLib: lib,
      ValidDate: validDate,
      CompAuxNum: auxNum,
      CompAuxLib: auxLib,
    };

    // Débit charge HT
    rows.push(
      emptyRow({
        ...base,
        CompteNum: charge.number,
        CompteLib: charge.label,
        CompAuxNum: "",
        CompAuxLib: "",
        Debit: formatFecAmount(ht),
        Credit: "0.00",
      }),
    );
    if (vat > 0) {
      rows.push(
        emptyRow({
          ...base,
          CompteNum: vatDeductible.number,
          CompteLib: vatDeductible.label,
          CompAuxNum: "",
          CompAuxLib: "",
          Debit: formatFecAmount(vat),
          Credit: "0.00",
        }),
      );
    }
    // Crédit fournisseurs TTC
    rows.push(
      emptyRow({
        ...base,
        CompteNum: suppliers.number,
        CompteLib: suppliers.label,
        Debit: "0.00",
        Credit: formatFecAmount(ttc > 0 ? ttc : ht + vat),
      }),
    );
  }

  // ─── Journal de banque ────────────────────────────────────────────────────
  const bankTxns = await prisma.bankTransaction.findMany({
    where: {
      bankAccount: { companyId: id },
      bookingDate: { gte: startDate, lte: endDate },
      status: { not: "IGNORED" },
      OR: [
        { status: "MATCHED" },
        { categorizedAccountId: { not: null } },
      ],
    },
    include: {
      categorizedAccount: true,
      matchedInvoice: { include: { party: true } },
      matchedExpense: { include: { party: true, account: true } },
    },
    orderBy: [{ bookingDate: "asc" }, { createdAt: "asc" }],
  });

  let bqSeq = 1;
  for (const txn of bankTxns) {
    const amount = toNumber(txn.amount);
    if (amount === 0) continue;

    const abs = Math.abs(amount);
    const pieceRef = `BQ-${formatFecDate(txn.bookingDate)}-${String(bqSeq).padStart(4, "0")}`;
    bqSeq += 1;
    const validDate = formatFecDate(txn.matchedAt ?? txn.categorizedAt ?? txn.updatedAt);
    const lib = txn.label;

    const base = {
      JournalCode: JOURNAL.BQ.code,
      JournalLib: JOURNAL.BQ.lib,
      EcritureNum: pieceRef,
      EcritureDate: formatFecDate(txn.bookingDate),
      PieceRef: pieceRef,
      PieceDate: formatFecDate(txn.bookingDate),
      EcritureLib: lib,
      ValidDate: validDate,
    };

    if (txn.matchedInvoice) {
      // Encaissement client : Débit Banque / Crédit Clients
      const auxNum = txn.matchedInvoice.party.siret ?? "";
      const auxLib = txn.matchedInvoice.party.name;
      pushBalancedPair(
        rows,
        { ...base, CompAuxNum: auxNum, CompAuxLib: auxLib },
        {
          number: bank.number,
          label: bank.label,
          amount: abs,
        },
        {
          number: customers.number,
          label: customers.label,
          amount: abs,
          auxNum,
          auxLib,
        },
      );
      continue;
    }

    if (txn.matchedExpense) {
      // Règlement note de frais : Débit Fournisseurs / Crédit Banque
      const vendor =
        txn.matchedExpense.merchantName ??
        txn.matchedExpense.party?.name ??
        "Fournisseur";
      const auxNum = txn.matchedExpense.party?.siret ?? "";
      pushBalancedPair(
        rows,
        { ...base, CompAuxNum: auxNum, CompAuxLib: vendor },
        {
          number: suppliers.number,
          label: suppliers.label,
          amount: abs,
          auxNum,
          auxLib: vendor,
        },
        {
          number: bank.number,
          label: bank.label,
          amount: abs,
        },
      );
      continue;
    }

    // Catégorisation PCG directe
    const counterpart = resolveAccountById(
      accountById,
      txn.categorizedAccountId,
      amount < 0 ? defaultCharge : revenue,
    );

    if (amount > 0) {
      // Encaissement : Débit Banque / Crédit compte
      pushBalancedPair(rows, base, {
        number: bank.number,
        label: bank.label,
        amount: abs,
      }, {
        number: counterpart.number,
        label: counterpart.label,
        amount: abs,
      });
    } else {
      // Décaissement : Débit charge / Crédit Banque
      pushBalancedPair(rows, base, {
        number: counterpart.number,
        label: counterpart.label,
        amount: abs,
      }, {
        number: bank.number,
        label: bank.label,
        amount: abs,
      });
    }
  }

  const totals = sumFecAmounts(rows);
  const siret = company.siret ?? company.siren ?? "00000000000000";
  const filename = buildFecFilename(siret, endDate);
  const csv = rowsToFecCsv(rows);

  return {
    companyId: id,
    companyName: company.name,
    siret,
    startDate,
    endDate,
    rows,
    filename,
    csv,
    totals,
  };
}
