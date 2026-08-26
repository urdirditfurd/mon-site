"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CircleAlert,
  Scale,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  DashboardPeriod,
  DashboardSnapshot,
} from "@/lib/financial-engine";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FecExport } from "@/modules/dashboard/FecExport";

const PERIODS: Array<{ value: DashboardPeriod; label: string }> = [
  { value: "month", label: "Mois" },
  { value: "quarter", label: "Trimestre" },
  { value: "year", label: "Année" },
];

function KpiCard({
  title,
  value,
  hint,
  delta,
  icon: Icon,
  tone = "default",
  sparkline,
  href,
}: {
  title: string;
  value: string;
  hint: ReactNode;
  delta?: number;
  icon: LucideIcon;
  tone?: "default" | "danger" | "success";
  sparkline?: Array<{ label: string; balance: number }>;
  href?: string;
}) {
  const positive = typeof delta === "number" ? delta >= 0 : null;
  const content = (
    <Card className="overflow-hidden transition hover:border-slate-300">
      <CardContent className="relative pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              {title}
            </p>
            <p className="mt-2 font-display text-2xl tracking-tight text-[#0B1F33] tabular-nums">
              {value}
            </p>
            <div className="mt-1 text-xs text-slate-500">{hint}</div>
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
        {sparkline && sparkline.length > 1 ? (
          <div className="mt-3 h-10">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkline}>
                <Area
                  type="monotone"
                  dataKey="balance"
                  stroke="#0B1F33"
                  fill="#0B1F33"
                  fillOpacity={0.08}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : null}
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
            {formatCurrency(Math.abs(delta))} net période
          </div>
        ) : null}
      </CardContent>
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {content}
      </Link>
    );
  }
  return content;
}

