"use server";

import { revalidatePath } from "next/cache";
import type { InvoiceStatus, InvoiceType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEMO_COMPANY_ID, ensureDemoCompany } from "@/lib/company";
import {
  invoiceFormSchema,
  type InvoiceFormData,
} from "@/lib/invoices/schema";
import { computeInvoiceTotals } from "@/lib/invoices/totals";
import { allocateInvoiceNumber } from "@/lib/invoices/numbering";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function revalidateInvoicePaths(id?: string) {
  revalidatePath("/facturation");
  revalidatePath("/");
  if (id) {
    revalidatePath(`/facturation/${id}`);
    revalidatePath(`/facturation/${id}/modifier`);
  }
}

function parseForm(raw: unknown): ActionResult<InvoiceFormData> {
  const parsed = invoiceFormSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join(" · ");
    return { ok: false, error: message || "Données invalides" };
  }
  return { ok: true, data: parsed.data };
}

function requireForm(raw: unknown): InvoiceFormData {
  const parsed = parseForm(raw);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  if (!parsed.data) {
    throw new Error("Données invalides");
  }
  return parsed.data;
}

async function assertEditable(invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, companyId: DEMO_COMPANY_ID },
  });
  if (!invoice) return { ok: false as const, error: "Facture introuvable" };
  if (invoice.status === "CANCELLED") {
    return { ok: false as const, error: "Document annulé — non modifiable" };
  }
  if (invoice.status === "PAID") {
    return {
      ok: false as const,
      error: "Document payé — créez un avoir pour corriger",
    };
  }
  return { ok: true as const, invoice };
}

export async function createInvoice(
  raw: unknown,
): Promise<ActionResult<{ id: string }>> {
  let data: InvoiceFormData;
  try {
    data = requireForm(raw);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Données invalides",
    };
  }

  try {
    await ensureDemoCompany();
    const totals = computeInvoiceTotals(data.lines);

    const invoice = await prisma.$transaction(async (tx) => {
      let number = data.number?.trim() || null;

      // Brouillon : numéro optionnel. Sinon allocation séquentielle obligatoire.
      if (!number && data.status !== "DRAFT") {
        number = await allocateInvoiceNumber(
          tx,
          DEMO_COMPANY_ID,
          data.type as InvoiceType,
        );
      }

      if (number) {
        const clash = await tx.invoice.findFirst({
          where: { companyId: DEMO_COMPANY_ID, number },
        });
        if (clash) {
          throw new Error(`Le numéro ${number} existe déjà`);
        }
      }

      return tx.invoice.create({
        data: {
          companyId: DEMO_COMPANY_ID,
          partyId: data.partyId,
          type: data.type as InvoiceType,
          status: data.status as InvoiceStatus,
          number,
          issueDate: new Date(data.issueDate),
          dueDate: new Date(data.dueDate),
          currency: data.currency || "EUR",
          subtotalHt: totals.subtotalHt,
          vatAmount: totals.vatAmount,
          totalTtc: totals.totalTtc,
          vatRate: data.lines[0]?.vatRate ?? 20,
          notes: data.notes || null,
          paidAt: data.status === "PAID" ? new Date() : null,
          lines: {
            create: data.lines.map((line, index) => ({
              description: line.description,
              quantity: line.quantity,
              unitPriceHt: line.unitPriceHt,
              vatRate: line.vatRate,
              amountHt: totals.lines[index].amountHt,
              sortOrder: index,
            })),
          },
        },
      });
    });

    revalidateInvoicePaths(invoice.id);
    return { ok: true, data: { id: invoice.id } };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Création impossible";
    return { ok: false, error: message };
  }
}

