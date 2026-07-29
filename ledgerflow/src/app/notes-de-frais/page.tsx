import { AppShell } from "@/components/layout/AppShell";
import { ExpenseList } from "@/modules/expenses/ExpenseList";
import { prisma } from "@/lib/prisma";
import { DEMO_COMPANY_ID, ensureDemoCompany } from "@/lib/company";
import type { ExpenseStatus } from "@/types";

export const dynamic = "force-dynamic";

function toNumber(value: { toNumber?: () => number } | number | string | null): number | null {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (typeof value.toNumber === "function") return value.toNumber();
  return Number(value);
}

export default async function NotesDeFraisPage() {
  await ensureDemoCompany();
  const rows = await prisma.expense.findMany({
    where: { companyId: DEMO_COMPANY_ID },
    include: { account: true },
    orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
  });

  const expenses = rows.map((expense) => ({
    id: expense.id,
    merchantName: expense.merchantName,
    expenseDate: expense.expenseDate?.toISOString() ?? null,
    amountTtc: toNumber(expense.amountTtc),
    vatAmount: toNumber(expense.vatAmount),
    vatEstimated: expense.vatEstimated,
    status: expense.status as ExpenseStatus,
    accountNumber: expense.account?.number ?? null,
    accountLabel: expense.account?.label ?? null,
    category: expense.category,
    photoUrl: expense.photoUrl,
  }));

  return (
    <AppShell
      title="Notes de frais"
      subtitle="Capture → OCR → catégorisation PCG → validation"
    >
      <ExpenseList expenses={expenses} />
    </AppShell>
  );
}
