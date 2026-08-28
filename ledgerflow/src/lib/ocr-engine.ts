/**
 * Moteur OCR notes de frais.
 *
 * MVP local : mock réaliste (délai ~1.5s) selon le nom de fichier.
 * Production : brancher ici une API réelle —
 *   - OpenAI Vision (gpt-4o) avec image base64
 *   - AWS Textract AnalyzeExpense
 *   - Mindee Receipt OCR
 *   - ou microservice FastAPI + Tesseract (`src/lib/ocr/extract.ts`)
 */

import { z } from "zod";
import {
  categorizeTransaction,
  type CategorySuggestion,
  type CategorizationRuleRef,
  type PcgAccountRef,
} from "@/lib/categorization-engine";
import { estimateVatFromTtc } from "@/lib/financial-engine";

export const ocrReceiptSchema = z.object({
  vendor: z.string().min(1),
  date: z.string().min(1),
  total: z.number().positive(),
  vat: z.number().min(0).nullable(),
  vatEstimated: z.boolean(),
  confidence: z.number().min(0).max(1),
  categoryHint: z
    .enum([
      "RESTAURANT",
      "TRANSPORT",
      "HOTEL",
      "SUPPLIES",
      "SOFTWARE",
      "TRAINING",
      "OTHER",
    ])
    .default("OTHER"),
  rawText: z.string(),
});

export type OcrReceiptData = z.infer<typeof ocrReceiptSchema>;

export interface ExpenseOcrResult {
  ocr: OcrReceiptData;
  categorySuggestion: CategorySuggestion | null;
}

const MOCKS: Array<{
  match: RegExp;
  data: Omit<OcrReceiptData, "confidence" | "rawText" | "vatEstimated"> & {
    vatEstimated?: boolean;
  };
}> = [
  {
    match: /sncf|train|tgv/i,
    data: {
      vendor: "SNCF",
      date: "2026-07-25",
      total: 45,
      vat: 4.09,
      vatEstimated: false,
      categoryHint: "TRANSPORT",
    },
  },
  {
    match: /uber|bolt|taxi/i,
    data: {
      vendor: "Uber",
      date: "2026-07-22",
      total: 15.5,
      vat: estimateVatFromTtc(15.5),
      vatEstimated: true,
      categoryHint: "TRANSPORT",
    },
  },
  {
    match: /bistro|restaurant|comptoir|cafe|café/i,
    data: {
      vendor: "Restaurant Le Bistro",
      date: "2026-07-18",
      total: 120,
      vat: 20,
      vatEstimated: false,
      categoryHint: "RESTAURANT",
    },
  },
  {
    match: /esso|total|station|shell/i,
    data: {
      vendor: "Station Essence",
      date: "2026-07-19",
      total: 58.4,
      vat: estimateVatFromTtc(58.4),
      vatEstimated: true,
      categoryHint: "TRANSPORT",
    },
  },
];

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extrait les données d'un reçu.
 * @param fileName — nom du fichier uploadé (sert au mock)
 * @param fileBuffer — bytes de l'image (pour future API Vision)
 */
export async function extractReceiptData(
  fileName: string,
  fileBuffer?: Buffer,
): Promise<OcrReceiptData> {
  // --- Production hook ---
  // if (process.env.OPENAI_API_KEY) {
  //   return await extractWithOpenAiVision(fileBuffer);
  // }
  // if (process.env.MINDEE_API_KEY) {
  //   return await extractWithMindee(fileBuffer);
  // }
  void fileBuffer;

  await delay(1500);

  const hit = MOCKS.find((m) => m.match.test(fileName));
  if (hit) {
    const parsed = ocrReceiptSchema.parse({
      ...hit.data,
      vatEstimated: hit.data.vatEstimated ?? false,
      confidence: 0.92,
      rawText: `MOCK OCR\n${hit.data.vendor}\n${hit.data.date}\nTTC ${hit.data.total}`,
    });
    return parsed;
  }

  // Défaut réaliste si aucun mot-clé
  return ocrReceiptSchema.parse({
    vendor: "Commerce divers",
    date: new Date().toISOString().slice(0, 10),
    total: 24.9,
    vat: estimateVatFromTtc(24.9),
    vatEstimated: true,
    categoryHint: "OTHER",
    confidence: 0.55,
    rawText: `MOCK OCR (fallback)\nfile=${fileName}`,
  });
}

/** OCR + suggestion PCG (Pilier 4). */
export async function extractAndCategorizeReceipt(
  fileName: string,
  accounts: PcgAccountRef[],
  rules: CategorizationRuleRef[],
  fileBuffer?: Buffer,
): Promise<ExpenseOcrResult> {
  const ocr = await extractReceiptData(fileName, fileBuffer);
  const categorySuggestion =
    accounts.length > 0
      ? await categorizeTransaction(ocr.vendor, -Math.abs(ocr.total), accounts, rules)
      : null;

  return { ocr, categorySuggestion };
}
