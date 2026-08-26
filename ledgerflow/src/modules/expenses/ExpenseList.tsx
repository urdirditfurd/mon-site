"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Plus, Trash2, X } from "lucide-react";
import type { ExpenseStatus } from "@/types";
import { formatCurrency, formatDate } from "@/lib/utils";
import { getExpenseStatusMeta } from "@/lib/status";
import {
  deleteExpense,
  updateExpenseStatus,
} from "@/app/actions/expenses";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface ExpenseListItem {
  id: string;
  merchantName: string | null;
  expenseDate: string | null;
  amountTtc: number | null;
  vatAmount: number | null;
  vatEstimated: boolean;
  status: ExpenseStatus;
  accountNumber: string | null;
  accountLabel: string | null;
  category: string;
  photoUrl: string | null;
}

const FILTERS: Array<{ value: "ALL" | "PENDING" | "APPROVED" | "DRAFT" | "REJECTED"; label: string }> = [
  { value: "ALL", label: "Tous" },
  { value: "PENDING", label: "En attente" },
  { value: "APPROVED", label: "Validés" },
  { value: "DRAFT", label: "Brouillons" },
  { value: "REJECTED", label: "Refusés" },
];

export function ExpenseList({ expenses }: { expenses: ExpenseListItem[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("ALL");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    if (filter === "ALL") return expenses;
    if (filter === "PENDING") {
      return expenses.filter((e) =>
        ["PENDING", "PENDING_MANAGER", "PENDING_ACCOUNTANT", "EXTRACTED"].includes(
          e.status,
        ),
      );
    }
    return expenses.filter((e) => e.status === filter);
  }, [expenses, filter]);

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
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Notes de frais</CardTitle>
          <CardDescription>
            Photo → OCR → suggestion PCG → validation
          </CardDescription>
        </div>
        <Link
          href="/notes-de-frais/nouvelle"
          className="inline-flex h-8 items-center justify-center gap-2 rounded-lg bg-[#0B1F33] px-3 text-xs font-medium text-white transition hover:bg-[#16324d]"
        >
          <Plus className="h-3.5 w-3.5" />
          Nouvelle note
        </Link>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`rounded-md px-2.5 py-1 text-xs transition ${
                filter === f.value
                  ? "bg-[#0B1F33] text-white"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Fournisseur</th>
                <th className="px-4 py-3 font-medium">Compte PCG</th>
                <th className="px-4 py-3 font-medium">Statut</th>
                <th className="px-4 py-3 text-right font-medium">Montant</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filtered.map((expense) => {
                const status = getExpenseStatusMeta(expense.status);
                const busy = pending && pendingId === expense.id;
                const canModerate = [
                  "PENDING",
                  "PENDING_MANAGER",
                  "PENDING_ACCOUNTANT",
                  "DRAFT",
                ].includes(expense.status);
                const canDelete = ["DRAFT", "REJECTED", "EXTRACTED", "PENDING_OCR"].includes(
                  expense.status,
                );

                return (
                  <tr key={expense.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3 text-slate-600">
                      {formatDate(expense.expenseDate)}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">
                        {expense.merchantName || "—"}
                      </p>
                      {expense.vatAmount != null ? (
                        <p className="text-xs text-slate-500">
                          TVA {formatCurrency(expense.vatAmount)}
                          {expense.vatEstimated ? " *" : ""}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {expense.accountNumber ? (
                        <span className="font-mono text-xs text-slate-700">
                          {expense.accountNumber}
                          <span className="mt-0.5 block font-sans text-slate-500">
                            {expense.accountLabel}
                          </span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">
                      {expense.amountTtc != null
                        ? formatCurrency(expense.amountTtc)
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {canModerate ? (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Approuver"
                              disabled={busy}
                              onClick={() =>
                                run(
                                  expense.id,
                                  () => updateExpenseStatus(expense.id, "APPROVED"),
                                  "Note approuvée",
                                )
                              }
                            >
                              {busy ? (
                                <Spinner />
                              ) : (
                                <Check className="h-4 w-4 text-emerald-600" />
                              )}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Refuser"
                              disabled={busy}
                              onClick={() =>
                                run(
                                  expense.id,
                                  () => updateExpenseStatus(expense.id, "REJECTED"),
                                  "Note refusée",
                                )
                              }
                            >
                              <X className="h-4 w-4 text-rose-600" />
                            </Button>
                          </>
                        ) : null}
                        {canDelete ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Supprimer"
                            disabled={busy}
                            onClick={() => {
                              if (!window.confirm("Supprimer cette note ?")) return;
                              run(
                                expense.id,
                                () => deleteExpense(expense.id),
                                "Note supprimée",
                              );
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-rose-500" />
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
                    colSpan={6}
                    className="px-4 py-10 text-center text-sm text-slate-500"
                  >
                    Aucune note.{" "}
                    <Link
                      href="/notes-de-frais/nouvelle"
                      className="font-medium text-[#0B1F33] underline-offset-2 hover:underline"
                    >
                      Capturer un reçu
                    </Link>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-500">
          * TVA estimée — les notes approuvées alimentent le dashboard (TVA
          déductible).
        </p>
      </CardContent>
    </Card>
  );
}
