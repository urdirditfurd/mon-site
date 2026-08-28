"use client";

import type { LucideIcon } from "lucide-react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CircleAlert,
  FileWarning,
  Receipt,
  Scale,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  mockKpis,
  mockMonthlyCash,
  mockReceivables,
  mockRevenueComparison,
  mockBankTransactions,
  mockExpenses,
} from "@/lib/mock-data";
import { formatCurrency, formatDate } from "@/lib/utils";
import { getExpenseStatusMeta } from "@/lib/status";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InvoiceList } from "@/modules/invoicing/InvoiceList";

function KpiCard({
  title,
  value,
  hint,
  delta,
  icon: Icon,
  tone = "default",
}: {
  title: string;
  value: string;
  hint: string;
  delta?: number;
  icon: LucideIcon;
  tone?: "default" | "danger" | "success";
}) {
  const positive = typeof delta === "number" ? delta >= 0 : null;
  return (
    <Card className="overflow-hidden">
      <CardContent className="relative pt-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              {title}
            </p>
            <p className="mt-2 font-display text-2xl tracking-tight text-[#0B1F33] tabular-nums">
              {value}
            </p>
            <p className="mt-1 text-xs text-slate-500">{hint}</p>
          </div>
          <div
            className={`rounded-lg p-2 ${
              tone === "danger"
                ? "bg-rose-50 text-rose-600"
                : tone === "success"
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-slate-100 text-[#0B1F33]"
            }`}
          >
            <Icon className="h-4 w-4" strokeWidth={1.75} />
          </div>
        </div>
        {typeof delta === "number" ? (
          <div
            className={`mt-3 inline-flex items-center gap-1 text-xs font-medium ${
              positive ? "text-emerald-600" : "text-rose-600"
            }`}
          >
            {positive ? (
              <ArrowUpRight className="h-3.5 w-3.5" />
            ) : (
              <ArrowDownRight className="h-3.5 w-3.5" />
            )}
            {formatCurrency(Math.abs(delta))} sur 30 j
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function Dashboard() {
  const unmatched = mockBankTransactions.filter((t) => !t.isMatched);
  const pendingExpenses = mockExpenses.filter(
    (e) =>
      e.status === "PENDING_MANAGER" ||
      e.status === "PENDING_ACCOUNTANT" ||
      e.status === "PENDING_OCR" ||
      e.status === "EXTRACTED",
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="animate-fade-up stagger-1">
        <KpiCard
          title="Trésorerie"
          value={formatCurrency(mockKpis.cashBalance)}
          hint="Solde consolidé · temps réel"
          delta={mockKpis.cashDelta30d}
          icon={Banknote}
          tone="success"
        />
        </div>
        <div className="animate-fade-up stagger-2">
        <KpiCard
          title="CA facturé vs encaissé"
          value={formatCurrency(mockKpis.revenueCollected)}
          hint={`${formatCurrency(mockKpis.revenueInvoiced)} facturé YTD`}
          icon={Receipt}
        />
        </div>
        <div className="animate-fade-up stagger-3">
        <KpiCard
          title="TVA à payer"
          value={formatCurrency(mockKpis.vatPayable)}
          hint={`Collectée ${formatCurrency(mockKpis.vatCollected)} − déductible ${formatCurrency(mockKpis.vatDeductible)}`}
          icon={Scale}
        />
        </div>
        <div className="animate-fade-up stagger-4">
        <KpiCard
          title="Créances clients"
          value={formatCurrency(mockKpis.receivablesTotal)}
          hint={`${mockKpis.receivablesCount} factures ouvertes`}
          icon={CircleAlert}
          tone="danger"
        />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle>Évolution de trésorerie</CardTitle>
            <CardDescription>
              Entrées / sorties mensuelles et solde de fin de mois
            </CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={mockMonthlyCash}>
                <defs>
                  <linearGradient id="cashFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0B1F33" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#0B1F33" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#64748b" }} />
                <YAxis
                  tick={{ fontSize: 12, fill: "#64748b" }}
                  tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                />
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value))}
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid #e2e8f0",
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="balance"
                  stroke="#0B1F33"
                  fill="url(#cashFill)"
                  strokeWidth={2}
                  name="Solde"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Facturé vs encaissé</CardTitle>
            <CardDescription>Comparaison mensuelle (TTC)</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mockRevenueComparison}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#64748b" }} />
                <YAxis
                  tick={{ fontSize: 12, fill: "#64748b" }}
                  tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                />
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value))}
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid #e2e8f0",
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="invoiced" fill="#94a3b8" radius={[4, 4, 0, 0]} name="Facturé" />
                <Bar dataKey="collected" fill="#0B1F33" radius={[4, 4, 0, 0]} name="Encaissé" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Qui me doit quoi ?</CardTitle>
            <CardDescription>Créances clients à suivre</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-slate-100">
              {mockReceivables.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {item.partyName}
                    </p>
                    <p className="text-xs text-slate-500">
                      {item.invoiceNumber} · échéance {formatDate(item.dueDate)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums text-slate-900">
                      {formatCurrency(item.amount)}
                    </p>
                    {item.daysOverdue > 0 ? (
                      <Badge variant="danger" className="mt-1">
                        J+{item.daysOverdue}
                      </Badge>
                    ) : (
                      <Badge variant="info" className="mt-1">
                        À échéance
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>À traiter</CardTitle>
            <CardDescription>
              Transactions non lettrées & notes de frais en attente
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                <FileWarning className="h-3.5 w-3.5" />
                Banque · {unmatched.length} non lettrées
              </div>
              <ul className="space-y-2">
                {unmatched.slice(0, 3).map((txn) => (
                  <li
                    key={txn.id}
                    className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-800">{txn.label}</p>
                      <p className="text-xs text-slate-500">
                        {formatDate(txn.bookingDate)}
                        {txn.suggestedAccount
                          ? ` · compte suggéré ${txn.suggestedAccount}`
                          : ""}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-sm font-medium tabular-nums ${
                        txn.amount < 0 ? "text-rose-600" : "text-emerald-600"
                      }`}
                    >
                      {formatCurrency(txn.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Notes de frais · {pendingExpenses.length} en cours
              </div>
              <ul className="space-y-2">
                {pendingExpenses.slice(0, 3).map((expense) => {
                  const status = getExpenseStatusMeta(expense.status);
                  return (
                    <li
                      key={expense.id}
                      className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"
                    >
                      <div>
                        <p className="text-sm text-slate-800">
                          {expense.merchantName}
                        </p>
                        <p className="text-xs text-slate-500">
                          {expense.employeeName} · {formatDate(expense.expenseDate)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium tabular-nums">
                          {expense.amountTtc
                            ? formatCurrency(expense.amountTtc)
                            : "—"}
                        </p>
                        <Badge variant={status.variant} className="mt-1">
                          {status.label}
                        </Badge>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </CardContent>
        </Card>
      </section>

      <InvoiceList compact />
    </div>
  );
}
