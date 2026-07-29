import { AppShell } from "@/components/layout/AppShell";
import { InvoiceForm } from "@/modules/invoicing/InvoiceForm";
import { prisma } from "@/lib/prisma";
import { DEMO_COMPANY_ID, ensureDemoCompany } from "@/lib/company";
import { peekNextInvoiceNumber } from "@/lib/invoices/numbering";

export default async function NouvelleFacturePage() {
  await ensureDemoCompany();

  const parties = await prisma.party.findMany({
    where: {
      companyId: DEMO_COMPANY_ID,
      type: { in: ["CUSTOMER", "BOTH"] },
    },
    orderBy: { name: "asc" },
  });

  const suggestedNumber = await peekNextInvoiceNumber(
    prisma,
    DEMO_COMPANY_ID,
    "INVOICE",
  );

  return (
    <AppShell
      title="Nouvelle facture"
      subtitle={`Numéro suggéré ${suggestedNumber}`}
    >
      <InvoiceForm
        mode="create"
        parties={parties.map((p) => ({
          id: p.id,
          name: p.name,
          siret: p.siret,
        }))}
        suggestedNumber={suggestedNumber}
      />
    </AppShell>
  );
}
