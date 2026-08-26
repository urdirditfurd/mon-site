import { z } from "zod";

export const VAT_RATES = [20, 10, 5.5, 0] as const;

const numberFromInput = z.preprocess((value) => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return value;
}, z.number());

export const invoiceLineSchema = z.object({
  id: z.string().optional(),
  description: z.string().min(1, "Description obligatoire"),
  quantity: numberFromInput.pipe(z.number().positive("Quantité > 0")),
  unitPriceHt: numberFromInput.pipe(z.number().min(0, "Prix unitaire invalide")),
  vatRate: numberFromInput.pipe(
    z.number().refine((v) => (VAT_RATES as readonly number[]).includes(v), {
      message: "Taux de TVA non supporté",
    }),
  ),
});

export const invoiceFormSchema = z
  .object({
    type: z.enum(["QUOTE", "INVOICE", "CREDIT_NOTE"]),
    status: z.enum([
      "DRAFT",
      "SENT",
      "ACCEPTED",
      "PAID",
      "OVERDUE",
      "CANCELLED",
      "REJECTED",
    ]),
    partyId: z.string().min(1, "Client obligatoire"),
    number: z.string().optional().nullable(),
    issueDate: z.string().min(1, "Date d'émission obligatoire"),
    dueDate: z.string().min(1, "Date d'échéance obligatoire"),
    notes: z.string().optional().nullable(),
    currency: z.string(),
    lines: z.array(invoiceLineSchema).min(1, "Ajoutez au moins une ligne"),
  })
  .superRefine((data, ctx) => {
    const issue = new Date(data.issueDate);
    const due = new Date(data.dueDate);
    if (Number.isNaN(issue.getTime()) || Number.isNaN(due.getTime())) {
      ctx.addIssue({
        code: "custom",
        path: ["issueDate"],
        message: "Dates invalides",
      });
      return;
    }
    if (due < issue) {
      ctx.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "L'échéance doit être postérieure à l'émission",
      });
    }
    const hasPositive = data.lines.some(
      (line) => line.quantity * line.unitPriceHt > 0,
    );
    if (!hasPositive && data.type !== "CREDIT_NOTE") {
      ctx.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Le montant HT doit être supérieur à 0",
      });
    }
  });

export type InvoiceFormData = z.infer<typeof invoiceFormSchema>;
export type InvoiceLineFormData = z.infer<typeof invoiceLineSchema>;
