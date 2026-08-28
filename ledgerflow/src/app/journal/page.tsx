import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { mockAccountingEntries } from "@/lib/mock-data";
import { formatCurrency, formatDate } from "@/lib/utils";

const pcgPreview = [
  { number: "401", label: "Fournisseurs", type: "LIABILITY" },
  { number: "411", label: "Clients", type: "ASSET" },
  { number: "421", label: "Personnel — rémunérations dues", type: "LIABILITY" },
  { number: "431", label: "Sécurité sociale", type: "LIABILITY" },
  { number: "44566", label: "TVA déductible", type: "ASSET" },
  { number: "44571", label: "TVA collectée", type: "LIABILITY" },
  { number: "512", label: "Banque", type: "ASSET" },
  { number: "606", label: "Achats non stockés", type: "EXPENSE" },
  { number: "6251", label: "Voyages et déplacements", type: "EXPENSE" },
  { number: "706", label: "Prestations de services", type: "REVENUE" },
];

export default function JournalPage() {
  return (
    <AppShell
      title="Journal comptable"
      subtitle="Le cerveau — classification, PCG, export FEC"
    >
      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle>Écritures récentes</CardTitle>
            <CardDescription>
              Transaction brute → Classification → Validation
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-[11px] tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Journal</th>
                    <th className="px-4 py-3 font-medium">Libellé</th>
                    <th className="px-4 py-3 font-medium">État</th>
                    <th className="px-4 py-3 text-right font-medium">Mouvement</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {mockAccountingEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="px-4 py-3 text-slate-600">
                        {formatDate(entry.entryDate)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                          {entry.journalCode}
                        </span>
                        {entry.pieceRef ? (
                          <span className="ml-2 text-xs text-slate-500">
                            {entry.pieceRef}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-slate-800">{entry.label}</td>
                      <td className="px-4 py-3">
                        <Badge variant={entry.isValidated ? "success" : "warning"}>
                          {entry.isValidated ? "Validée" : "Proposition"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                        {formatCurrency(entry.debit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Plan comptable (extrait PCG)</CardTitle>
            <CardDescription>Comptes prêts pour le moteur de règles</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-slate-100">
              {pcgPreview.map((account) => (
                <li
                  key={account.number}
                  className="flex items-center justify-between py-2.5"
                >
                  <div>
                    <p className="font-mono text-xs text-[#0B1F33]">
                      {account.number}
                    </p>
                    <p className="text-sm text-slate-700">{account.label}</p>
                  </div>
                  <Badge variant="muted">{account.type}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
