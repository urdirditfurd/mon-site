/**
 * Génération PDF devis / factures.
 * Prochaine étape : @react-pdf/renderer ou jsPDF.
 */

export interface PdfDocumentInput {
  number: string;
  partyName: string;
  totalTtc: number;
  issueDate: string;
}

export async function generateInvoicePdf(
  input: PdfDocumentInput,
): Promise<{ url: string }> {
  // Placeholder — URL mock jusqu'au module PDF.
  return {
    url: `/api/pdf/mock/${encodeURIComponent(input.number)}.pdf`,
  };
}
