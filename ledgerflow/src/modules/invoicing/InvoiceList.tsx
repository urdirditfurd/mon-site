"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  Eye,
  Filter,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  getInvoiceStatusMeta,
  getInvoiceTypeLabel,
} from "@/lib/status";
import type { InvoiceStatus, InvoiceType } from "@/types";
import { deleteInvoice, markAsPaid } from "@/app/actions/invoice";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface InvoiceListItem {
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

const STATUS_FILTERS: Array<{ value: InvoiceStatus | "ALL"; label: string }> = [
  { value: "ALL", label: "Tous" },
  { value: "DRAFT", label: "Brouillon" },
  { value: "SENT", label: "Envoyé" },
  { value: "ACCEPTED", label: "Accepté" },
  { value: "PAID", label: "Payé" },
  { value: "OVERDUE", label: "En retard" },
  { value: "CANCELLED", label: "Annulé" },
];

const TYPE_FILTERS: Array<{ value: InvoiceType | "ALL"; label: string }> = [
  { value: "ALL", label: "Tous types" },
  { value: "QUOTE", label: "Devis" },
  { value: "INVOICE", label: "Factures" },
  { value: "CREDIT_NOTE", label: "Avoirs" },
];

interface InvoiceListProps {
  invoices: InvoiceListItem[];
}

export function InvoiceList({ invoices }: InvoiceListProps) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "ALL">("ALL");
  const [typeFilter, setTypeFilter] = useState<InvoiceType | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return invoices.filter((invoice) => {
      if (statusFilter !== "ALL" && invoice.status !== statusFilter) return false;
      if (typeFilter !== "ALL" && invoice.type !== typeFilter) return false;
      if (!q) return true;
      return (
        (invoice.number ?? "").toLowerCase().includes(q) ||
        invoice.partyName.toLowerCase().includes(q)
      );
    });
  }, [invoices, query, statusFilter, typeFilter]);

  const runAction = (
    id: string,
    action: () => Promise<{ ok: boolean; error?: string }>,
    successMessage: string,
  ) => {
    setPendingId(id);
    startTransition(async () => {
      const result = await action();
      setPendingId(null);
      if (!result.ok) {
        toast.error(result.error || "Action impossible");
        return;
      }
      toast.success(successMessage);
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Facturation intelligente</CardTitle>
          <CardDescription>
            Devis → Acceptation → Facture → Paiement · soft-delete pour la séquence
          </CardDescription>
        </div>
        <Link
          href="/facturation/nouvelle"
          className="inline-flex h-8 items-center justify-center gap-2 rounded-lg bg-[#0B1F33] px-3 text-xs font-medium text-white transition hover:bg-[#16324d]"
        >
          <Plus className="h-3.5 w-3.5" />
          Nouvelle facture
        </Link>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="N° ou client…"
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pr-3 pl-9 text-sm text-slate-700 outline-none ring-[#0B1F33]/20 placeholder:text-slate-400 focus:ring-2"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-slate-400" />
            {TYPE_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setTypeFilter(filter.value)}
                className={`rounded-md px-2.5 py-1 text-xs transition ${
                  typeFilter === filter.value
                    ? "bg-[#0B1F33] text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setStatusFilter(filter.value)}
              className={`rounded-md px-2.5 py-1 text-xs transition ${
                statusFilter === filter.value
                  ? "bg-[#0B1F33] text-white"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Document</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Émission</th>
                <th className="px-4 py-3 font-medium">Échéance</th>
                <th className="px-4 py-3 font-medium">Statut</th>
                <th className="px-4 py-3 text-right font-medium">Montant TTC</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filtered.map((invoice) => {
                const status = getInvoiceStatusMeta(invoice.status);
                const busy = pending && pendingId === invoice.id;
                const canPay =
                  invoice.type !== "QUOTE" &&
                  invoice.status !== "PAID" &&
                  invoice.status !== "CANCELLED";
                const canEdit =
                  invoice.status !== "PAID" && invoice.status !== "CANCELLED";

                return (
                  <tr
                    key={invoice.id}
                    className="transition-colors hover:bg-slate-50/80"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">
                        {invoice.number ?? "Brouillon"}
                      </div>
                      <div className="text-xs text-slate-500">
                        {getInvoiceTypeLabel(invoice.type)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{invoice.partyName}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatDate(invoice.issueDate)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatDate(invoice.dueDate)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-900">
                      {formatCurrency(invoice.totalTtc, invoice.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <a
                          href={`/api/invoices/${invoice.id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
                          title="Voir PDF"
                        >
                          <Eye className="h-4 w-4" />
                        </a>
                        {canEdit ? (
                          <Link
                            href={`/facturation/${invoice.id}/modifier`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
                            title="Modifier"
                          >
                            <Pencil className="h-4 w-4" />
                          </Link>
                        ) : null}
                        {canPay ? (
                          <button
                            type="button"
                            title="Marquer comme payée"
                            disabled={busy}
                            onClick={() =>
                              runAction(
                                invoice.id,
                                () => markAsPaid(invoice.id),
                                "Marquée comme payée",
                              )
                            }
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                          >
                            {busy ? (
                              <Spinner />
                            ) : (
                              <CheckCircle2 className="h-4 w-4" />
                            )}
                          </button>
                        ) : null}
                        {invoice.status !== "CANCELLED" ? (
                          <button
                            type="button"
                            title={
                              invoice.number
                                ? "Annuler (soft delete)"
                                : "Supprimer le brouillon"
                            }
                            disabled={busy}
                            onClick={() => {
                              const ok = window.confirm(
                                invoice.number
                                  ? `Annuler ${invoice.number} ? Le numéro est conservé (soft delete).`
                                  : "Supprimer ce brouillon définitivement ?",
                              );
                              if (!ok) return;
                              runAction(
                                invoice.id,
                                () => deleteInvoice(invoice.id),
                                invoice.number
                                  ? "Document annulé"
                                  : "Brouillon supprimé",
                              );
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-sm text-slate-500"
                  >
                    Aucun document. Créez votre première facture.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-slate-500">
          {filtered.length} document{filtered.length > 1 ? "s" : ""} · Les
          documents émis ne sont jamais effacés de la séquence
        </p>
      </CardContent>
    </Card>
  );
}
