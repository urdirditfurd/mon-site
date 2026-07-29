import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { mockBankTransactions } from "@/lib/mock-data";
import { formatCurrency, formatDate } from "@/lib/utils";

export default function TresoreriePage() {
  return (
    <AppShell
      title="Trésorerie & Banque"
      subtitle="Import → Lettrage automatique → Rapprochement"
    >
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Stratégie d&apos;intégration</CardTitle>
            <CardDescription>
              Phase 1 : CSV · Phase 2 : Bridge / Budget Insight / GoCardless
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-4">
              {[
                { name: "CSV manuel", cost: "Gratuit", tag: "MVP" },
                { name: "Bridge.io", cost: "~5€/banque", tag: "Prod" },
                { name: "Budget Insight", cost: "Sur devis", tag: "Prod" },
                { name: "GoCardless", cost: "Freemium", tag: "MVP+" },
              ].map((opt) => (
                <div
                  key={opt.name}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"
                >
                  <p className="text-sm font-semibold text-slate-900">{opt.name}</p>
                  <p className="mt-1 text-xs text-slate-500">{opt.cost}</p>
                  <Badge variant="navy" className="mt-2">
                    {opt.tag}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Transactions récentes</CardTitle>
            <CardDescription>
              Règles de lettrage (ex. URSSAF → 431) prêtes côté schéma
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-[11px] tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Libellé</th>
                    <th className="px-4 py-3 font-medium">Compte suggéré</th>
                    <th className="px-4 py-3 font-medium">Lettrage</th>
                    <th className="px-4 py-3 text-right font-medium">Montant</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {mockBankTransactions.map((txn) => (
                    <tr key={txn.id}>
                      <td className="px-4 py-3 text-slate-600">
                        {formatDate(txn.bookingDate)}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{txn.label}</p>
                        <p className="text-xs text-slate-500">
                          {txn.bankAccountName}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">
                        {txn.suggestedAccount ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={txn.isMatched ? "success" : "warning"}>
                          {txn.isMatched ? "Lettré" : "À traiter"}
                        </Badge>
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-medium tabular-nums ${
                          txn.amount < 0 ? "text-rose-600" : "text-emerald-700"
                        }`}
                      >
                        {formatCurrency(txn.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
