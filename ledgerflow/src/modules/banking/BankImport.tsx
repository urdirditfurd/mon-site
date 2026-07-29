"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useDropzone } from "react-dropzone";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileSpreadsheet, Upload } from "lucide-react";
import {
  applyMapping,
  parseBankCsv,
  suggestColumnMapping,
  type CsvColumnMapping,
  type CsvField,
  type ParsedBankRow,
} from "@/lib/banking/csv";
import { importBankTransactions } from "@/app/actions/banking";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";

const FIELD_OPTIONS: Array<{ value: CsvField; label: string }> = [
  { value: "ignore", label: "Ignorer" },
  { value: "date", label: "Date" },
  { value: "label", label: "Libellé" },
  { value: "amount", label: "Montant" },
  { value: "debit", label: "Débit" },
  { value: "credit", label: "Crédit" },
];

interface BankAccountOption {
  id: string;
  name: string;
  iban: string | null;
}

interface BankImportProps {
  accounts: BankAccountOption[];
}

export function BankImport({ accounts }: BankImportProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [bankAccountId, setBankAccountId] = useState(accounts[0]?.id ?? "");
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<CsvColumnMapping>({});
  const [mappedRows, setMappedRows] = useState<ParsedBankRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);

  const onDrop = useCallback((accepted: File[]) => {
    const file = accepted[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const parsed = parseBankCsv(text);
      const suggested = suggestColumnMapping(parsed.headers);
      const applied = applyMapping(parsed.rows, suggested);
      setFileName(file.name);
      setHeaders(parsed.headers);
      setRawRows(parsed.rows);
      setMapping(suggested);
      setMappedRows(applied.rows);
      setParseErrors(applied.errors);
      toast.success(`${parsed.rows.length} lignes lues depuis ${file.name}`);
    };
    reader.readAsText(file, "UTF-8");
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
      "text/plain": [".txt", ".csv"],
      "application/vnd.ms-excel": [".csv"],
    },
    multiple: false,
  });

  const preview = useMemo(() => mappedRows.slice(0, 5), [mappedRows]);

  const updateMapping = (header: string, field: CsvField) => {
    const next = { ...mapping, [header]: field };
    setMapping(next);
    const applied = applyMapping(rawRows, next);
    setMappedRows(applied.rows);
    setParseErrors(applied.errors);
  };

  const onImport = () => {
    if (!bankAccountId) {
      toast.error("Sélectionnez un compte bancaire");
      return;
    }
    if (!mappedRows.length) {
      toast.error("Aucune ligne valide à importer");
      return;
    }
    startTransition(async () => {
      const result = await importBankTransactions(mappedRows, bankAccountId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `${result.data?.imported ?? 0} importée(s)` +
          (result.data?.skipped
            ? ` · ${result.data.skipped} doublon(s) ignoré(s)`
            : ""),
      );
      setFileName(null);
      setHeaders([]);
      setRawRows([]);
      setMappedRows([]);
      setMapping({});
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import CSV bancaire</CardTitle>
        <CardDescription>
          Formats Qonto / Revolut / export FR (séparateur ; ou ,, Débit/Crédit)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-sm space-y-1.5">
          <label className="text-xs font-medium text-slate-600">Compte</label>
          <Select
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
                {account.iban ? ` · ${account.iban}` : ""}
              </option>
            ))}
          </Select>
        </div>

        <div
          {...getRootProps()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 transition ${
            isDragActive
              ? "border-[#0B1F33] bg-[#0B1F33]/5"
              : "border-slate-200 bg-slate-50 hover:border-slate-300"
          }`}
        >
          <input {...getInputProps()} />
          <Upload className="mb-2 h-6 w-6 text-[#0B1F33]" strokeWidth={1.75} />
          <p className="text-sm font-medium text-slate-800">
            Glissez un CSV ici, ou cliquez pour choisir
          </p>
          <p className="mt-1 text-xs text-slate-500">
            .csv · dates DD/MM/YYYY · montants 1 234,56
          </p>
          {fileName ? (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1 text-xs text-slate-600 ring-1 ring-slate-200">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              {fileName}
            </p>
          ) : null}
        </div>

        {headers.length > 0 ? (
          <div className="space-y-3">
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Mapping des colonnes
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {headers.map((header) => (
                <div
                  key={header}
                  className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">
                    {header}
                  </span>
                  <Select
                    className="h-8 w-[120px] text-xs"
                    value={mapping[header] ?? "ignore"}
                    onChange={(e) =>
                      updateMapping(header, e.target.value as CsvField)
                    }
                  >
                    {FIELD_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>

            {parseErrors.length > 0 ? (
              <p className="text-xs text-amber-700">
                {parseErrors.slice(0, 3).join(" · ")}
                {parseErrors.length > 3 ? ` (+${parseErrors.length - 3})` : ""}
              </p>
            ) : null}

            <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-[11px] tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Libellé</th>
                    <th className="px-3 py-2 text-right font-medium">Montant</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.map((row, i) => (
                    <tr key={`${row.label}-${i}`}>
                      <td className="px-3 py-2 text-slate-600">
                        {formatDate(row.bookingDate)}
                      </td>
                      <td className="px-3 py-2 text-slate-800">{row.label}</td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          row.amount < 0 ? "text-rose-600" : "text-emerald-700"
                        }`}
                      >
                        {formatCurrency(row.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                Aperçu 5 / {mappedRows.length} ligne(s) prête(s)
              </p>
              <Button type="button" onClick={onImport} disabled={pending}>
                {pending ? <Spinner /> : null}
                Importer {mappedRows.length} transaction(s)
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
