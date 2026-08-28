"use client";

import { useMemo, useState } from "react";
import { Filter, Plus, Search } from "lucide-react";
import { mockInvoices } from "@/lib/mock-data";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  getInvoiceStatusMeta,
  getInvoiceTypeLabel,
} from "@/lib/status";
import type { Invoice, InvoiceStatus, InvoiceType } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const STATUS_FILTERS: Array<{ value: InvoiceStatus | "ALL"; label: string }> = [
  { value: "ALL", label: "Tous" },
  { value: "DRAFT", label: "Brouillon" },
  { value: "SENT", label: "Envoyé" },
  { value: "ACCEPTED", label: "Accepté" },
  { value: "PAID", label: "Payé" },
  { value: "OVERDUE", label: "En retard" },
];

const TYPE_FILTERS: Array<{ value: InvoiceType | "ALL"; label: string }> = [
  { value: "ALL", label: "Tous types" },
  { value: "QUOTE", label: "Devis" },
  { value: "INVOICE", label: "Factures" },
  { value: "CREDIT_NOTE", label: "Avoirs" },
];

interface InvoiceListProps {
  invoices?: Invoice[];
  compact?: boolean;
}

export function InvoiceList({
  invoices = mockInvoices,
  compact = false,
}: InvoiceListProps) {
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "ALL">("ALL");
  const [typeFilter, setTypeFilter] = useState<InvoiceType | "ALL">("ALL");
  const [query, setQuery] = useState("");

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

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Facturation intelligente</CardTitle>
          <CardDescription>
            Devis → Acceptation → Facture → Paiement → Relance
          </CardDescription>
        </div>
        {!compact ? (
          <Button size="sm">
            <Plus className="h-3.5 w-3.5" />
            Nouveau document
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        {!compact ? (
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
        ) : null}

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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filtered.map((invoice) => {
                const status = getInvoiceStatusMeta(invoice.status);
                return (
                  <tr
                    key={invoice.id}
                    className="transition-colors hover:bg-slate-50/80"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">
                        {invoice.number ?? "Sans numéro"}
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
                  </tr>
                );
              })}
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-sm text-slate-500"
                  >
                    Aucun document ne correspond aux filtres.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-slate-500">
          {filtered.length} document{filtered.length > 1 ? "s" : ""} · Numérotation
          séquentielle conforme (préfixe année)
        </p>
      </CardContent>
    </Card>
  );
}
