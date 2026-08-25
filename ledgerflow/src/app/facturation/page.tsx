import { AppShell } from "@/components/layout/AppShell";
import { InvoiceList, type InvoiceListItem } from "@/modules/invoicing/InvoiceList";
import { prisma } from "@/lib/prisma";
import { DEMO_COMPANY_ID, ensureDemoCompany } from "@/lib/company";
import type { InvoiceStatus, InvoiceType } from "@/types";

function toNumber(value: { toNumber?: () => number } | number | string): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (value && typeof value.toNumber === "function") return value.toNumber();
  return Number(value);
}

async function getInvoices(): Promise<InvoiceListItem[]> {
  await ensureDemoCompany();
  const rows = await prisma.invoice.findMany({
    where: { companyId: DEMO_COMPANY_ID },
    include: { party: true },
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
  });

  return rows.map((invoice) => ({
    id: invoice.id,
    number: invoice.number,
    type: invoice.type as InvoiceType,
    status: invoice.status as InvoiceStatus,
    partyName: invoice.party.name,
    issueDate: invoice.issueDate.toISOString(),
    dueDate: invoice.dueDate?.toISOString() ?? null,
    subtotalHt: toNumber(invoice.subtotalHt),
    vatAmount: toNumber(invoice.vatAmount),
    totalTtc: toNumber(invoice.totalTtc),
    currency: invoice.currency,
  }));
}

export default async function FacturationPage() {
  const invoices = await getInvoices();

  return (
    <AppShell
      title="Facturation intelligente"
      subtitle="CRUD + PDF conforme · numérotation séquentielle"
    >
      <InvoiceList invoices={invoices} />
    </AppShell>
  );
}
