import { AppShell } from "@/components/layout/AppShell";
import { ExpenseCaptureForm } from "@/modules/expenses/ExpenseCaptureForm";
import { prisma } from "@/lib/prisma";
import { DEMO_COMPANY_ID, ensureDemoCompany } from "@/lib/company";

export const dynamic = "force-dynamic";

export default async function NouvelleNoteDeFraisPage() {
  await ensureDemoCompany();
  const pcgAccounts = await prisma.account.findMany({
    where: { companyId: DEMO_COMPANY_ID, isActive: true },
    orderBy: { number: "asc" },
  });

  return (
    <AppShell
      title="Nouvelle note de frais"
      subtitle="Prenez une photo — l'OCR préremplit, vous corrigez"
    >
      <ExpenseCaptureForm
        pcgAccounts={pcgAccounts.map((a) => ({
          id: a.id,
          number: a.number,
          label: a.label,
        }))}
      />
    </AppShell>
  );
}
