"use client";

import { useState, useTransition } from "react";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

type FiscalPeriod = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
};

const PERIODS: FiscalPeriod[] = [
  {
    id: "2026",
    label: "Exercice 2026 (01/01 → 31/12)",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
  },
  {
    id: "2026-s1",
    label: "1er semestre 2026",
    startDate: "2026-01-01",
    endDate: "2026-06-30",
  },
  {
    id: "2026-s2",
    label: "2e semestre 2026",
    startDate: "2026-07-01",
    endDate: "2026-12-31",
  },
  {
    id: "2025",
    label: "Exercice 2025",
    startDate: "2025-01-01",
    endDate: "2025-12-31",
  },
];

export function FecExport() {
  const [periodId, setPeriodId] = useState("2026");
  const [pending, startTransition] = useTransition();
  const period = PERIODS.find((p) => p.id === periodId) ?? PERIODS[0];

  function handleDownload() {
    startTransition(async () => {
      try {
        const res = await fetch("/api/fec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startDate: period.startDate,
            endDate: period.endDate,
          }),
        });

        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(payload?.error ?? `Erreur HTTP ${res.status}`);
        }

        const blob = await res.blob();
        const disposition = res.headers.get("Content-Disposition") ?? "";
        const match = /filename="([^"]+)"/.exec(disposition);
        const filename = match?.[1] ?? "FEC_export.txt";

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        const rows = res.headers.get("X-FEC-Rows");
        toast.success(
          rows
            ? `FEC téléchargé (${rows} ligne(s)) — ${filename}`
            : `FEC téléchargé — ${filename}`,
        );
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Impossible de générer le FEC",
        );
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-slate-100 p-2 text-[#0B1F33]">
            <FileSpreadsheet className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <div>
            <CardTitle>Export comptable</CardTitle>
            <CardDescription>
              Fichier des Écritures Comptables (FEC) pour votre expert-comptable
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="fec-period">Période d&apos;export</Label>
          <Select
            id="fec-period"
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)}
            disabled={pending}
          >
            {PERIODS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>

        <Button
          type="button"
          onClick={handleDownload}
          disabled={pending}
          className="w-full sm:w-auto"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {pending ? "Génération…" : "Télécharger le FEC"}
        </Button>

        <p className="text-[11px] leading-relaxed text-slate-500">
          Ce fichier est conforme à l&apos;article A47 A-1 du LPF et peut être
          transmis directement à votre expert-comptable. Format CSV
          point-virgule, dates AAAAMMJJ, encodage UTF-8 — nommage{" "}
          <span className="font-mono text-slate-600">
            FEC_[SIRET]_[AAAAMMJJ].txt
          </span>
          .
        </p>
      </CardContent>
    </Card>
  );
}
