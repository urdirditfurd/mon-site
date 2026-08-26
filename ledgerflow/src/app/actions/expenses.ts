"use server";

import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { revalidatePath } from "next/cache";
import type { ExpenseCategory, ExpenseStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEMO_COMPANY_ID, ensureDemoCompany } from "@/lib/company";
import { extractAndCategorizeReceipt } from "@/lib/ocr-engine";
import {
  expenseReviewSchema,
  type ExpenseReviewData,
} from "@/lib/expenses/schema";
import { estimateVatFromTtc } from "@/lib/financial-engine";

export type ExpenseActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function revalidateExpenses() {
  revalidatePath("/notes-de-frais");
  revalidatePath("/");
  revalidatePath("/tresorerie");
}

async function loadPcgContext() {
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

export async function processExpenseUpload(
  formData: FormData,
): Promise<
  ExpenseActionResult<{
    photoUrl: string;
    ocr: {
      vendor: string;
      date: string;
      total: number;
      vat: number | null;
      vatEstimated: boolean;
      confidence: number;
      categoryHint: string;
      rawText: string;
    };
    suggestion: {
      accountId: string;
      accountNumber: string;
      accountName: string;
      confidence: number;
      reason: string;
      source: string;
    } | null;
  }>
> {
  try {
    await ensureDemoCompany();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return { ok: false, error: "Fichier manquant" };
    }
    if (!ALLOWED_MIME.has(file.type)) {
      return {
        ok: false,
        error: "Format non supporté — JPEG, PNG ou WebP uniquement",
      };
    }
    if (file.size > 8 * 1024 * 1024) {
      return { ok: false, error: "Fichier trop volumineux (max 8 Mo)" };
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const ext =
      file.type === "image/png"
        ? "png"
        : file.type === "image/webp"
          ? "webp"
          : "jpg";
    const filename = `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
    const uploadDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, filename), bytes);
    const photoUrl = `/uploads/${filename}`;

    const { accounts, rules } = await loadPcgContext();
    const { ocr, categorySuggestion } = await extractAndCategorizeReceipt(
      file.name || filename,
      accounts,
      rules,
      bytes,
    );

    return {
      ok: true,
      data: {
        photoUrl,
        ocr,
        suggestion: categorySuggestion?.accountId
          ? {
              accountId: categorySuggestion.accountId,
              accountNumber: categorySuggestion.accountNumber,
              accountName: categorySuggestion.accountName,
              confidence: categorySuggestion.confidence,
              reason: categorySuggestion.reason,
              source: categorySuggestion.source,
            }
          : null,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "OCR impossible",
    };
  }
}

export async function saveExpense(
  raw: unknown,
): Promise<ExpenseActionResult<{ id: string }>> {
  const parsed = expenseReviewSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join(" · "),
    };
  }

  try {
    await ensureDemoCompany();
    const data: ExpenseReviewData = parsed.data;
    const vatAmount =
      data.vatAmount ??
      (data.vatEstimated === false ? null : estimateVatFromTtc(data.amountTtc));
    const amountHt =
      vatAmount != null
        ? Math.round((data.amountTtc - vatAmount) * 100) / 100
        : null;

    const expense = await prisma.expense.create({
      data: {
        companyId: DEMO_COMPANY_ID,
        employeeId: "emp_demo",
        status: data.status as ExpenseStatus,
        category: data.category as ExpenseCategory,
        merchantName: data.merchantName,
        expenseDate: new Date(data.expenseDate),
        amountTtc: data.amountTtc,
        amountHt,
        vatAmount,
        vatEstimated: data.vatEstimated ?? vatAmount != null,
        vatRate: 20,
        currency: "EUR",
        photoUrl: data.photoUrl || null,
        note: data.note || null,
        description: data.description || null,
        accountId: data.accountId,
        ocrConfidence: data.ocrConfidence ?? null,
        ocrData: data.ocrData
          ? (data.ocrData as object)
          : undefined,
        ocrRawText:
          data.ocrData &&
          typeof data.ocrData === "object" &&
          data.ocrData !== null &&
          "rawText" in data.ocrData
            ? String((data.ocrData as { rawText?: string }).rawText ?? "")
            : null,
      },
    });

    revalidateExpenses();
    return { ok: true, data: { id: expense.id } };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Enregistrement impossible",
    };
  }
}

export async function updateExpenseStatus(
  id: string,
  status: "APPROVED" | "REJECTED" | "PENDING" | "DRAFT",
): Promise<ExpenseActionResult> {
  try {
    const expense = await prisma.expense.findFirst({
      where: { id, companyId: DEMO_COMPANY_ID },
    });
    if (!expense) return { ok: false, error: "Note introuvable" };

    await prisma.expense.update({
      where: { id },
      data: {
        status,
        approvedAt: status === "APPROVED" ? new Date() : expense.approvedAt,
      },
    });

    revalidateExpenses();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Mise à jour impossible",
    };
  }
}

export async function deleteExpense(id: string): Promise<ExpenseActionResult> {
  try {
    const expense = await prisma.expense.findFirst({
      where: { id, companyId: DEMO_COMPANY_ID },
    });
    if (!expense) return { ok: false, error: "Note introuvable" };
    if (!["DRAFT", "REJECTED", "PENDING_OCR", "EXTRACTED"].includes(expense.status)) {
      return {
        ok: false,
        error: "Seuls les brouillons / refusés peuvent être supprimés",
      };
    }

    await prisma.expense.delete({ where: { id } });
    revalidateExpenses();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Suppression impossible",
    };
  }
}

export async function updateExpense(
  id: string,
  raw: unknown,
): Promise<ExpenseActionResult<{ id: string }>> {
  const parsed = expenseReviewSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join(" · "),
    };
  }

  try {
    const expense = await prisma.expense.findFirst({
      where: { id, companyId: DEMO_COMPANY_ID },
    });
    if (!expense) return { ok: false, error: "Note introuvable" };
    if (!["DRAFT", "REJECTED", "PENDING"].includes(expense.status)) {
      return { ok: false, error: "Note non modifiable dans cet état" };
    }

    const data = parsed.data;
    const vatAmount =
      data.vatAmount ?? estimateVatFromTtc(data.amountTtc);
    const amountHt = Math.round((data.amountTtc - vatAmount) * 100) / 100;

    await prisma.expense.update({
      where: { id },
      data: {
        merchantName: data.merchantName,
        expenseDate: new Date(data.expenseDate),
        amountTtc: data.amountTtc,
        amountHt,
        vatAmount,
        vatEstimated: data.vatEstimated ?? true,
        accountId: data.accountId,
        category: data.category as ExpenseCategory,
        note: data.note || null,
        description: data.description || null,
        status: data.status as ExpenseStatus,
      },
    });

    revalidateExpenses();
    return { ok: true, data: { id } };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Mise à jour impossible",
    };
  }
}
