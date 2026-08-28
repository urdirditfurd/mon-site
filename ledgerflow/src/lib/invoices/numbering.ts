import type { InvoiceType, Prisma } from "@prisma/client";

const PREFIX: Record<InvoiceType, string> = {
  INVOICE: "F",
  QUOTE: "D",
  CREDIT_NOTE: "A",
};

export function buildInvoiceNumber(
  type: InvoiceType,
  year: number,
  seq: number,
): string {
  return `${PREFIX[type]}-${year}-${String(seq).padStart(4, "0")}`;
}

type SequenceClient = {
  invoiceSequence: Prisma.InvoiceSequenceDelegate;
};

/** Réserve le prochain numéro séquentiel (transaction-safe). */
export async function allocateInvoiceNumber(
  tx: SequenceClient,
  companyId: string,
  type: InvoiceType,
  year = new Date().getFullYear(),
): Promise<string> {
  const prefix = PREFIX[type];
  const existing = await tx.invoiceSequence.findUnique({
    where: {
      companyId_type_year_prefix: { companyId, type, year, prefix },
    },
  });

  if (!existing) {
    await tx.invoiceSequence.create({
      data: { companyId, type, year, prefix, nextNumber: 2 },
    });
    return buildInvoiceNumber(type, year, 1);
  }

  const number = buildInvoiceNumber(type, year, existing.nextNumber);
  await tx.invoiceSequence.update({
    where: { id: existing.id },
    data: { nextNumber: existing.nextNumber + 1 },
  });
  return number;
}

export async function peekNextInvoiceNumber(
  prisma: SequenceClient,
  companyId: string,
  type: InvoiceType,
  year = new Date().getFullYear(),
): Promise<string> {
  const prefix = PREFIX[type];
  const existing = await prisma.invoiceSequence.findUnique({
    where: {
      companyId_type_year_prefix: { companyId, type, year, prefix },
    },
  });
  const next = existing?.nextNumber ?? 1;
  return buildInvoiceNumber(type, year, next);
}
