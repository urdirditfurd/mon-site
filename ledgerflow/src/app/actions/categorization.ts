"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { DEMO_COMPANY_ID, ensureDemoCompany } from "@/lib/company";
import {
  categorizeTransaction,
  extractMemorableKeyword,
  type CategorySuggestion,
} from "@/lib/categorization-engine";
import {
  estimateVatFromTtc,
  isVatDeductibleChargeAccount,
} from "@/lib/financial-engine";

export type CategoryActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function revalidateCategoryPaths() {
  revalidatePath("/tresorerie");
  revalidatePath("/journal");
  revalidatePath("/");
}

async function loadPcgContext() {
  await ensureDemoCompany();
  const accounts = await prisma.account.findMany({
    where: { companyId: DEMO_COMPANY_ID, isActive: true },
    orderBy: { number: "asc" },
  });
  const rules = await prisma.categorizationRule.findMany({
    where: { companyId: DEMO_COMPANY_ID, isActive: true },
    include: { account: true },
    orderBy: { priority: "asc" },
  });
  return {
    accounts: accounts.map((a) => ({
      id: a.id,
      number: a.number,
      label: a.label,
    })),
    rules: rules.map((r) => ({
      id: r.id,
      keyword: r.keyword,
      accountId: r.accountId,
      priority: r.priority,
      account: {
        id: r.account.id,
        number: r.account.number,
        label: r.account.label,
      },
    })),
  };
}

export async function suggestCategory(
  transactionId: string,
): Promise<CategoryActionResult<CategorySuggestion>> {
  try {
    const txn = await prisma.bankTransaction.findFirst({
      where: {
        id: transactionId,
        bankAccount: { companyId: DEMO_COMPANY_ID },
      },
    });
    if (!txn) return { ok: false, error: "Transaction introuvable" };

    const { accounts, rules } = await loadPcgContext();
    if (accounts.length === 0) {
      return { ok: false, error: "PCG non initialisé — lancez npm run db:seed" };
    }

    const suggestion = await categorizeTransaction(
      txn.label,
      Number(txn.amount),
      accounts,
      rules,
    );

    if (!suggestion.accountId) {
      return { ok: false, error: suggestion.reason };
    }

    await prisma.bankTransaction.update({
      where: { id: transactionId },
      data: {
        suggestedAccountId: suggestion.accountId,
        suggestionConfidence: suggestion.confidence,
        suggestionReason: suggestion.reason,
        suggestionSource: suggestion.source,
      },
    });

    revalidateCategoryPaths();
    return { ok: true, data: suggestion };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Suggestion impossible",
    };
  }
}

export async function suggestCategoriesForUnmatched(): Promise<
  CategoryActionResult<{ count: number }>
> {
  try {
    const { accounts, rules } = await loadPcgContext();
    const txns = await prisma.bankTransaction.findMany({
      where: {
        bankAccount: { companyId: DEMO_COMPANY_ID },
        status: "UNMATCHED",
        categorizedAccountId: null,
      },
    });

    let count = 0;
    for (const txn of txns) {
      const suggestion = await categorizeTransaction(
        txn.label,
        Number(txn.amount),
        accounts,
        rules,
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
      count += 1;
    }

    revalidateCategoryPaths();
    return { ok: true, data: { count } };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Batch impossible",
    };
  }
}

export async function confirmCategory(
  transactionId: string,
  pcgAccountId: string,
  createRule: boolean,
  keyword?: string,
): Promise<CategoryActionResult> {
  try {
    const txn = await prisma.bankTransaction.findFirst({
      where: {
        id: transactionId,
        bankAccount: { companyId: DEMO_COMPANY_ID },
      },
    });
    if (!txn) return { ok: false, error: "Transaction introuvable" };

    const account = await prisma.account.findFirst({
      where: { id: pcgAccountId, companyId: DEMO_COMPANY_ID },
    });
    if (!account) return { ok: false, error: "Compte PCG introuvable" };

    await prisma.$transaction(async (tx) => {
      const vatEligible =
        account.type === "EXPENSE" &&
        isVatDeductibleChargeAccount(account.number);
      const estimatedVat = vatEligible
        ? estimateVatFromTtc(Number(txn.amount))
        : null;

      await tx.bankTransaction.update({
        where: { id: transactionId },
        data: {
          categorizedAccountId: pcgAccountId,
          categorizedAt: new Date(),
          suggestedAccountId: pcgAccountId,
          suggestionConfidence: 100,
          suggestionReason: createRule
            ? "Validé + règle mémorisée"
            : "Validé manuellement",
          suggestionSource: createRule ? "RULE" : "MANUAL",
          vatAmount: estimatedVat,
          vatEstimated: Boolean(estimatedVat),
        },
      });

      if (createRule) {
        const key = (keyword?.trim() || extractMemorableKeyword(txn.label))
          .toUpperCase()
          .slice(0, 64);
        await tx.categorizationRule.upsert({
          where: {
            companyId_keyword: {
              companyId: DEMO_COMPANY_ID,
              keyword: key,
            },
          },
          update: {
            accountId: pcgAccountId,
            isActive: true,
            hitCount: { increment: 1 },
          },
          create: {
            companyId: DEMO_COMPANY_ID,
            keyword: key,
            accountId: pcgAccountId,
            priority: 50,
            hitCount: 1,
          },
        });
      } else {
        // Incrémente hitCount si une règle existante a servi
        const existing = await tx.categorizationRule.findFirst({
          where: {
            companyId: DEMO_COMPANY_ID,
            isActive: true,
            keyword: {
              equals: extractMemorableKeyword(txn.label),
              mode: "insensitive",
            },
          },
        });
        if (existing) {
          await tx.categorizationRule.update({
            where: { id: existing.id },
            data: { hitCount: { increment: 1 } },
          });
        }
      }
    });

    revalidateCategoryPaths();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Validation impossible",
    };
  }
}
