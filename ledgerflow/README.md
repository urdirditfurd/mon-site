# LedgerFlow

Application comptable modulaire inspirée de Pennylane / QuickBooks / Xero, adaptée à la comptabilité française.

## Les 6 piliers

1. **Facturation intelligente** — Devis → Facture → Relance auto ✅
2. **Notes de frais** — Photo → OCR → Validation
3. **Trésorerie & Banque** — Import CSV + lettrage heuristique ✅
4. **Journal comptable** — PCG, règles, export FEC ✅ (cerveau catégorisation)
5. **Tableau de bord** — KPIs temps réel + TVA ✅
6. **Collaboration** — Espace expert-comptable (phase 2)

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind
- Prisma 5 + PostgreSQL
- `@react-pdf/renderer` (PDF factures)
- Zod + React Hook Form
- Recharts (dashboard)

## Démarrage

```bash
cd ledgerflow
cp .env.example .env
# Exemple local :
# DATABASE_URL="postgresql://ledgerflow:ledgerflow@localhost:5432/ledgerflow?schema=public"
npm install
npx prisma migrate dev
npm run db:seed
npm run dev
```

Ouvre [http://localhost:3000/facturation](http://localhost:3000/facturation).

## Pilier 5 — Tableau de bord & TVA

- Moteur `src/lib/financial-engine.ts` : trésorerie, TVA (encaissements/débits), créances, résultat estimé
- KPIs + sparkline + courbe 6 mois + récap TVA 3 mois
- TVA déductible estimée marquée `*` (transparence fiscale)
- Sélecteur période : mois / trimestre / année (`/?period=`)

```bash
npm run db:seed
npm run test:financial
```

## Pilier 4 — Cerveau PCG (catégorisation)

- Moteur hybride `src/lib/categorization-engine.ts`
  1. Règles mémorisées (`CategorizationRule`) → confiance 100 %
  2. Heuristiques métier (Spotify, URSSAF, AWS, SNCF…)
  3. LLM optionnel si `OPENAI_API_KEY`
  4. Fallback prudent `671000` (30 %)
- UI : colonne « Suggestion comptable », Valider / Modifier + checkbox « Mémoriser »
- Actions : `suggestCategory`, `confirmCategory`

```bash
npm run db:seed
npm run test:categorization
```

## Pilier 3 — Trésorerie & Lettrage

- Page `/tresorerie` : import CSV (drag & drop) + tableau de rapprochement
- Moteur heuristique `src/lib/reconciliation-engine.ts`
  - Montant exact (tolérance 1 €)
  - Date ± 5 jours
  - Libellé contient le nom client / n° facture
- Validation 1 clic (≥ 80 %) ou lettrage manuel (dialog)
- Soft actions : ignorer, annuler un lettrage
- Fixture : `fixtures/sample-qonto.csv`

```bash
npm run db:seed
npx tsx scripts/test-reconciliation.ts
npm run dev
# ouvrir http://localhost:3000/tresorerie
```

## Pilier 1 — Facturation

- Créer / éditer : `/facturation/nouvelle`, `/facturation/[id]/modifier`
- Liste + actions : voir PDF, modifier, soft-delete (annulation), marquer payée
- PDF conforme : `/api/invoices/[id]/pdf`
  - SIRET émetteur & client
  - Numérotation séquentielle `F-YYYY-####`
  - Pénalités de retard (3× taux légal + 40 €)
  - Mention art. 293 B CGI si `Company.vatExempt` + TVA 0 %
- Soft delete : document émis → statut `CANCELLED` (le numéro est conservé)

## Structure

```
src/
  app/actions/invoice.ts
  app/api/invoices/[id]/pdf/
  modules/invoicing/   # InvoiceForm, InvoiceList, InvoicePDF
  lib/invoices/        # schema Zod, totaux, numérotation
prisma/                # schema + seed
```

## Roadmap

| Sprint | Focus |
|--------|--------|
| Fondation | UI + schéma |
| **Facturation** | CRUD + PDF (cette PR) |
| Trésorerie | Import CSV + lettrage |
| Cerveau IA | Classification |
| Automatisation | OCR, relances, FEC |
