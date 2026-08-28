/** Types métier LedgerFlow (alignés sur le schéma Prisma, utilisables côté UI mock). */

export type InvoiceType = "QUOTE" | "INVOICE" | "CREDIT_NOTE";

export type InvoiceStatus =
  | "DRAFT"
  | "SENT"
  | "ACCEPTED"
  | "PAID"
  | "OVERDUE"
  | "CANCELLED"
  | "REJECTED";

export type ExpenseStatus =
  | "DRAFT"
  | "PENDING"
  | "PENDING_OCR"
  | "EXTRACTED"
  | "PENDING_MANAGER"
  | "PENDING_ACCOUNTANT"
  | "APPROVED"
  | "REJECTED"
  | "REIMBURSED";

export type ExpenseCategory =
  | "RESTAURANT"
  | "TRANSPORT"
  | "HOTEL"
  | "SUPPLIES"
  | "SOFTWARE"
  | "TRAINING"
  | "OTHER";

export interface Company {
  id: string;
  name: string;
  siret: string;
  city: string;
}

export interface Party {
  id: string;
  name: string;
  email?: string;
  type: "CUSTOMER" | "SUPPLIER" | "BOTH";
}

export interface Invoice {
  id: string;
  number: string | null;
  type: InvoiceType;
  status: InvoiceStatus;
  partyName: string;
  issueDate: string;
  dueDate: string | null;
  subtotalHt: number;
  vatAmount: number;
  totalTtc: number;
  currency: string;
}

export interface Expense {
  id: string;
  merchantName: string;
  category: ExpenseCategory;
  status: ExpenseStatus;
  expenseDate: string;
  amountTtc: number;
  employeeName: string;
  ocrConfidence?: number;
}

export interface BankTransaction {
  id: string;
  bookingDate: string;
  label: string;
  amount: number;
  isMatched: boolean;
  suggestedAccount?: string;
  bankAccountName: string;
}

export interface AccountingEntry {
  id: string;
  entryDate: string;
  journalCode: string;
  pieceRef: string | null;
  label: string;
  isValidated: boolean;
  debit: number;
  credit: number;
}

export interface DashboardKpis {
  cashBalance: number;
  cashDelta30d: number;
  revenueInvoiced: number;
  revenueCollected: number;
  vatPayable: number;
  vatCollected: number;
  vatDeductible: number;
  receivablesTotal: number;
  receivablesCount: number;
  expensesPending: number;
  unmatchedTxns: number;
}

export interface MonthlyCashPoint {
  month: string;
  inflow: number;
  outflow: number;
  balance: number;
}

export interface RevenueComparisonPoint {
  month: string;
  invoiced: number;
  collected: number;
}
