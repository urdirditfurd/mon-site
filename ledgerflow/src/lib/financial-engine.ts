import {
  addMonths,
  endOfMonth,
  endOfYear,
  format,
  startOfMonth,
  startOfYear,
  subMonths,
} from "date-fns";
import { fr } from "date-fns/locale";
import { prisma } from "@/lib/prisma";
import { DEMO_COMPANY_ID, ensureDemoCompany } from "@/lib/company";

export type DashboardPeriod = "month" | "quarter" | "year";
export type VatRegimeMode = "ENCASHMENT" | "DEBIT";

export interface CashflowSummary {
  currentBalance: number;
  inflow: number;
  outflow: number;
  net: number;
  sparkline: Array<{ label: string; balance: number }>;
  monthlySeries: Array<{
    month: string;
    monthKey: string;
    inflow: number;
    outflow: number;
    balance: number;
  }>;
}

export interface VatSummary {
  month: number;
  year: number;
  label: string;
  collected: number;
  deductible: number;
  balance: number;
  regime: VatRegimeMode;
  deductibleIsEstimated: boolean;
}

export interface ReceivableRow {
  id: string;
  number: string | null;
  partyName: string;
  dueDate: string | null;
  totalTtc: number;
  status: string;
}

export interface OutstandingReceivables {
  total: number;
  count: number;
  items: ReceivableRow[];
}

export interface NetResultSummary {
  revenue: number;
  expenses: number;
  net: number;
}

export interface DashboardSnapshot {
  period: DashboardPeriod;
  periodLabel: string;
  cashflow: CashflowSummary;
  vat: VatSummary;
  vatHistory: VatSummary[];
  receivables: OutstandingReceivables;
  netResult: NetResultSummary;
  generatedAt: string;
}

function toNumber(value: { toNumber?: () => number } | number | string | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value.toNumber === "function") return value.toNumber();
  return Number(value) || 0;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** TVA incluse dans un montant TTC (taux 20 % par défaut). */
export function estimateVatFromTtc(amountTtc: number, rate = 0.2): number {
  const abs = Math.abs(amountTtc);
  return round2((abs * rate) / (1 + rate));
}

/** Comptes de charges généralement éligibles à la TVA déductible. */
export function isVatDeductibleChargeAccount(accountNumber: string): boolean {
  const n = accountNumber.replace(/\D/g, "");
  if (!n.startsWith("6")) return false;
  // Exclut les comptes de charges exceptionnelles / IS souvent hors TVA
  if (n.startsWith("67") || n.startsWith("69")) return false;
  return true;
}

function periodBounds(
  period: DashboardPeriod,
  now = new Date(),
): { start: Date; end: Date; label: string } {
  if (period === "year") {
    return {
      start: startOfYear(now),
      end: endOfYear(now),
      label: format(now, "yyyy"),
    };
  }
  if (period === "quarter") {
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    const start = startOfMonth(new Date(now.getFullYear(), quarterStartMonth, 1));
    const end = endOfMonth(addMonths(start, 2));
    const q = Math.floor(now.getMonth() / 3) + 1;
    return { start, end, label: `T${q} ${now.getFullYear()}` };
  }
  return {
    start: startOfMonth(now),
    end: endOfMonth(now),
    label: format(now, "MMMM yyyy", { locale: fr }),
  };
}

