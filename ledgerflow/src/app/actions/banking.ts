"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { DEMO_COMPANY_ID, ensureDemoCompany } from "@/lib/company";
import type { ParsedBankRow } from "@/lib/banking/csv";

export type BankingActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function revalidateBanking() {
  revalidatePath("/tresorerie");
  revalidatePath("/facturation");
  revalidatePath("/");
}

export async function listBankAccounts() {
  await ensureDemoCompany();
  return prisma.bankAccount.findMany({
    where: { companyId: DEMO_COMPANY_ID, isActive: true },
    orderBy: { name: "asc" },
  });
}

export async function importBankTransactions(
  rows: ParsedBankRow[],
  bankAccountId: string,
): Promise<BankingActionResult<{ imported: number; skipped: number }>> {
  try {
    await ensureDemoCompany();
    if (!rows.length) {
      return { ok: false, error: "Aucune ligne à importer" };
    }

    const account = await prisma.bankAccount.findFirst({
      where: { id: bankAccountId, companyId: DEMO_COMPANY_ID },
    });
    if (!account) return { ok: false, error: "Compte bancaire introuvable" };

    let imported = 0;
    let skipped = 0;

    await prisma.$transaction(async (tx) => {
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const externalId = `csv:${row.bookingDate}:${row.amount}:${row.label.slice(0, 80)}:${index}`;
        const existing = await tx.bankTransaction.findFirst({
          where: {
            bankAccountId,
            OR: [
              { externalId },
              {
                bookingDate: new Date(row.bookingDate),
                amount: row.amount,
                label: row.label,
              },
            ],
          },
        });
        if (existing) {
          skipped += 1;
          continue;
        }

        await tx.bankTransaction.create({
          data: {
            bankAccountId,
            externalId,
            bookingDate: new Date(row.bookingDate),
            label: row.label,
            amount: row.amount,
            currency: account.currency,
            status: "UNMATCHED",
            isMatched: false,
            rawPayload: row.raw,
          },
        });
        imported += 1;
      }

      await tx.bankAccount.update({
        where: { id: bankAccountId },
        data: { lastSyncedAt: new Date() },
      });
    });

    revalidateBanking();
    return { ok: true, data: { imported, skipped } };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Import impossible",
    };
  }
}

export async function matchTransactionToInvoice(
  transactionId: string,
  invoiceId: string,
): Promise<BankingActionResult> {
  try {
    const txn = await prisma.bankTransaction.findFirst({
      where: {
        id: transactionId,
        bankAccount: { companyId: DEMO_COMPANY_ID },
      },
    });
    if (!txn) return { ok: false, error: "Transaction introuvable" };
    if (txn.status === "MATCHED") {
      return { ok: false, error: "Déjà lettrée" };
    }

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, companyId: DEMO_COMPANY_ID },
    });
    if (!invoice) return { ok: false, error: "Facture introuvable" };
    if (invoice.type === "QUOTE") {
      return { ok: false, error: "Impossible de lettrer un devis" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.bankTransaction.update({
        where: { id: transactionId },
        data: {
          status: "MATCHED",
          isMatched: true,
          matchedAt: new Date(),
          matchedInvoiceId: invoiceId,
          matchedExpenseId: null,
        },
      });
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          status: "PAID",
          paidAt: invoice.paidAt ?? new Date(),
        },
      });
    });

    revalidateBanking();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Lettrage impossible",
    };
  }
}

export async function matchTransactionToExpense(
  transactionId: string,
  expenseId: string,
): Promise<BankingActionResult> {
  try {
    const txn = await prisma.bankTransaction.findFirst({
      where: {
        id: transactionId,
        bankAccount: { companyId: DEMO_COMPANY_ID },
      },
    });
    if (!txn) return { ok: false, error: "Transaction introuvable" };

    const expense = await prisma.expense.findFirst({
      where: { id: expenseId, companyId: DEMO_COMPANY_ID },
    });
    if (!expense) return { ok: false, error: "Note de frais introuvable" };

    await prisma.$transaction(async (tx) => {
      await tx.bankTransaction.update({
        where: { id: transactionId },
        data: {
          status: "MATCHED",
          isMatched: true,
          matchedAt: new Date(),
          matchedExpenseId: expenseId,
          matchedInvoiceId: null,
        },
      });
      await tx.expense.update({
        where: { id: expenseId },
        data: {
          status: "REIMBURSED",
          reimbursedAt: expense.reimbursedAt ?? new Date(),
        },
      });
    });

    revalidateBanking();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Lettrage impossible",
    };
  }
}

export async function ignoreTransaction(
  transactionId: string,
): Promise<BankingActionResult> {
  try {
    const txn = await prisma.bankTransaction.findFirst({
      where: {
        id: transactionId,
        bankAccount: { companyId: DEMO_COMPANY_ID },
      },
    });
    if (!txn) return { ok: false, error: "Transaction introuvable" };

    await prisma.bankTransaction.update({
      where: { id: transactionId },
      data: {
        status: "IGNORED",
        isMatched: false,
        matchedInvoiceId: null,
        matchedExpenseId: null,
        matchedAt: null,
      },
    });

    revalidateBanking();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Action impossible",
    };
  }
}

export async function unmatchTransaction(
  transactionId: string,
): Promise<BankingActionResult> {
  try {
    const txn = await prisma.bankTransaction.findFirst({
      where: {
        id: transactionId,
        bankAccount: { companyId: DEMO_COMPANY_ID },
      },
      include: { matchedInvoice: true },
    });
    if (!txn) return { ok: false, error: "Transaction introuvable" };

    await prisma.$transaction(async (tx) => {
      if (txn.matchedInvoiceId) {
        await tx.invoice.update({
          where: { id: txn.matchedInvoiceId },
          data: { status: "SENT", paidAt: null },
        });
      }
      if (txn.matchedExpenseId) {
        await tx.expense.update({
          where: { id: txn.matchedExpenseId },
          data: { status: "APPROVED", reimbursedAt: null },
        });
      }
      await tx.bankTransaction.update({
        where: { id: transactionId },
        data: {
          status: "UNMATCHED",
          isMatched: false,
          matchedAt: null,
          matchedInvoiceId: null,
          matchedExpenseId: null,
        },
      });
    });

    revalidateBanking();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Annulation impossible",
    };
  }
}
