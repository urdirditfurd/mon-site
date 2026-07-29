"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Resolver } from "react-hook-form";
import { toast } from "sonner";
import { Camera, Loader2, Sparkles } from "lucide-react";
import {
  expenseReviewSchema,
  type ExpenseReviewData,
} from "@/lib/expenses/schema";
import { processExpenseUpload, saveExpense } from "@/app/actions/expenses";
import { formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface PcgOption {
  id: string;
  number: string;
  label: string;
}

type ReviewForm = ExpenseReviewData;

function confidenceVariant(
  confidence: number,
): "success" | "warning" | "danger" {
  if (confidence > 80) return "success";
  if (confidence >= 50) return "warning";
  return "danger";
}

export function ExpenseCaptureForm({
  pcgAccounts,
}: {
  pcgAccounts: PcgOption[];
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"upload" | "ocr" | "review">("upload");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [suggestionMeta, setSuggestionMeta] = useState<{
    reason: string;
    source: string;
    confidence: number;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  const defaultAccount =
    pcgAccounts.find((a) => a.number === "625000")?.id ||
    pcgAccounts[0]?.id ||
    "";

  const form = useForm<ReviewForm>({
    resolver: zodResolver(expenseReviewSchema) as Resolver<ReviewForm>,
    defaultValues: {
      merchantName: "",
      expenseDate: new Date().toISOString().slice(0, 10),
      amountTtc: 0,
      vatAmount: null,
      vatEstimated: true,
      accountId: defaultAccount,
      category: "OTHER",
      note: "",
      description: "",
      photoUrl: "",
      status: "PENDING",
    },
  });

  const watched = form.watch();
  const totalsHint = useMemo(() => {
    const ttc = Number(watched.amountTtc || 0);
    const vat = Number(watched.vatAmount || 0);
    return { ttc, ht: Math.max(0, ttc - vat) };
  }, [watched.amountTtc, watched.vatAmount]);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const localPreview = URL.createObjectURL(file);
    setPreviewUrl(localPreview);
    setPhase("ocr");

    const fd = new FormData();
    fd.set("file", file);

    startTransition(async () => {
      const result = await processExpenseUpload(fd);
      if (!result.ok) {
        toast.error(result.error || "OCR échoué");
        setPhase("upload");
        return;
      }
      if (!result.data) {
        toast.error("OCR échoué");
        setPhase("upload");
        return;
      }

      const { photoUrl, ocr, suggestion } = result.data;
      form.reset({
        merchantName: ocr.vendor,
        expenseDate: ocr.date,
        amountTtc: ocr.total,
        vatAmount: ocr.vat,
        vatEstimated: ocr.vatEstimated,
        accountId: suggestion?.accountId || defaultAccount,
        category: (ocr.categoryHint as ReviewForm["category"]) || "OTHER",
        note: "",
        description: "",
        photoUrl,
        ocrData: ocr,
        ocrConfidence: ocr.confidence,
        status: "PENDING",
      });
      setSuggestionMeta(
        suggestion
          ? {
              reason: suggestion.reason,
              source: suggestion.source,
              confidence: suggestion.confidence,
            }
          : null,
      );
      setPreviewUrl(photoUrl);
      setPhase("review");
      toast.success("Reçu analysé — vérifiez les champs avant d'enregistrer");
    });
  };

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await saveExpense(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Note de frais enregistrée");
      router.push("/notes-de-frais");
      router.refresh();
    });
  });

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {phase === "upload" || phase === "ocr" ? (
        <Card>
          <CardHeader>
            <CardTitle>Capturer un reçu</CardTitle>
            <CardDescription>
              Photo ou fichier · OCR mock (~1,5 s) · suggestion PCG automatique
            </CardDescription>
          </CardHeader>
          <CardContent>
            {phase === "ocr" ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-6 py-16">
                <Loader2 className="h-8 w-8 animate-spin text-[#0B1F33]" />
                <p className="text-sm font-medium text-slate-800">
                  Analyse du reçu en cours…
                </p>
                <p className="text-xs text-slate-500">
                  Extraction date, fournisseur, montant, TVA
                </p>
                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt="Aperçu"
                    className="mt-2 h-32 w-auto rounded-lg object-cover opacity-60"
                  />
                ) : null}
              </div>
            ) : (
              <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 px-6 py-16 transition hover:border-[#0B1F33]/40 hover:bg-[#0B1F33]/[0.02]">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => onFile(e.target.files?.[0])}
                />
                <div className="rounded-full bg-white p-4 shadow-sm ring-1 ring-slate-200">
                  <Camera className="h-7 w-7 text-[#0B1F33]" strokeWidth={1.75} />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-slate-900">
                    Prendre une photo ou uploader
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    JPEG / PNG / WebP · max 8 Mo · nommez le fichier (ex.
                    sncf.jpg) pour un mock OCR pertinent
                  </p>
                </div>
              </label>
            )}
          </CardContent>
        </Card>
      ) : null}

      {phase === "review" ? (
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
            <Card className="overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Reçu</CardTitle>
              </CardHeader>
              <CardContent>
                {previewUrl ? (
                  <div className="relative mx-auto aspect-[3/4] w-full max-w-[200px] overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200">
                    {/* next/image requires remote config for local uploads; use img */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewUrl}
                      alt="Reçu"
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">Pas d&apos;image</p>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => {
                    setPhase("upload");
                    setPreviewUrl(null);
                  }}
                >
                  Reprendre une photo
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Vérifier & corriger</CardTitle>
                <CardDescription>
                  L&apos;OCR se trompe parfois — corrigez avant d&apos;enregistrer
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {suggestionMeta ? (
                  <Tooltip content={suggestionMeta.reason}>
                    <div className="inline-flex items-center gap-2">
                      <Sparkles className="h-3.5 w-3.5 text-[#C8A45A]" />
                      <Badge variant={confidenceVariant(suggestionMeta.confidence)}>
                        Suggestion PCG {suggestionMeta.confidence}% ·{" "}
                        {suggestionMeta.source}
                      </Badge>
                    </div>
                  </Tooltip>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="merchantName">Fournisseur *</Label>
                    <Input id="merchantName" {...form.register("merchantName")} />
                    {form.formState.errors.merchantName ? (
                      <p className="text-xs text-rose-600">
                        {form.formState.errors.merchantName.message}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="expenseDate">Date *</Label>
                    <Input
                      id="expenseDate"
                      type="date"
                      {...form.register("expenseDate")}
                    />
                    {form.formState.errors.expenseDate ? (
                      <p className="text-xs text-rose-600">
                        {form.formState.errors.expenseDate.message}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="category">Catégorie</Label>
                    <Select id="category" {...form.register("category")}>
                      <option value="RESTAURANT">Restaurant</option>
                      <option value="TRANSPORT">Transport</option>
                      <option value="HOTEL">Hôtel</option>
                      <option value="SUPPLIES">Fournitures</option>
                      <option value="SOFTWARE">Logiciel</option>
                      <option value="TRAINING">Formation</option>
                      <option value="OTHER">Autre</option>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="amountTtc">Montant TTC *</Label>
                    <Input
                      id="amountTtc"
                      type="number"
                      step="0.01"
                      min="0"
                      {...form.register("amountTtc")}
                    />
                    {form.formState.errors.amountTtc ? (
                      <p className="text-xs text-rose-600">
                        {form.formState.errors.amountTtc.message}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="vatAmount">
                      TVA{" "}
                      {watched.vatEstimated ? (
                        <Tooltip content="TVA estimée — ajustez si le ticket précise le montant exact.">
                          <span className="text-amber-600">*</span>
                        </Tooltip>
                      ) : null}
                    </Label>
                    <Input
                      id="vatAmount"
                      type="number"
                      step="0.01"
                      min="0"
                      {...form.register("vatAmount")}
                    />
                    <p className="text-[11px] text-slate-500">
                      HT estimé {formatCurrency(totalsHint.ht)}
                    </p>
                  </div>

                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="accountId">Compte PCG *</Label>
                    <Select id="accountId" {...form.register("accountId")}>
                      {pcgAccounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.number} — {account.label}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="note">Note (optionnel)</Label>
                    <Textarea id="note" rows={2} {...form.register("note")} />
                  </div>
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => {
                      startTransition(async () => {
                        const values = form.getValues();
                        const result = await saveExpense({
                          ...values,
                          status: "DRAFT",
                        });
                        if (!result.ok) {
                          toast.error(result.error);
                          return;
                        }
                        toast.success("Brouillon enregistré");
                        router.push("/notes-de-frais");
                        router.refresh();
                      });
                    }}
                  >
                    Enregistrer brouillon
                  </Button>
                  <Button type="submit" disabled={pending}>
                    {pending ? <Spinner /> : null}
                    Enregistrer la note de frais
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </form>
      ) : null}
    </div>
  );
}
