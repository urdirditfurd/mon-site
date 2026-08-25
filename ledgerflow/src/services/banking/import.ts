/**
 * Service agrégateur bancaire.
 * Phase 1 : import CSV · Phase 2 : Bridge / Budget Insight / GoCardless.
 */

export type BankingProvider = "CSV" | "BRIDGE" | "BUDGET_INSIGHT" | "GOCARDLESS";

export interface ImportedTransaction {
  bookingDate: string;
  label: string;
  amount: number;
  externalId?: string;
}

export function parseCsvPreview(csv: string): ImportedTransaction[] {
  const lines = csv.trim().split(/\r?\n/).slice(1);
  return lines
    .map((line) => {
      const [bookingDate, label, amount] = line.split(";");
      if (!bookingDate || !label || amount === undefined) return null;
      return {
        bookingDate: bookingDate.trim(),
        label: label.trim(),
        amount: Number(amount.replace(",", ".")),
      };
    })
    .filter((row): row is ImportedTransaction => row !== null && !Number.isNaN(row.amount));
}