export async function getCashflowSummary(
  months = 6,
  companyId = DEMO_COMPANY_ID,
): Promise<CashflowSummary> {
  await ensureDemoCompany();
  const now = new Date();
  const start = startOfMonth(subMonths(now, months - 1));

  const accounts = await prisma.bankAccount.findMany({
    where: { companyId, isActive: true },
  });
  const currentBalance = round2(
    accounts.reduce((sum, a) => sum + toNumber(a.balance), 0),
  );

  const txns = await prisma.bankTransaction.findMany({
    where: {
      bankAccount: { companyId },
      bookingDate: { gte: start, lte: endOfMonth(now) },
      status: { not: "IGNORED" },
    },
    orderBy: { bookingDate: "asc" },
  });

  const buckets = new Map<
    string,
    { inflow: number; outflow: number; label: string }
  >();
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = startOfMonth(subMonths(now, i));
    const key = format(d, "yyyy-MM");
    buckets.set(key, {
      inflow: 0,
      outflow: 0,
      label: format(d, "MMM", { locale: fr }),
    });
  }

  for (const txn of txns) {
    const key = format(txn.bookingDate, "yyyy-MM");
    const bucket = buckets.get(key);
    if (!bucket) continue;
    const amount = toNumber(txn.amount);
    if (amount >= 0) bucket.inflow = round2(bucket.inflow + amount);
    else bucket.outflow = round2(bucket.outflow + Math.abs(amount));
  }

  // Reconstitue une courbe de solde en partant du solde actuel et en remontant
  const keys = Array.from(buckets.keys());
  const monthlyNet = keys.map((key) => {
    const b = buckets.get(key)!;
    return round2(b.inflow - b.outflow);
  });
  const totalNet = monthlyNet.reduce((s, n) => s + n, 0);
  let running = round2(currentBalance - totalNet);
  const monthlySeries = keys.map((key, index) => {
    const b = buckets.get(key)!;
    running = round2(running + monthlyNet[index]);
    return {
      month: b.label,
      monthKey: key,
      inflow: b.inflow,
      outflow: b.outflow,
      balance: running,
    };
  });

  const periodInflow = round2(
    monthlySeries.reduce((s, m) => s + m.inflow, 0),
  );
  const periodOutflow = round2(
    monthlySeries.reduce((s, m) => s + m.outflow, 0),
  );

  return {
    currentBalance,
    inflow: periodInflow,
    outflow: periodOutflow,
    net: round2(periodInflow - periodOutflow),
    sparkline: monthlySeries.map((m) => ({
      label: m.month,
      balance: m.balance,
    })),
    monthlySeries,
  };
}

export async function getVatSummary(
  month: number,
  year: number,
  companyId = DEMO_COMPANY_ID,
): Promise<VatSummary> {
  await ensureDemoCompany();
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  const regime: VatRegimeMode =
    company?.vatRegime === "DEBIT" ? "DEBIT" : "ENCASHMENT";

  const start = startOfMonth(new Date(year, month - 1, 1));
  const end = endOfMonth(start);
  const label = format(start, "MMM yyyy", { locale: fr });

  // TVA collectée
  let collected = 0;
  if (regime === "ENCASHMENT") {
    const paid = await prisma.invoice.findMany({
      where: {
        companyId,
        type: { in: ["INVOICE", "CREDIT_NOTE"] },
        status: "PAID",
        paidAt: { gte: start, lte: end },
      },
    });
    collected = round2(paid.reduce((s, inv) => s + toNumber(inv.vatAmount), 0));
  } else {
    const issued = await prisma.invoice.findMany({
      where: {
        companyId,
        type: { in: ["INVOICE", "CREDIT_NOTE"] },
        status: { notIn: ["DRAFT", "CANCELLED", "REJECTED"] },
        issueDate: { gte: start, lte: end },
      },
    });
    collected = round2(
      issued.reduce((s, inv) => s + toNumber(inv.vatAmount), 0),
    );
  }

  // TVA déductible estimée sur transactions catégorisées en charges
  const chargeTxns = await prisma.bankTransaction.findMany({
    where: {
      bankAccount: { companyId },
      bookingDate: { gte: start, lte: end },
      categorizedAccountId: { not: null },
      amount: { lt: 0 },
      status: { not: "IGNORED" },
    },
    include: { categorizedAccount: true },
  });

  let deductible = 0;
  let deductibleIsEstimated = false;
  for (const txn of chargeTxns) {
    const accountNumber = txn.categorizedAccount?.number ?? "";
    if (!isVatDeductibleChargeAccount(accountNumber)) continue;
    if (txn.vatAmount != null) {
      deductible += toNumber(txn.vatAmount);
      if (txn.vatEstimated) deductibleIsEstimated = true;
    } else {
      deductible += estimateVatFromTtc(toNumber(txn.amount));
      deductibleIsEstimated = true;
    }
  }

  // Notes de frais APPROVED / REIMBURSED (Pilier 2)
  const approvedExpenses = await prisma.expense.findMany({
    where: {
      companyId,
      status: { in: ["APPROVED", "REIMBURSED"] },
      expenseDate: { gte: start, lte: end },
      amountTtc: { not: null },
    },
    include: { account: true },
  });

  for (const expense of approvedExpenses) {
    const accountNumber = expense.account?.number ?? "";
    if (accountNumber && !isVatDeductibleChargeAccount(accountNumber)) {
      continue;
    }
    if (expense.vatAmount != null) {
      deductible += toNumber(expense.vatAmount);
      if (expense.vatEstimated) deductibleIsEstimated = true;
    } else if (expense.amountTtc != null) {
      deductible += estimateVatFromTtc(toNumber(expense.amountTtc));
      deductibleIsEstimated = true;
    }
  }

  deductible = round2(deductible);

  return {
    month,
    year,
    label,
    collected,
    deductible,
    balance: round2(collected - deductible),
    regime,
    deductibleIsEstimated,
  };
}

