import { prisma } from "@/lib/prisma";
import { DEMO_COMPANY_ID } from "@/lib/company";
import type { InvoicePdfData } from "@/modules/invoicing/InvoicePDF";
import { getInvoiceStatusMeta, getInvoiceTypeLabel } from "@/lib/status";
import type { InvoiceStatus, InvoiceType } from "@/types";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

function toNumber(value: { toNumber?: () => number } | number | string): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (value && typeof value.toNumber === "function") return value.toNumber();
  return Number(value);
}

function formatFrDate(d: Date): string {
  return format(d, "d MMMM yyyy", { locale: fr });
}

export async function getInvoicePdfData(
  id: string,
): Promise<InvoicePdfData | null> {
  const invoice = await prisma.invoice.findFirst({
    where: { id, companyId: DEMO_COMPANY_ID },
    include: {
      party: true,
      company: true,
      lines: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!invoice) return null;

  const status = getInvoiceStatusMeta(invoice.status as InvoiceStatus);
  const typeLabel = getInvoiceTypeLabel(invoice.type as InvoiceType);

  return {
    number: invoice.number || "BROUILLON",
    typeLabel,
    statusLabel: status.label,
    issueDate: formatFrDate(invoice.issueDate),
    dueDate: invoice.dueDate ? formatFrDate(invoice.dueDate) : "—",
    currency: invoice.currency,
    notes: invoice.notes,
    subtotalHt: toNumber(invoice.subtotalHt),
    vatAmount: toNumber(invoice.vatAmount),
    totalTtc: toNumber(invoice.totalTtc),
    issuer: {
      name: invoice.company.name,
      legalName: invoice.company.legalName,
      siret: invoice.company.siret,
      vatNumber: invoice.company.vatNumber,
      address: invoice.company.address,
      zipCode: invoice.company.zipCode,
      city: invoice.company.city,
      email: invoice.company.email,
      vatExempt: invoice.company.vatExempt,
    },
    customer: {
      name: invoice.party.name,
      siret: invoice.party.siret,
      vatNumber: invoice.party.vatNumber,
      address: invoice.party.address,
      zipCode: invoice.party.zipCode,
      city: invoice.party.city,
      email: invoice.party.email,
    },
    lines: invoice.lines.map((line) => ({
      description: line.description,
      quantity: toNumber(line.quantity),
      unitPriceHt: toNumber(line.unitPriceHt),
      vatRate: toNumber(line.vatRate),
      amountHt: toNumber(line.amountHt),
    })),
  };
}
