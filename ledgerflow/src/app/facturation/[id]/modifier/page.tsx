import { notFound } from "next/navigation";
import { format } from "date-fns";
import { AppShell } from "@/components/layout/AppShell";
import { InvoiceForm } from "@/modules/invoicing/InvoiceForm";
import { prisma } from "@/lib/prisma";
import { DEMO_COMPANY_ID, ensureDemoCompany } from "@/lib/company";
import { peekNextInvoiceNumber } from "@/lib/invoices/numbering";
import type { InvoiceFormData } from "@/lib/invoices/schema";

function toNumber(value: { toNumber?: () => number } | number | string): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (value && typeof value.toNumber === "function") return value.toNumber();
  return Number(value);
}

export default async function ModifierFacturePage({
  params,
}: {
  params: { id: string };
}) {
  await ensureDemoCompany();

  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, companyId: DEMO_COMPANY_ID },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!invoice) notFound();

  const parties = await prisma.party.findMany({
    where: {
      companyId: DEMO_COMPANY_ID,
      type: { in: ["CUSTOMER", "BOTH"] },
    },
    orderBy: { name: "asc" },
  });

  const suggestedNumber =
    invoice.number ||
    (await peekNextInvoiceNumber(prisma, DEMO_COMPANY_ID, invoice.type));

  const defaultValues: Partial<InvoiceFormData> = {
    type: invoice.type,
    status: invoice.status,
    partyId: invoice.partyId,
    number: invoice.number,
    issueDate: format(invoice.issueDate, "yyyy-MM-dd"),
    dueDate: invoice.dueDate
      ? format(invoice.dueDate, "yyyy-MM-dd")
      : format(invoice.issueDate, "yyyy-MM-dd"),
    notes: invoice.notes ?? "",
    currency: invoice.currency,
    lines: invoice.lines.map((line) => ({
      id: line.id,
      description: line.description,
      quantity: toNumber(line.quantity),
      unitPriceHt: toNumber(line.unitPriceHt),
      vatRate: toNumber(line.vatRate),
    })),
  };

  return (
    <AppShell
      title="Modifier le document"
      subtitle={invoice.number ?? "Brouillon"}
    >
      <InvoiceForm
        mode="edit"
        invoiceId={invoice.id}
        numberLocked={Boolean(invoice.number)}
        parties={parties.map((p) => ({
          id: p.id,
          name: p.name,
          siret: p.siret,
        }))}
        suggestedNumber={suggestedNumber}
        defaultValues={defaultValues}
      />
    </AppShell>
  );
}
