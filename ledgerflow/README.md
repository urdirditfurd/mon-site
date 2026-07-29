# LedgerFlow

Application comptable modulaire inspirée de Pennylane / QuickBooks / Xero, adaptée à la comptabilité française.

## Les 6 piliers

1. **Facturation intelligente** — Devis → Facture → Relance auto ✅ (CRUD + PDF)
2. **Notes de frais** — Photo → OCR → Validation
3. **Trésorerie & Banque** — Import / agrégateur + lettrage
4. **Journal comptable** — PCG, règles, export FEC
5. **Tableau de bord** — KPIs temps réel
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