export function Dashboard({
  data,
  period,
}: {
  data: DashboardSnapshot;
  period: DashboardPeriod;
}) {
  const vatTone =
    data.vat.balance > 0 ? "danger" : data.vat.balance < 0 ? "success" : "default";

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-600">
            Période :{" "}
            <span className="font-medium text-[#0B1F33] capitalize">
              {data.periodLabel}
            </span>
          </p>
          <p className="text-xs text-slate-500">
            Régime TVA :{" "}
            {data.vat.regime === "ENCASHMENT"
              ? "sur encaissements"
              : "sur débits"}
          </p>
        </div>
        <div className="flex gap-1.5 rounded-lg bg-white p-1 ring-1 ring-slate-200">
          {PERIODS.map((p) => (
            <Link
              key={p.value}
              href={`/?period=${p.value}`}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                period === p.value
                  ? "bg-[#0B1F33] text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {p.label}
            </Link>
          ))}
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="animate-fade-up stagger-1">
          <KpiCard
            title="Trésorerie"
            value={formatCurrency(data.cashflow.currentBalance)}
            hint="Solde consolidé des comptes"
            delta={data.cashflow.net}
            icon={Banknote}
            tone="success"
            sparkline={data.cashflow.sparkline}
          />
        </div>
        <div className="animate-fade-up stagger-2">
          <KpiCard
            title="TVA à payer"
            value={formatCurrency(data.vat.balance)}
            hint={
              <span className="inline-flex items-center gap-1">
                {data.vat.label}
                {data.vat.deductibleIsEstimated ? (
                  <Tooltip content="TVA déductible estimée sur la base du montant TTC. Importez la facture fournisseur pour valider le montant exact.">
                    <span className="cursor-help text-amber-600">*</span>
                  </Tooltip>
                ) : null}
              </span>
            }
            icon={Scale}
            tone={vatTone}
          />
        </div>
        <div className="animate-fade-up stagger-3">
          <KpiCard
            title="Créances clients"
            value={formatCurrency(data.receivables.total)}
            hint={`${data.receivables.count} facture(s) ouvertes`}
            icon={CircleAlert}
            tone={data.receivables.total > 0 ? "danger" : "default"}
            href="/facturation?status=SENT"
          />
        </div>
        <div className="animate-fade-up stagger-4">
          <KpiCard
            title="Résultat net estimé"
            value={formatCurrency(data.netResult.net)}
            hint={`${formatCurrency(data.netResult.revenue)} − ${formatCurrency(data.netResult.expenses)}`}
            icon={TrendingUp}
            tone={data.netResult.net >= 0 ? "success" : "danger"}
          />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle>Évolution de trésorerie</CardTitle>
            <CardDescription>
              Solde reconstitué sur{" "}
              {data.cashflow.monthlySeries.length} mois · encaissements vs
              décaissements
            </CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.cashflow.monthlySeries}>
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
                  tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
                />
                <RechartsTooltip
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
            <CardTitle>Récapitulatif TVA</CardTitle>
            <CardDescription>
              3 derniers mois · collectée − déductible
              {data.vat.deductibleIsEstimated ? " *" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-[11px] tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th className="px-3 py-2 font-medium">Mois</th>
                    <th className="px-3 py-2 text-right font-medium">Collectée</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Déductible
                    </th>
                    <th className="px-3 py-2 text-right font-medium">Solde</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.vatHistory.map((row) => (
                    <tr key={`${row.year}-${row.month}`}>
                      <td className="px-3 py-2 capitalize text-slate-700">
                        {row.label}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(row.collected)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                        {formatCurrency(row.deductible)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-medium tabular-nums ${
                          row.balance > 0
                            ? "text-rose-600"
                            : row.balance < 0
                              ? "text-emerald-700"
                              : "text-slate-700"
                        }`}
                      >
                        {formatCurrency(row.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.vat.deductibleIsEstimated ? (
              <p className="mt-3 text-[11px] leading-relaxed text-amber-700">
                * TVA déductible estimée sur la base du montant TTC. Importez la
                facture fournisseur pour valider le montant exact.
              </p>
            ) : null}
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-slate-500">Collectée (mois)</p>
                <p className="mt-0.5 font-semibold tabular-nums">
                  {formatCurrency(data.vat.collected)}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-slate-500">Déductible (mois)</p>
                <p className="mt-0.5 font-semibold tabular-nums">
                  {formatCurrency(data.vat.deductible)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle>Créances clients</CardTitle>
              <CardDescription>Factures émises non encore payées</CardDescription>
            </div>
            <Link
              href="/facturation"
              className="text-xs font-medium text-[#0B1F33] underline-offset-2 hover:underline"
            >
              Voir tout →
            </Link>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-slate-100">
              {data.receivables.items.slice(0, 5).map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {item.partyName}
                    </p>
                    <p className="text-xs text-slate-500">
                      {item.number ?? "Sans n°"} · échéance{" "}
                      {formatDate(item.dueDate)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">
                      {formatCurrency(item.totalTtc)}
                    </p>
                    <Badge
                      variant={item.status === "OVERDUE" ? "danger" : "info"}
                      className="mt-1"
                    >
                      {item.status === "OVERDUE" ? "En retard" : "Ouverte"}
                    </Badge>
                  </div>
                </li>
              ))}
              {data.receivables.items.length === 0 ? (
                <li className="py-8 text-center text-sm text-slate-500">
                  Aucune créance ouverte — bravo.
                </li>
              ) : null}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Flux de la période</CardTitle>
            <CardDescription>
              Encaissements et décaissements bancaires
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-4 py-3">
              <span className="text-sm text-emerald-800">Encaissé</span>
              <span className="font-semibold tabular-nums text-emerald-800">
                {formatCurrency(data.cashflow.inflow)}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-rose-50 px-4 py-3">
              <span className="text-sm text-rose-800">Décaissé</span>
              <span className="font-semibold tabular-nums text-rose-800">
                {formatCurrency(data.cashflow.outflow)}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-slate-100 px-4 py-3">
              <span className="text-sm font-medium text-slate-800">Net</span>
              <span
                className={`font-semibold tabular-nums ${
                  data.cashflow.net >= 0 ? "text-emerald-700" : "text-rose-700"
                }`}
              >
                {formatCurrency(data.cashflow.net)}
              </span>
            </div>
            <Link
              href="/tresorerie"
              className="inline-flex text-xs font-medium text-[#0B1F33] underline-offset-2 hover:underline"
            >
              Ouvrir lettrage & catégorisation →
            </Link>
          </CardContent>
        </Card>
      </section>

      <section className="animate-fade-up">
        <FecExport />
      </section>
    </div>
  );
}
