import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "../src/lib/prisma";
import { getInvoicePdfData } from "../src/lib/invoices/pdf-data";
import { InvoicePDF } from "../src/modules/invoicing/InvoicePDF";

async function main() {
  const inv = await prisma.invoice.findFirst();
  if (!inv) throw new Error("Aucune facture en base — lancez npm run db:seed");
  const data = await getInvoicePdfData(inv.id);
  if (!data) throw new Error("Données PDF introuvables");
  const buffer = await renderToBuffer(
    createElement(InvoicePDF, { data }) as Parameters<typeof renderToBuffer>[0],
  );
  console.log(`PDF_OK ${inv.number} ${buffer.length} bytes`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
