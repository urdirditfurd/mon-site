/**
 * Extraction OCR des tickets de caisse.
 * Sprint 7 : FastAPI + Tesseract (microservice Python séparé).
 */

export interface OcrExtraction {
  date?: string;
  amountTtc?: number;
  merchantName?: string;
  vatAmount?: number;
  confidence: number;
  rawText: string;
}

export async function extractReceiptFromImage(
  imageUrl: string,
): Promise<OcrExtraction> {
  // Placeholder — brancher le microservice OCR.
  void imageUrl;
  return {
    confidence: 0,
    rawText: "",
  };
}
