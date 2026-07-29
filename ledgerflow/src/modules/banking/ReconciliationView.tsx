"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Ban, Search, Undo2 } from "lucide-react";
import {
  suggestMatches,
  type MatchableExpense,
  type MatchableInvoice,
  type MatchSuggestion,
} from "@/lib/reconciliation-engine";
import {
  ignoreTransaction,
  matchTransactionToExpense,
  matchTransactionToInvoice,
  unmatchTransaction,
} from "@/app/actions/banking";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface ReconciliationTxn {
  id: string;
  bookingDate: string;
  label: string;
  amount: number;
  status: "UNMATCHED" | "MATCHED" | "IGNORED";
  matchedInvoiceNumber?: string | null;
  matchedPartyName?: string | null;
}

interface ReconciliationViewProps {
  transactions: ReconciliationTxn[];
  openInvoices: MatchableInvoice[];
  openExpenses: MatchableExpense[];
}

export function ReconciliationView({
  transactions,
  openInvoices,
  openExpenses,
}: ReconciliationViewProps) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [manualTxn, setManualTxn] = useState<ReconciliationTxn | null>(null);
  const [statusFilter, setStatusFilter] = useState<
    "UNMATCHED" | "ALL" | "MATCHED" | "IGNORED"
  >("UNMATCHED");

  const enriched = useMemo(() => {
    return transactions.map((txn) => {
      const suggestion =
        txn.status === "UNMATCHED"
          ? suggestMatches(txn, openInvoices, openExpenses)
          : { best: null, suggestions: [] as MatchSuggestion[] };
      return { txn, suggestion };
    });
  }, [transactions, openInvoices, openExpenses]);

  const filtered = enriched.filter(({ txn }) =>
    statusFilter === "ALL" ? true : txn.status === statusFilter,
  );

  const run = (
    id: string,
    action: () => Promise<{ ok: boolean; error?: string }>,
    success: string,
  ) => {
    setPendingId(id);
    startTransition(async () => {
      const result = await action();
      setPendingId(null);
      if (!result.ok) {
        toast.error(result.error || "Action impossible");
        return;
      }
      toast.success(success);
      setManualTxn(null);
      router.refresh();
    });
  };

  const validateSuggestion = (txnId: string, suggestion: MatchSuggestion) => {
    if (suggestion.kind === "invoice") {
      run(
        txnId,
        () => matchTransactionToInvoice(txnId, suggestion.matchId),
        `Lettré avec ${suggestion.label}`,
      );
    } else {
      run(
        txnId,
        () => matchTransactionToExpense(txnId, suggestion.matchId),
        `Lettré avec ${suggestion.label}`,
      );
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Rapprochement bancaire</CardTitle>
            <CardDescription>
              Moteur heuristique · montant strict · date ±5 j · libellé client
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["UNMATCHED", "À lettrer"],
                ["MATCHED", "Lettrés"],
                ["IGNORED", "Ignorés"],
                ["ALL", "Tous"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatusFilter(value)}
                className={`rounded-md px-2.5 py-1 text-xs transition ${
                  statusFilter === value
                    ? "bg-[#0B1F33] text-white"
                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Libellé</th>
                  <th className="px-4 py-3 text-right font-medium">Montant</th>
                  <th className="px-4 py-3 font-medium">Suggestion</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filtered.map(({ txn, suggestion }) => {
                  const busy = pending && pendingId === txn.id;
                  const best = suggestion.best;
                  const highConfidence = best && best.confidence >= 80;

                  return (
                    <tr
                      key={txn.id}
                      className={`transition-colors ${
                        txn.status === "MATCHED"
                          ? "bg-emerald-50/40"
                          : txn.status === "IGNORED"
                            ? "bg-slate-50/80"
                            : "hover:bg-slate-50/80"
                      }`}
                    >
                      <td className="px-4 py-3 text-slate-600">
                        {formatDate(txn.bookingDate)}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{txn.label}</p>
                        {txn.status === "MATCHED" && txn.matchedInvoiceNumber ? (
                          <p className="text-xs text-emerald-700">
                            Lié à {txn.matchedInvoiceNumber}
                            {txn.matchedPartyName
                              ? ` · ${txn.matchedPartyName}`
                              : ""}
                          </p>
                        ) : null}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-medium tabular-nums ${
                          txn.amount < 0 ? "text-rose-600" : "text-emerald-700"
                        }`}
                      >
                        {formatCurrency(txn.amount)}
                      </td>
                      <td className="px-4 py-3">
                        {txn.status === "MATCHED" ? (
                          <Badge variant="success">Lettré</Badge>
                        ) : txn.status === "IGNORED" ? (
                          <Badge variant="muted">Ignoré</Badge>
                        ) : highConfidence && best ? (
                          <div className="space-y-1">
                            <Badge variant="success">
                              Match {best.confidence}% · {best.label}
                            </Badge>
                            <p className="text-[11px] text-slate-500">
                              {best.reason}
                            </p>
                          </div>
                        ) : best ? (
                          <div className="space-y-1">
                            <Badge variant="warning">
                              Possible {best.confidence}% · {best.label}
                            </Badge>
                            <p className="text-[11px] text-slate-500">
                              {best.reason}
                            </p>
                          </div>
                        ) : (
                          <Badge variant="muted">Aucune suggestion</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          {txn.status === "UNMATCHED" && highConfidence && best ? (
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() => validateSuggestion(txn.id, best)}
                            >
                              {busy ? <Spinner /> : <Check className="h-3.5 w-3.5" />}
                              Valider
                            </Button>
                          ) : null}
                          {txn.status === "UNMATCHED" ? (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy}
                                onClick={() => setManualTxn(txn)}
                              >
                                <Search className="h-3.5 w-3.5" />
                                Manuel
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Ignorer"
                                disabled={busy}
                                onClick={() =>
                                  run(
                                    txn.id,
                                    () => ignoreTransaction(txn.id),
                                    "Transaction ignorée",
                                  )
                                }
                              >
                                <Ban className="h-4 w-4 text-slate-500" />
                              </Button>
                            </>
                          ) : null}
                          {txn.status === "MATCHED" || txn.status === "IGNORED" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              onClick={() =>
                                run(
                                  txn.id,
                                  () => unmatchTransaction(txn.id),
                                  "Lettrage annulé",
                                )
                              }
                            >
                              {busy ? <Spinner /> : <Undo2 className="h-3.5 w-3.5" />}
                              Annuler
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-10 text-center text-sm text-slate-500"
                    >
                      Aucune transaction dans ce filtre. Importez un CSV pour
                      commencer.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <ManualMatchDialog
        open={Boolean(manualTxn)}
        txn={manualTxn}
        openInvoices={openInvoices}
        openExpenses={openExpenses}
        pending={pending}
        onClose={() => setManualTxn(null)}
        onPickInvoice={(invoiceId) => {
          if (!manualTxn) return;
          run(
            manualTxn.id,
            () => matchTransactionToInvoice(manualTxn.id, invoiceId),
            "Lettrage manuel enregistré",
          );
        }}
        onPickExpense={(expenseId) => {
          if (!manualTxn) return;
          run(
            manualTxn.id,
            () => matchTransactionToExpense(manualTxn.id, expenseId),
            "Lettrage note de frais enregistré",
          );
        }}
      />
    </>
  );
}

function ManualMatchDialog({
  open,
  txn,
  openInvoices,
  openExpenses,
  pending,
  onClose,
  onPickInvoice,
  onPickExpense,
}: {
  open: boolean;
  txn: ReconciliationTxn | null;
  openInvoices: MatchableInvoice[];
  openExpenses: MatchableExpense[];
  pending: boolean;
  onClose: () => void;
  onPickInvoice: (id: string) => void;
  onPickExpense: (id: string) => void;
}) {
  const ranked = useMemo(() => {
    if (!txn) return { suggestions: [] as MatchSuggestion[] };
    return suggestMatches(txn, openInvoices, openExpenses);
  }, [txn, openInvoices, openExpenses]);

  const invoicesSorted = useMemo(() => {
    if (!txn) return openInvoices;
    return [...openInvoices].sort((a, b) => {
      const da = Math.abs(Math.abs(txn.amount) - Math.abs(a.totalTtc));
      const db = Math.abs(Math.abs(txn.amount) - Math.abs(b.totalTtc));
      return da - db;
    });
  }, [txn, openInvoices]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title="Lettrage manuel"
      description={
        txn
          ? `${txn.label} · ${formatCurrency(txn.amount)} · ${formatDate(txn.bookingDate)}`
          : undefined
      }
      className="max-w-2xl"
    >
      {ranked.suggestions.length > 0 ? (
        <div className="mb-4 space-y-2">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Suggestions
          </p>
          {ranked.suggestions.map((s) => (
            <button
              key={`${s.kind}-${s.matchId}`}
              type="button"
              disabled={pending}
              onClick={() =>
                s.kind === "invoice"
                  ? onPickInvoice(s.matchId)
                  : onPickExpense(s.matchId)
              }
              className="flex w-full items-center justify-between rounded-lg border border-emerald-100 bg-emerald-50/50 px-3 py-2 text-left hover:bg-emerald-50"
            >
              <span>
                <span className="block text-sm font-medium text-slate-900">
                  {s.label}
                </span>
                <span className="text-xs text-slate-500">{s.reason}</span>
              </span>
              <Badge variant="success">{s.confidence}%</Badge>
            </button>
          ))}
        </div>
      ) : null}

      <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        Factures ouvertes
      </p>
      <ul className="mb-4 max-h-48 space-y-1 overflow-y-auto">
        {invoicesSorted.map((invoice) => (
          <li key={invoice.id}>
            <button
              type="button"
              disabled={pending}
              onClick={() => onPickInvoice(invoice.id)}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-slate-50"
            >
              <span>
                <span className="block text-sm font-medium">
                  {invoice.number ?? "Sans n°"} · {invoice.partyName}
                </span>
                <span className="text-xs text-slate-500">
                  Éch. {formatDate(invoice.dueDate)} · {invoice.status}
                </span>
              </span>
              <span className="text-sm tabular-nums">
                {formatCurrency(invoice.totalTtc)}
              </span>
            </button>
          </li>
        ))}
        {invoicesSorted.length === 0 ? (
          <li className="px-3 py-4 text-center text-xs text-slate-500">
            Aucune facture ouverte
          </li>
        ) : null}
      </ul>

      {openExpenses.length > 0 ? (
        <>
          <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Notes de frais
          </p>
          <ul className="max-h-32 space-y-1 overflow-y-auto">
            {openExpenses.map((expense) => (
              <li key={expense.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onPickExpense(expense.id)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-slate-50"
                >
                  <span className="text-sm">
                    {expense.merchantName || expense.description || "NDF"}
                  </span>
                  <span className="text-sm tabular-nums">
                    {expense.amountTtc != null
                      ? formatCurrency(expense.amountTtc)
                      : "—"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Dialog>
  );
}
