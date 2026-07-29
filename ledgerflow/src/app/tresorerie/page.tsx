import { AppShell } from "@/components/layout/AppShell";
import { BankImport } from "@/modules/banking/BankImport";
import { ReconciliationView } from "@/modules/banking/ReconciliationView";
import { prisma } from "@/lib/prisma";
import { DEMO_COMPANY_ID, ensureDemoCompany } from "@/lib/company";
import type {
  MatchableExpense,
  MatchableInvoice,
} from "@/lib/reconciliation-engine";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

function toNumber(value: { toNumber?: () => number } | number | string): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (value && typeof value.toNumber === "function") return value.toNumber();
  return Number(value);
}

async function loadBankingData() {
  await ensureDemoCompany();

  let accounts = await prisma.bankAccount.findMany({
    where: { companyId: DEMO_COMPANY_ID, isActive: true },
    orderBy: { name: "asc" },
  });

  if (accounts.length === 0) {
    const created = await prisma.bankAccount.create({
      data: {
        id: "ba_bnp_courant",
        companyId: DEMO_COMPANY_ID,
        name: "Compte courant BNP",
        iban: "FR7610096000501234567890185",
        currency: "EUR",
        provider: "CSV",
        balance: 42870.14,
      },
    });
    accounts = [created];
  }

  const transactions = await prisma.bankTransaction.findMany({
    where: { bankAccount: { companyId: DEMO_COMPANY_ID } },
    include: {
      matchedInvoice: { include: { party: true } },
    },
    orderBy: { bookingDate: "desc" },
  });

  const openInvoicesRaw = await prisma.invoice.findMany({
    where: {
      companyId: DEMO_COMPANY_ID,
      type: { in: ["INVOICE", "CREDIT_NOTE"] },
      status: { in: ["SENT", "OVERDUE", "ACCEPTED", "DRAFT"] },
    },
    include: { party: true },
    orderBy: { issueDate: "desc" },
  });

  const openExpensesRaw = await prisma.expense.findMany({
    where: {
      companyId: DEMO_COMPANY_ID,
      status: {
        in: [
          "APPROVED",
          "PENDING_ACCOUNTANT",
          "PENDING_MANAGER",
          "EXTRACTED",
        ],
      },
      amountTtc: { not: null },
    },
  });

  const openInvoices: MatchableInvoice[] = openInvoicesRaw.map((inv) => ({
    id: inv.id,
    number: inv.number,
    partyName: inv.party.name,
    issueDate: inv.issueDate.toISOString(),
    dueDate: inv.dueDate?.toISOString() ?? null,
    totalTtc: toNumber(inv.totalTtc),
    status: inv.status,
    type: inv.type,
  }));

  const openExpenses: MatchableExpense[] = openExpensesRaw.map((exp) => ({
    id: exp.id,
    merchantName: exp.merchantName,
    description: exp.description,
    expenseDate: exp.expenseDate?.toISOString() ?? null,
    amountTtc: exp.amountTtc != null ? toNumber(exp.amountTtc) : null,
    status: exp.status,
  }));

  return {
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      iban: a.iban,
    })),
    transactions: transactions.map((txn) => ({
      id: txn.id,
      bookingDate: txn.bookingDate.toISOString(),
      label: txn.label,
      amount: toNumber(txn.amount),
      status: txn.status as "UNMATCHED" | "MATCHED" | "IGNORED",
      matchedInvoiceNumber: txn.matchedInvoice?.number ?? null,
      matchedPartyName: txn.matchedInvoice?.party.name ?? null,
    })),
    openInvoices,
    openExpenses,
    unmatchedCount: transactions.filter((t) => t.status === "UNMATCHED").length,
  };
}

export default async function TresoreriePage() {
  const data = await loadBankingData();

  return (
    <AppShell
      title="Trésorerie & Banque"
      subtitle="Import CSV → suggestions heuristiques → lettrage 1 clic"
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="pt-5">
              <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                À lettrer
              </p>
              <p className="mt-2 font-display text-2xl text-[#0B1F33]">
                {data.unmatchedCount}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                Factures ouvertes
              </p>
              <p className="mt-2 font-display text-2xl text-[#0B1F33]">
                {data.openInvoices.length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Phase CSV</CardTitle>
              <CardDescription>
                Bridge / Budget Insight viendront ensuite
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Badge variant="navy">MVP import manuel</Badge>
            </CardContent>
          </Card>
        </div>

        <BankImport accounts={data.accounts} />
        <ReconciliationView
          transactions={data.transactions}
          openInvoices={data.openInvoices}
          openExpenses={data.openExpenses}
        />
      </div>
    </AppShell>
  );
}