export async function getOutstandingReceivables(
  companyId = DEMO_COMPANY_ID,
): Promise<OutstandingReceivables> {
  await ensureDemoCompany();
  const rows = await prisma.invoice.findMany({
    where: {
      companyId,
      type: { in: ["INVOICE", "CREDIT_NOTE"] },
      status: { in: ["SENT", "OVERDUE", "ACCEPTED"] },
    },
    include: { party: true },
    orderBy: { dueDate: "asc" },
  });

  const items: ReceivableRow[] = rows.map((inv) => ({
    id: inv.id,
    number: inv.number,
    partyName: inv.party.name,
    dueDate: inv.dueDate?.toISOString() ?? null,
    totalTtc: toNumber(inv.totalTtc),
    status: inv.status,
  }));

  return {
    total: round2(items.reduce((s, i) => s + i.totalTtc, 0)),
    count: items.length,
    items,
  };
}

export async function getNetResultSummary(
  period: DashboardPeriod,
  companyId = DEMO_COMPANY_ID,
): Promise<NetResultSummary> {
  const { start, end } = periodBounds(period);
  await ensureDemoCompany();

  // Revenus : factures payées (HT) sur la période d'encaissement
  const paid = await prisma.invoice.findMany({
    where: {
      companyId,
      type: { in: ["INVOICE", "CREDIT_NOTE"] },
      status: "PAID",
      OR: [
        { paidAt: { gte: start, lte: end } },
        { paidAt: null, issueDate: { gte: start, lte: end } },
      ],
    },
  });
  const revenue = round2(
    paid.reduce((s, inv) => s + toNumber(inv.subtotalHt), 0),
  );

  // Dépenses : transactions catégorisées + notes de frais approuvées
  const expensesTxns = await prisma.bankTransaction.findMany({
    where: {
      bankAccount: { companyId },
      bookingDate: { gte: start, lte: end },
      categorizedAccountId: { not: null },
      amount: { lt: 0 },
      status: { not: "IGNORED" },
    },
    include: { categorizedAccount: true },
  });

  let expenses = 0;
  for (const txn of expensesTxns) {
    const type = txn.categorizedAccount?.type;
    if (type !== "EXPENSE") continue;
    const ttc = Math.abs(toNumber(txn.amount));
    const vat =
      txn.vatAmount != null
        ? toNumber(txn.vatAmount)
        : estimateVatFromTtc(ttc);
    expenses += round2(ttc - vat);
  }

  const approvedExpenses = await prisma.expense.findMany({
    where: {
      companyId,
      status: { in: ["APPROVED", "REIMBURSED"] },
      expenseDate: { gte: start, lte: end },
      amountTtc: { not: null },
    },
  });
  for (const expense of approvedExpenses) {
    const ttc = toNumber(expense.amountTtc);
    const vat =
      expense.vatAmount != null
        ? toNumber(expense.vatAmount)
        : estimateVatFromTtc(ttc);
    expenses += round2(ttc - vat);
  }
  expenses = round2(expenses);

  return {
    revenue,
    expenses,
    net: round2(revenue - expenses),
  };
}

export async function getDashboardSnapshot(
  period: DashboardPeriod = "month",
): Promise<DashboardSnapshot> {
  const now = new Date();
  const { label } = periodBounds(period, now);
  const months = period === "year" ? 12 : period === "quarter" ? 3 : 6;

  const [cashflow, receivables, netResult, vat] = await Promise.all([
    getCashflowSummary(months),
    getOutstandingReceivables(),
    getNetResultSummary(period),
    getVatSummary(now.getMonth() + 1, now.getFullYear()),
  ]);

  const vatHistory: VatSummary[] = [];
  for (let i = 2; i >= 0; i -= 1) {
    const d = subMonths(now, i);
    vatHistory.push(await getVatSummary(d.getMonth() + 1, d.getFullYear()));
  }

  return {
    period,
    periodLabel: label,
    cashflow,
    vat,
    vatHistory,
    receivables,
    netResult,
    generatedAt: new Date().toISOString(),
  };
}
