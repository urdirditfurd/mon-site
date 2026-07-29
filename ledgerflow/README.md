# LedgerFlow

Application comptable modulaire inspirée de Pennylane / QuickBooks / Xero, adaptée à la comptabilité française.

## Les 6 piliers

1. **Facturation intelligente** — Devis → Facture → Relance auto
2. **Notes de frais** — Photo → OCR → Validation
3. **Trésorerie & Banque** — Import / agrégateur + lettrage
4. **Journal comptable** — PCG, règles, export FEC
5. **Tableau de bord** — KPIs temps réel
6. **Collaboration** — Espace expert-comptable (phase 2)

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind
- Prisma + PostgreSQL
- Recharts (dashboard)
- Microservice Python OCR/IA prévu (`src/lib/ai`, `src/lib/ocr`)

## Démarrage

```bash
cd ledgerflow
cp .env.example .env
npm install
npm run dev
```

Ouvre [http://localhost:3000](http://localhost:3000).

Les écrans utilisent des **données mock** (`src/lib/mock-data.ts`) tant que PostgreSQL n’est pas branché.

## Base de données

```bash
# Configure DATABASE_URL dans .env
npx prisma validate
npx prisma migrate dev --name init
```

## Structure

```
src/
  modules/     # invoicing, expenses, banking, accounting, dashboard
  lib/         # ai, ocr, pdf, utils, mock-data
  services/    # banking, email
  components/  # layout + UI
prisma/        # schema.prisma complet
```

## Roadmap sprints

| Sprint | Focus |
|--------|--------|
| Fondation | UI + schéma + facturation mock (cette PR) |
| Trésorerie | Import CSV + lettrage manuel |
| Cerveau IA | Classification + corrections |
| Automatisation | OCR, relances, export FEC |
