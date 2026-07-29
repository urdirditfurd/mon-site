"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { format } from "date-fns";
import { Plus, Trash2 } from "lucide-react";
import {
  invoiceFormSchema,
  VAT_RATES,
  type InvoiceFormData,
} from "@/lib/invoices/schema";
import { computeInvoiceTotals } from "@/lib/invoices/totals";
import { createInvoice, updateInvoice } from "@/app/actions/invoice";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface PartyOption {
  id: string;
  name: string;
  siret?: string | null;
}

interface InvoiceFormProps {
  parties: PartyOption[];
  suggestedNumber: string;
  mode: "create" | "edit";
  invoiceId?: string;
  numberLocked?: boolean;
  defaultValues?: Partial<InvoiceFormData>;
}

function todayIso(): string {
  return format(new Date(), "yyyy-MM-dd");
}

function plusDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return format(d, "yyyy-MM-dd");
}

export function InvoiceForm({
  parties,
  suggestedNumber,
  mode,
  invoiceId,
  numberLocked = false,
  defaultValues,
}: InvoiceFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [submitIntent, setSubmitIntent] = useState<"DRAFT" | "SENT">("DRAFT");

  const form = useForm<InvoiceFormData>({
    resolver: zodResolver(invoiceFormSchema) as Resolver<InvoiceFormData>,
    defaultValues: {
      type: "INVOICE",
      status: "DRAFT",
      partyId: "",
      number: suggestedNumber,
      issueDate: todayIso(),
      dueDate: plusDaysIso(30),
      notes: "",
      currency: "EUR",
      lines: [
        {
          description: "",
          quantity: 1,
          unitPriceHt: 0,
          vatRate: 20,
        },
      ],
      ...defaultValues,
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "lines",
  });

  const watchedLines = form.watch("lines");
  const totals = useMemo(
    () => computeInvoiceTotals(watchedLines || []),
    [watchedLines],
  );

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const payload: InvoiceFormData = {
        ...values,
        status: submitIntent === "SENT" ? "SENT" : values.status || "DRAFT",
        number: values.number?.trim() || suggestedNumber,
      };

      const result =
        mode === "edit" && invoiceId
          ? await updateInvoice(invoiceId, payload)
          : await createInvoice(payload);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(
        mode === "edit" ? "Document mis à jour" : "Document créé",
      );
      router.push("/facturation");
      router.refresh();
    });
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>
            {mode === "edit" ? "Modifier le document" : "Nouveau document"}
          </CardTitle>
          <CardDescription>
            Numérotation séquentielle française · totaux HT / TVA / TTC en direct
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="partyId">Client *</Label>
            <Select id="partyId" {...form.register("partyId")}>
              <option value="">Sélectionner un client…</option>
              {parties.map((party) => (
                <option key={party.id} value={party.id}>
                  {party.name}
                  {party.siret ? ` · ${party.siret}` : ""}
                </option>
              ))}
            </Select>
            {form.formState.errors.partyId ? (
              <p className="text-xs text-rose-600">
                {form.formState.errors.partyId.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="type">Type</Label>
            <Select id="type" {...form.register("type")}>
              <option value="INVOICE">Facture</option>
              <option value="QUOTE">Devis</option>
              <option value="CREDIT_NOTE">Avoir</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="number">
              Numéro {numberLocked ? "(verrouillé)" : "(suggéré)"}
            </Label>
            <Input
              id="number"
              {...form.register("number")}
              disabled={numberLocked}
              placeholder={suggestedNumber}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="issueDate">Date d&apos;émission *</Label>
            <Input id="issueDate" type="date" {...form.register("issueDate")} />
            {form.formState.errors.issueDate ? (
              <p className="text-xs text-rose-600">
                {form.formState.errors.issueDate.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dueDate">Date d&apos;échéance *</Label>
            <Input id="dueDate" type="date" {...form.register("dueDate")} />
            {form.formState.errors.dueDate ? (
              <p className="text-xs text-rose-600">
                {form.formState.errors.dueDate.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5 md:col-span-2 xl:col-span-3">
            <Label htmlFor="notes">Notes / conditions</Label>
            <Textarea id="notes" rows={3} {...form.register("notes")} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Lignes</CardTitle>
            <CardDescription>
              Description, quantité, PU HT, taux de TVA
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              append({
                description: "",
                quantity: 1,
                unitPriceHt: 0,
                vatRate: 20,
              })
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Ligne
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[11px] tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Description</th>
                  <th className="px-3 py-2 text-right font-medium">Qté</th>
                  <th className="px-3 py-2 text-right font-medium">PU HT</th>
                  <th className="px-3 py-2 text-right font-medium">TVA</th>
                  <th className="px-3 py-2 text-right font-medium">Total HT</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {fields.map((field, index) => {
                  const line = watchedLines?.[index];
                  const lineHt =
                    line != null
                      ? Number(line.quantity || 0) * Number(line.unitPriceHt || 0)
                      : 0;
                  return (
                    <tr key={field.id}>
                      <td className="px-3 py-2">
                        <Input
                          {...form.register(`lines.${index}.description`)}
                          placeholder="Prestation…"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          step="0.001"
                          min="0"
                          className="text-right"
                          {...form.register(`lines.${index}.quantity`)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className="text-right"
                          {...form.register(`lines.${index}.unitPriceHt`)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Select
                          className="text-right"
                          {...form.register(`lines.${index}.vatRate`)}
                        >
                          {VAT_RATES.map((rate) => (
                            <option key={rate} value={rate}>
                              {rate} %
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {formatCurrency(lineHt)}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={fields.length <= 1}
                          onClick={() => remove(index)}
                          aria-label="Supprimer la ligne"
                        >
                          <Trash2 className="h-4 w-4 text-rose-500" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {form.formState.errors.lines?.root ? (
            <p className="text-xs text-rose-600">
              {form.formState.errors.lines.root.message}
            </p>
          ) : form.formState.errors.lines?.message ? (
            <p className="text-xs text-rose-600">
              {String(form.formState.errors.lines.message)}
            </p>
          ) : null}

          <div className="ml-auto w-full max-w-xs space-y-1 rounded-lg bg-slate-50 px-4 py-3 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Total HT</span>
              <span className="tabular-nums">
                {formatCurrency(totals.subtotalHt)}
              </span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Total TVA</span>
              <span className="tabular-nums">
                {formatCurrency(totals.vatAmount)}
              </span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold text-[#0B1F33]">
              <span>Total TTC</span>
              <span className="tabular-nums">
                {formatCurrency(totals.totalTtc)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.push("/facturation")}
          disabled={pending}
        >
          Annuler
        </Button>
        <Button
          type="submit"
          variant="secondary"
          disabled={pending}
          onClick={() => {
            setSubmitIntent("DRAFT");
            form.setValue("status", "DRAFT");
          }}
        >
          {pending && submitIntent === "DRAFT" ? <Spinner /> : null}
          Enregistrer brouillon
        </Button>
        <Button
          type="submit"
          disabled={pending}
          onClick={() => {
            setSubmitIntent("SENT");
            form.setValue("status", "SENT");
          }}
        >
          {pending && submitIntent === "SENT" ? <Spinner /> : null}
          Enregistrer & émettre
        </Button>
      </div>
    </form>
  );
}
