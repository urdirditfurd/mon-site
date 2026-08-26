import { NextResponse } from "next/server";
import { z } from "zod";
import { endOfDay, parseISO, startOfDay } from "date-fns";
import { DEMO_COMPANY_ID } from "@/lib/company";
import { generateFEC } from "@/lib/fec-generator";

export const runtime = "nodejs";

const bodySchema = z.object({
  companyId: z.string().min(1).optional(),
  startDate: z.string().min(8),
  endDate: z.string().min(8),
});

function parseDateInput(value: string, end = false): Date {
  // Accepte YYYY-MM-DD ou AAAAMMJJ
  const iso =
    /^\d{8}$/.test(value)
      ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
      : value;
  const d = parseISO(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Date invalide : ${value}`);
  }
  return end ? endOfDay(d) : startOfDay(d);
}

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Paramètres invalides", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const startDate = parseDateInput(parsed.data.startDate, false);
    const endDate = parseDateInput(parsed.data.endDate, true);

    if (startDate > endDate) {
      return NextResponse.json(
        { error: "La date de début doit précéder la date de fin." },
        { status: 400 },
      );
    }

    const result = await generateFEC(
      parsed.data.companyId ?? DEMO_COMPANY_ID,
      startDate,
      endDate,
    );

    return new NextResponse(result.csv, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "no-store",
        "X-FEC-Rows": String(result.rows.length),
        "X-FEC-Balanced": result.totals.balanced ? "1" : "0",
      },
    });
  } catch (error) {
    console.error("[api/fec]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Échec de la génération du FEC",
      },
      { status: 500 },
    );
  }
}
