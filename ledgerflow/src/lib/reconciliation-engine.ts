import { differenceInCalendarDays, parseISO } from "date-fns";

export interface MatchableInvoice {
  id: string;
  number: string | null;
  partyName: string;
  issueDate: string; // ISO
  dueDate: string | null;
  totalTtc: number;
  status: string;
  type: string;
}

export interface MatchableExpense {
  id: string;
  merchantName: string | null;
  description: string | null;
  expenseDate: string | null;
  amountTtc: number | null;
  status: string;
}

export interface MatchableTransaction {
  id: string;
  bookingDate: string; // ISO
  label: string;
  amount: number;
}

export type MatchKind = "invoice" | "expense";

export interface MatchSuggestion {
  kind: MatchKind;
  matchId: string;
  label: string;
  confidence: number;
  reason: string;
  amount: number;
  date: string | null;
}

export interface SuggestMatchesResult {
  best: MatchSuggestion | null;
  suggestions: MatchSuggestion[];
}

const DATE_WINDOW_DAYS = 5;
const AMOUNT_TOLERANCE = 0.01; // centime près

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(normalizeText(a).split(" ").filter((t) => t.length > 2));
  const tb = new Set(normalizeText(b).split(" ").filter((t) => t.length > 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  Array.from(ta).forEach((t) => {
    if (tb.has(t)) hit += 1;
  });
  return hit / Math.min(ta.size, tb.size);
}

function nameInLabel(partyName: string, label: string): boolean {
  const name = normalizeText(partyName);
  const hay = normalizeText(label);
  if (!name || name.length < 3) return false;
  if (hay.includes(name)) return true;
  // Accepte "DUPONT SARL" vs "VIREMENT DUPONT"
  const significant = name.split(" ").filter((t) => t.length > 3);
  return significant.length > 0 && significant.every((t) => hay.includes(t));
}

function amountScore(txnAmount: number, docAmount: number): number {
  // Crédit (positif) ↔ facture client ; Débit (négatif) ↔ dépense / fournisseur
  const absTxn = Math.abs(txnAmount);
  const absDoc = Math.abs(docAmount);
  const delta = Math.abs(absTxn - absDoc);
  if (delta <= AMOUNT_TOLERANCE) return 55;
  if (delta <= 1) return 35; // tolérance frais bancaires ~1 €
  return 0;
}

function dateScore(txnDateIso: string, docDateIso: string | null): number {
  if (!docDateIso) return 0;
  const txn = parseISO(txnDateIso.slice(0, 10));
  const doc = parseISO(docDateIso.slice(0, 10));
  const days = Math.abs(differenceInCalendarDays(txn, doc));
  if (days === 0) return 25;
  if (days <= 2) return 20;
  if (days <= DATE_WINDOW_DAYS) return 15;
  if (days <= 10) return 5;
  return 0;
}

function textScore(label: string, name: string): number {
  if (nameInLabel(name, label)) return 20;
  const overlap = tokenOverlap(name, label);
  if (overlap >= 0.66) return 15;
  if (overlap >= 0.4) return 8;
  return 0;
}

function scoreInvoice(
  txn: MatchableTransaction,
  invoice: MatchableInvoice,
): MatchSuggestion | null {
  // Les encaissements sont positifs ; on ignore les débits pour les factures clients
  if (txn.amount <= 0) return null;
  if (invoice.type === "QUOTE") return null;
  if (!["SENT", "OVERDUE", "ACCEPTED", "DRAFT"].includes(invoice.status)) {
    return null;
  }

  const a = amountScore(txn.amount, invoice.totalTtc);
  if (a === 0) return null; // montant intransigeant (hors tolérance 1€)

  const d = dateScore(
    txn.bookingDate,
    invoice.dueDate ?? invoice.issueDate,
  );
  const t = textScore(txn.label, invoice.partyName);
  // Bonus si le n° de facture apparaît dans le libellé
  const numberBonus =
    invoice.number &&
    normalizeText(txn.label).includes(normalizeText(invoice.number))
      ? 10
      : 0;

  const confidence = Math.min(100, a + d + t + numberBonus);
  const reasons: string[] = [];
  if (a >= 55) reasons.push("montant exact");
  else if (a >= 35) reasons.push("montant ±1€");
  if (d >= 15) reasons.push(`date ±${DATE_WINDOW_DAYS}j`);
  if (t >= 15) reasons.push("libellé client");
  if (numberBonus) reasons.push("n° facture");

  return {
    kind: "invoice",
    matchId: invoice.id,
    label: `${invoice.number ?? "Sans n°"} · ${invoice.partyName}`,
    confidence,
    reason: reasons.join(" · ") || "correspondance partielle",
    amount: invoice.totalTtc,
    date: invoice.dueDate ?? invoice.issueDate,
  };
}

function scoreExpense(
  txn: MatchableTransaction,
  expense: MatchableExpense,
): MatchSuggestion | null {
  if (txn.amount >= 0) return null; // dépenses = débits
  if (expense.amountTtc == null || expense.amountTtc <= 0) return null;
  if (["REJECTED", "REIMBURSED"].includes(expense.status)) return null;

  const a = amountScore(txn.amount, expense.amountTtc);
  if (a === 0) return null;

  const name = expense.merchantName || expense.description || "";
  const d = dateScore(txn.bookingDate, expense.expenseDate);
  const t = textScore(txn.label, name);
  const confidence = Math.min(100, a + d + t);

  const reasons: string[] = [];
  if (a >= 55) reasons.push("montant exact");
  else if (a >= 35) reasons.push("montant ±1€");
  if (d >= 15) reasons.push(`date ±${DATE_WINDOW_DAYS}j`);
  if (t >= 15) reasons.push("libellé marchand");

  return {
    kind: "expense",
    matchId: expense.id,
    label: name || "Note de frais",
    confidence,
    reason: reasons.join(" · ") || "correspondance partielle",
    amount: expense.amountTtc,
    date: expense.expenseDate,
  };
}

/**
 * Moteur heuristique de rapprochement bancaire.
 * Montant strict (centime, tolérance 1€), date ±5j, texte client/marchand.
 */
export function suggestMatches(
  bankTransaction: MatchableTransaction,
  openInvoices: MatchableInvoice[],
  openExpenses: MatchableExpense[] = [],
): SuggestMatchesResult {
  const suggestions: MatchSuggestion[] = [];

  for (const invoice of openInvoices) {
    const scored = scoreInvoice(bankTransaction, invoice);
    if (scored) suggestions.push(scored);
  }
  for (const expense of openExpenses) {
    const scored = scoreExpense(bankTransaction, expense);
    if (scored) suggestions.push(scored);
  }

  suggestions.sort((a, b) => b.confidence - a.confidence);
  const best = suggestions[0] ?? null;

  return {
    best: best && best.confidence >= 40 ? best : best,
    suggestions: suggestions.slice(0, 8),
  };
}
