import { NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";
import { getInvoicePdfData } from "@/lib/invoices/pdf-data";
import { InvoicePDF } from "@/modules/invoicing/InvoicePDF";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: { id: string } },
) {
  const data = await getInvoicePdfData(context.params.id);

  if (!data) {
    return NextResponse.json({ error: "Facture introuvable" }, { status: 404 });
  }

  const element = createElement(InvoicePDF, {
    data,
  }) as unknown as ReactElement<DocumentProps>;
  const buffer = await renderToBuffer(element);

  const filename = `${data.typeLabel}-${data.number}.pdf`.replace(/\s+/g, "_");

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
