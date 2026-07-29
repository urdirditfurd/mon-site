import { Camera, CheckCircle2, ScanLine } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { mockExpenses } from "@/lib/mock-data";
import { formatCurrency, formatDate } from "@/lib/utils";
import { getExpenseStatusMeta } from "@/lib/status";

const categoryLabels: Record<string, string> = {
  RESTAURANT: "Restaurant",
  TRANSPORT: "Transport",
  HOTEL: "Hôtel",
  SUPPLIES: "Fournitures",
  SOFTWARE: "Logiciel",
  TRAINING: "Formation",
  OTHER: "Autre",
};

export default function NotesDeFraisPage() {
  return (
    <AppShell
      title="Notes de frais"
      subtitle="Photo → OCR → Validation → Remboursement"
    >
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              icon: Camera,
              title: "Upload mobile",
              text: "Photo ticket de caisse depuis le téléphone",
            },
            {
              icon: ScanLine,
              title: "OCR automatique",
              text: "Date, montant, fournisseur, TVA extraits",
            },
            {
              icon: CheckCircle2,
              title: "Workflow",
              text: "Employé → Manager → Comptable",
            },
          ].map((item) => (
            <Card key={item.title}>
              <CardContent className="flex items-start gap-3 pt-5">
                <div className="rounded-lg bg-slate-100 p-2 text-[#0B1F33]">
                  <item.icon className="h-4 w-4" strokeWidth={1.75} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {item.title}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{item.text}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>File de validation</CardTitle>
            <CardDescription>Données mock — OCR branché au sprint 7</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-[11px] tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th className="px-4 py-3 font-medium">Marchand</th>
                    <th className="px-4 py-3 font-medium">Catégorie</th>
                    <th className="px-4 py-3 font-medium">Employé</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Statut</th>
                    <th className="px-4 py-3 text-right font-medium">TTC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {mockExpenses.map((expense) => {
                    const status = getExpenseStatusMeta(expense.status);
                    return (
                      <tr key={expense.id}>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {expense.merchantName}
                          {expense.ocrConfidence ? (
                            <span className="mt-0.5 block text-xs font-normal text-slate-500">
                              Confiance OCR{" "}
                              {Math.round(expense.ocrConfidence * 100)}%
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {categoryLabels[expense.category]}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {expense.employeeName}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {formatDate(expense.expenseDate)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {expense.amountTtc
                            ? formatCurrency(expense.amountTtc)
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
