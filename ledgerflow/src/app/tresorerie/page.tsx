import { AppShell } from "@/components/layout/AppShell";
import { BankImport } from "@/modules/banking/BankImport";
import { ReconciliationView } from "@/modules/banking/ReconciliationView";
import { prisma } from "@/lib/prisma";
import { DEMO_COMPANY_ID, ensureDemoCompany } from "@/lib/company";
import type {
  MatchableExpense,
  MatchableInvoice,
} from "@/lib/reconciliation-engine";
import { categorizeTransaction } from "@/lib/categorization-engine";
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

  const pcgAccounts = await prisma.account.findMany({
    where: { companyId: DEMO_COMPANY_ID, isActive: true },
    orderBy: { number: "asc" },
  });

  const rules = await prisma.categorizationRule.findMany({
    where: { companyId: DEMO_COMPANY_ID, isActive: true },
    include: { account: true },
    orderBy: { priority: "asc" },
  });

  const ruleRefs = rules.map((r) => ({
    id: r.id,
    keyword: r.keyword,
    accountId: r.accountId,
    priority: r.priority,
    account: {
      id: r.account.id,
      number: r.account.number,
      label: r.account.label,
    },
  }));

  const accountRefs = pcgAccounts.map((a) => ({
    id: a.id,
    number: a.number,
    label: a.label,
  }));

  const transactions = await prisma.bankTransaction.findMany({
    where: { bankAccount: { companyId: DEMO_COMPANY_ID } },
    include: {
      matchedInvoice: { include: { party: true } },
      categorizedAccount: true,
      suggestedAccount: true,
    },
    orderBy: { bookingDate: "desc" },
  });

  // Enrichit les suggestions PCG manquantes (sans bloquer si PCG vide)
  for (const txn of transactions) {
    if (
      txn.status !== "UNMATCHED" ||
      txn.categorizedAccountId ||
      txn.suggestedAccountId ||
      accountRefs.length === 0
    ) {
      continue;
    }
    const suggestion = await categorizeTransaction(
      txn.label,
      toNumber(txn.amount),
      accountRefs,
      ruleRefs,
    );
    if (!suggestion.accountId) continue;
    await prisma.bankTransaction.update({
      where: { id: txn.id },
      data: {
        suggestedAccountId: suggestion.accountId,
        suggestionConfidence: suggestion.confidence,
        suggestionReason: suggestion.reason,
        suggestionSource: suggestion.source,
      },
    });
    txn.suggestedAccountId = suggestion.accountId;
    txn.suggestionConfidence = suggestion.confidence;
    txn.suggestionReason = suggestion.reason;
    txn.suggestionSource = suggestion.source;
    txn.suggestedAccount =
      pcgAccounts.find((a) => a.id === suggestion.accountId) ?? null;
  }

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
    pcgAccounts: accountRefs,
    transactions: transactions.map((txn) => ({
      id: txn.id,
      bookingDate: txn.bookingDate.toISOString(),
      label: txn.label,
      amount: toNumber(txn.amount),
      status: txn.status as "UNMATCHED" | "MATCHED" | "IGNORED",
      matchedInvoiceNumber: txn.matchedInvoice?.number ?? null,
      matchedPartyName: txn.matchedInvoice?.party.name ?? null,
      categorizedAccountNumber: txn.categorizedAccount?.number ?? null,
      categorizedAccountName: txn.categorizedAccount?.label ?? null,
      categorySuggestion:
        txn.suggestedAccount && txn.suggestionConfidence != null
          ? {
              accountId: txn.suggestedAccount.id,
              accountNumber: txn.suggestedAccount.number,
              accountName: txn.suggestedAccount.label,
              confidence: txn.suggestionConfidence,
              reason: txn.suggestionReason ?? "",
              source: txn.suggestionSource ?? "HEURISTIC",
            }
          : null,
    })),
    openInvoices,
    openExpenses,
    unmatchedCount: transactions.filter((t) => t.status === "UNMATCHED").length,
    uncategorizedCount: transactions.filter(
      (t) => t.status === "UNMATCHED" && !t.categorizedAccountId,
    ).length,
  };
}

export default async function TresoreriePage() {
  const data = await loadBankingData();

  return (
    <AppShell
      title="Trésorerie & Banque"
      subtitle="Import CSV → lettrage → catégorisation PCG intelligente"
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
                À catégoriser
              </p>
              <p className="mt-2 font-display text-2xl text-[#0B1F33]">
                {data.uncategorizedCount}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Cerveau PCG</CardTitle>
              <CardDescription>
                Règles mémorisées · heuristiques · LLM optionnel
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Badge variant="navy">
                {data.pcgAccounts.length} comptes · hybride
              </Badge>
            </CardContent>
          </Card>
        </div>

        <BankImport accounts={data.accounts} />
        <ReconciliationView
          transactions={data.transactions}
          openInvoices={data.openInvoices}
          openExpenses={data.openExpenses}
          pcgAccounts={data.pcgAccounts}
        />
      </div>
    </AppShell>
  );
}
