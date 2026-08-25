/**
 * Parsing CSV bancaire robuste (Qonto / Revolut / formats FR).
 * Gère séparateurs ; ou ,, décimales à virgule, colonnes Débit/Crédit.
 */

import Papa from "papaparse";
import { parse, isValid } from "date-fns";

export type CsvField = "date" | "label" | "amount" | "debit" | "credit" | "ignore";

export interface CsvColumnMapping {
  [header: string]: CsvField;
}

export interface ParsedBankRow {
  bookingDate: string; // ISO yyyy-MM-dd
  label: string;
  amount: number;
  raw: Record<string, string>;
}

export interface CsvParseResult {
  headers: string[];
  rows: Record<string, string>[];
  delimiter: string;
}

const DATE_FORMATS = [
  "dd/MM/yyyy",
  "d/M/yyyy",
  "yyyy-MM-dd",
  "dd-MM-yyyy",
  "dd.MM.yyyy",
];

export function detectDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semis = (firstLine.match(/;/g) ?? []).length;
  return semis >= commas ? ";" : ",";
}

export function parseBankCsv(text: string): CsvParseResult {
  const delimiter = detectDelimiter(text);
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    delimiter,
    transformHeader: (h) => h.trim(),
  });

  const headers = parsed.meta.fields?.filter(Boolean) ?? [];
  const rows = (parsed.data ?? []).filter((row) =>
    Object.values(row).some((v) => String(v ?? "").trim() !== ""),
  );

  return { headers, rows, delimiter };
}

export function suggestColumnMapping(headers: string[]): CsvColumnMapping {
  const mapping: CsvColumnMapping = {};
  for (const header of headers) {
    const h = header.toLowerCase();
    if (
      /(date.*(ope|compta|valeur|transaction)|^date$|booking)/i.test(h) ||
      h === "date"
    ) {
      mapping[header] = "date";
    } else if (/(libell|label|description|memo|wording|counterpart)/i.test(h)) {
      mapping[header] = "label";
    } else if (/^d[eé]bit$/i.test(h) || h.includes("debit")) {
      mapping[header] = "debit";
    } else if (/^cr[eé]dit$/i.test(h) || h.includes("credit")) {
      mapping[header] = "credit";
    } else if (/(montant|amount|sum|valeur)/i.test(h)) {
      mapping[header] = "amount";
    } else {
      mapping[header] = "ignore";
    }
  }
  return mapping;
}

export function parseFrenchAmount(raw: string): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/\s/g, "").replace(/€/g, "").replace(/EUR/gi, "");
  // 1.234,56 → 1234.56 ; 1234.56 reste 1234.56
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseFlexibleDate(raw: string): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  for (const fmt of DATE_FORMATS) {
    const d = parse(s, fmt, new Date());
    if (isValid(d)) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
  }
  const iso = new Date(s);
  if (!Number.isNaN(iso.getTime())) {
    return iso.toISOString().slice(0, 10);
  }
  return null;
}

export function applyMapping(
  rows: Record<string, string>[],
  mapping: CsvColumnMapping,
): { rows: ParsedBankRow[]; errors: string[] } {
  const dateCol = Object.entries(mapping).find(([, v]) => v === "date")?.[0];
  const labelCol = Object.entries(mapping).find(([, v]) => v === "label")?.[0];
  const amountCol = Object.entries(mapping).find(([, v]) => v === "amount")?.[0];
  const debitCol = Object.entries(mapping).find(([, v]) => v === "debit")?.[0];
  const creditCol = Object.entries(mapping).find(([, v]) => v === "credit")?.[0];

  const errors: string[] = [];
  if (!dateCol) errors.push("Colonne Date manquante");
  if (!labelCol) errors.push("Colonne Libellé manquante");
  if (!amountCol && !debitCol && !creditCol) {
    errors.push("Colonne Montant (ou Débit/Crédit) manquante");
  }
  if (errors.length) return { rows: [], errors };

  const out: ParsedBankRow[] = [];
  rows.forEach((row, index) => {
    const bookingDate = parseFlexibleDate(row[dateCol!]);
    const label = String(row[labelCol!] ?? "").trim();
    let amount: number | null = null;

    if (amountCol) {
      amount = parseFrenchAmount(row[amountCol]);
    } else {
      const debit = debitCol ? parseFrenchAmount(row[debitCol]) : null;
      const credit = creditCol ? parseFrenchAmount(row[creditCol]) : null;
      if (credit && credit !== 0) amount = Math.abs(credit);
      else if (debit && debit !== 0) amount = -Math.abs(debit);
      else amount = 0;
    }

    if (!bookingDate || !label || amount == null) {
      errors.push(`Ligne ${index + 2} ignorée (date/libellé/montant invalide)`);
      return;
    }

    out.push({
      bookingDate,
      label,
      amount,
      raw: row,
    });
  });

  return { rows: out, errors };
}
