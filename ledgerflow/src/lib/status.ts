import type { ExpenseStatus, InvoiceStatus, InvoiceType } from "@/types";
import type { BadgeProps } from "@/components/ui/badge";

const invoiceStatusMeta: Record<
  InvoiceStatus,
  { label: string; variant: NonNullable<BadgeProps["variant"]> }
> = {
  DRAFT: { label: "Brouillon", variant: "muted" },
  SENT: { label: "Envoyé", variant: "info" },
  ACCEPTED: { label: "Accepté", variant: "navy" },
  PAID: { label: "Payé", variant: "success" },
  OVERDUE: { label: "En retard", variant: "danger" },
  CANCELLED: { label: "Annulé", variant: "muted" },
  REJECTED: { label: "Refusé", variant: "danger" },
};

const expenseStatusMeta: Record<
  ExpenseStatus,
  { label: string; variant: NonNullable<BadgeProps["variant"]> }
> = {
  PENDING_OCR: { label: "OCR en cours", variant: "muted" },
  EXTRACTED: { label: "Extrait", variant: "info" },
  PENDING_MANAGER: { label: "Manager", variant: "warning" },
  PENDING_ACCOUNTANT: { label: "Comptable", variant: "warning" },
  APPROVED: { label: "Approuvé", variant: "success" },
  REJECTED: { label: "Refusé", variant: "danger" },
  REIMBURSED: { label: "Remboursé", variant: "navy" },
};

export function getInvoiceStatusMeta(status: InvoiceStatus) {
  return invoiceStatusMeta[status];
}

export function getExpenseStatusMeta(status: ExpenseStatus) {
  return expenseStatusMeta[status];
}

export function getInvoiceTypeLabel(type: InvoiceType): string {
  switch (type) {
    case "QUOTE":
      return "Devis";
    case "INVOICE":
      return "Facture";
    case "CREDIT_NOTE":
      return "Avoir";
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}