export async function updateInvoice(
  id: string,
  raw: unknown,
): Promise<ActionResult<{ id: string }>> {
  let data: InvoiceFormData;
  try {
    data = requireForm(raw);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Données invalides",
    };
  }

  const gate = await assertEditable(id);
  if (!gate.ok) return { ok: false, error: gate.error };

  try {
    const totals = computeInvoiceTotals(data.lines);
    const existing = gate.invoice;

    // Numéro émis : immutable (conformité séquence française).
    let number = existing.number;
    if (!existing.number) {
      number = data.number?.trim() || null;
      if (!number && data.status !== "DRAFT") {
        number = await allocateInvoiceNumber(
          prisma,
          DEMO_COMPANY_ID,
          data.type as InvoiceType,
        );
      }
    }

    if (number && number !== existing.number) {
      const clash = await prisma.invoice.findFirst({
        where: {
          companyId: DEMO_COMPANY_ID,
          number,
          NOT: { id },
        },
      });
      if (clash) {
        return { ok: false, error: `Le numéro ${number} existe déjà` };
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
      await tx.invoice.update({
        where: { id },
        data: {
          partyId: data.partyId,
          type: data.type as InvoiceType,
          status: data.status as InvoiceStatus,
          number,
          issueDate: new Date(data.issueDate),
          dueDate: new Date(data.dueDate),
          currency: data.currency || "EUR",
          subtotalHt: totals.subtotalHt,
          vatAmount: totals.vatAmount,
          totalTtc: totals.totalTtc,
          vatRate: data.lines[0]?.vatRate ?? 20,
          notes: data.notes || null,
          paidAt:
            data.status === "PAID"
              ? existing.paidAt ?? new Date()
              : existing.paidAt,
          lines: {
            create: data.lines.map((line, index) => ({
              description: line.description,
              quantity: line.quantity,
              unitPriceHt: line.unitPriceHt,
              vatRate: line.vatRate,
              amountHt: totals.lines[index].amountHt,
              sortOrder: index,
            })),
          },
        },
      });
    });

    revalidateInvoicePaths(id);
    return { ok: true, data: { id } };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Mise à jour impossible";
    return { ok: false, error: message };
  }
}

/**
 * Soft delete : annulation pour préserver la séquence de numérotation.
 * Hard delete uniquement pour les brouillons sans numéro.
 */
export async function deleteInvoice(id: string): Promise<ActionResult> {
  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id, companyId: DEMO_COMPANY_ID },
    });
    if (!invoice) return { ok: false, error: "Facture introuvable" };

    if (invoice.status === "DRAFT" && !invoice.number) {
      await prisma.invoice.delete({ where: { id } });
    } else {
      await prisma.invoice.update({
        where: { id },
        data: { status: "CANCELLED" },
      });
    }

    revalidateInvoicePaths(id);
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Suppression impossible";
    return { ok: false, error: message };
  }
}

export async function markAsPaid(id: string): Promise<ActionResult> {
  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id, companyId: DEMO_COMPANY_ID },
    });
    if (!invoice) return { ok: false, error: "Facture introuvable" };
    if (invoice.status === "CANCELLED") {
      return { ok: false, error: "Document annulé" };
    }
    if (invoice.type === "QUOTE") {
      return { ok: false, error: "Un devis ne peut pas être marqué payé" };
    }

    let number = invoice.number;
    if (!number) {
      number = await allocateInvoiceNumber(
        prisma,
        DEMO_COMPANY_ID,
        invoice.type,
      );
    }

    await prisma.invoice.update({
      where: { id },
      data: {
        status: "PAID",
        paidAt: new Date(),
        number,
      },
    });

    revalidateInvoicePaths(id);
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Mise à jour impossible";
    return { ok: false, error: message };
  }
}

export async function sendInvoice(id: string): Promise<ActionResult> {
  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id, companyId: DEMO_COMPANY_ID },
    });
    if (!invoice) return { ok: false, error: "Facture introuvable" };
    if (invoice.status === "CANCELLED" || invoice.status === "PAID") {
      return { ok: false, error: "Statut incompatible" };
    }

    let number = invoice.number;
    if (!number) {
      number = await allocateInvoiceNumber(
        prisma,
        DEMO_COMPANY_ID,
        invoice.type,
      );
    }

    await prisma.invoice.update({
      where: { id },
      data: { status: "SENT", number },
    });

    revalidateInvoicePaths(id);
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Envoi impossible";
    return { ok: false, error: message };
  }
}
