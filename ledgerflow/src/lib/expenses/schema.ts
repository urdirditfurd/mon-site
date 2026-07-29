import { z } from "zod";

export const expenseReviewSchema = z
  .object({
    merchantName: z.string().min(1, "Fournisseur obligatoire"),
    expenseDate: z.string().min(1, "Date obligatoire"),
    amountTtc: z.coerce.number().positive("Montant TTC > 0"),
    vatAmount: z.coerce.number().min(0).nullable().optional(),
    vatEstimated: z.boolean().optional(),
    accountId: z.string().min(1, "Compte PCG obligatoire"),
    category: z.enum([
      "RESTAURANT",
      "TRANSPORT",
      "HOTEL",
      "SUPPLIES",
      "SOFTWARE",
      "TRAINING",
      "OTHER",
    ]),
    note: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    photoUrl: z.string().optional().nullable(),
    ocrData: z.unknown().optional(),
    ocrConfidence: z.number().optional().nullable(),
    status: z.enum(["DRAFT", "PENDING"]).default("PENDING"),
  })
  .superRefine((data, ctx) => {
    const d = new Date(data.expenseDate);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({
        code: "custom",
        path: ["expenseDate"],
        message: "Date invalide",
      });
      return;
    }
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (d > today) {
      ctx.addIssue({
        code: "custom",
        path: ["expenseDate"],
        message: "La date ne peut pas être dans le futur",
      });
    }
  });

export type ExpenseReviewData = z.infer<typeof expenseReviewSchema>;
