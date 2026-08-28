import type { InvoiceLineFormData } from "@/lib/invoices/schema";

export interface LineTotals {
  amountHt: number;
  vatAmount: number;
  amountTtc: number;
}

export interface InvoiceTotals {
  subtotalHt: number;
  vatAmount: number;
  totalTtc: number;
  lines: LineTotals[];
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeLineTotals(line: InvoiceLineFormData): LineTotals {
  const amountHt = round2(line.quantity * line.unitPriceHt);
  const vatAmount = round2(amountHt * (line.vatRate / 100));
  return {
    amountHt,
    vatAmount,
    amountTtc: round2(amountHt + vatAmount),
  };
}

export function computeInvoiceTotals(
  lines: InvoiceLineFormData[],
): InvoiceTotals {
  const computed = lines.map(computeLineTotals);
  const subtotalHt = round2(computed.reduce((s, l) => s + l.amountHt, 0));
  const vatAmount = round2(computed.reduce((s, l) => s + l.vatAmount, 0));
  return {
    subtotalHt,
    vatAmount,
    totalTtc: round2(subtotalHt + vatAmount),
    lines: computed,
  };
}
