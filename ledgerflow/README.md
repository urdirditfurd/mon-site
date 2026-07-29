# LedgerFlow

Application comptable modulaire inspirée de Pennylane / QuickBooks / Xero, adaptée à la comptabilité française.

## Les 6 piliers

1. **Facturation intelligente** — Devis → Facture → Relance auto ✅
2. **Notes de frais** — Photo → OCR → Validation ✅
3. **Trésorerie & Banque** — Import CSV + lettrage heuristique ✅
4. **Journal comptable** — PCG, règles, export FEC ✅
5. **Tableau de bord** — KPIs temps réel + TVA ✅
6. **Collaboration** — Espace expert-comptable (phase 2)

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind
- Prisma 5 + PostgreSQL
- `@react-pdf/renderer` (PDF factures)
- Zod + React Hook Form
- Recharts (dashboard)

## Démarrage

### Prérequis
- Node.js **20 LTS** (64-bit) — [nodejs.org](https://nodejs.org)
- **Docker Desktop** (recommandé pour PostgreSQL) — [docker.com](https://www.docker.com/products/docker-desktop/)
  - *ou* PostgreSQL 16 installé localement

### Windows (PowerShell) — important

**Ne clone pas dans `C:\Windows\System32`.** Ouvre PowerShell *normal* (pas admin) et place le projet dans ton dossier utilisateur :

```powershell
cd $HOME\Documents
git clone https://github.com/urdirditfurd/mon-site.git
cd mon-site
git checkout cursor/ledgerflow-fec-export-ce56
cd ledgerflow

# 1) Base de données
docker compose up -d

# 2) Config
Copy-Item .env.example .env

# 3) Dépendances + moteur Prisma Windows (propre)
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run db:seed
npm run dev
```

Ouvre [http://localhost:3000](http://localhost:3000).

#### PC Windows ARM64 (`node -p "process.arch"` → `arm64`)

Prisma **n’a pas** de moteur natif Windows ARM. Deux solutions :

**Option A (recommandée)** — installer **Node.js Windows x64** (pas ARM64) depuis [nodejs.org](https://nodejs.org) → « Windows Installer (.msi) » **x64**. Puis :

```powershell
node -p "process.arch"   # doit afficher x64
cd $HOME\Documents\mon-site\ledgerflow
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
npm install
npx prisma generate
```

**Option B** — garder Node ARM64, forcer le moteur binaire (process séparé) :

```powershell
cd $HOME\Documents\mon-site\ledgerflow
Add-Content .env "`nPRISMA_CLIENT_ENGINE_TYPE=binary"
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
npm install
$env:PRISMA_CLIENT_ENGINE_TYPE="binary"
npx prisma generate
npx prisma migrate dev
npm run db:seed
npm run dev
```

#### Si tu vois `query_engine-windows.dll.node is not a valid Win32 application`
Sur **x64** : réinstalle `node_modules` + `npx prisma generate`.  
Sur **arm64** : applique l’Option A ou B ci-dessus.

#### Si tu vois `P1001: Can't reach database server`
PostgreSQL n’écoute pas sur `localhost:5432`. Lance Docker Desktop, puis :

```powershell
docker compose up -d
docker compose ps
```

### Linux / Mac

```bash
cd ledgerflow
cp .env.example .env
docker compose up -d
npm install
npx prisma migrate dev
npm run db:seed
npm run dev
```

Ouvre [http://localhost:3000/facturation](http://localhost:3000/facturation).

## Export FEC (Final)

Fichier des Écritures Comptables conforme art. A47 A-1 du LPF :

- Moteur `src/lib/fec-generator.ts` (journaux VT / AC / BQ, partie double)
- API `POST /api/fec` → téléchargement `FEC_[SIRET]_[AAAAMMJJ].txt`
- UI « Export comptable » sur le dashboard

```bash
npm run test:fec
```

## Pilier 2 — Notes de frais & OCR

- Capture `/notes-de-frais/nouvelle` (photo / upload)
- OCR mock `src/lib/ocr-engine.ts` (~1,5 s) + suggestion PCG (Pilier 4)
- Review éditable (react-hook-form + zod)
- Liste + approbation / refus
- Notes `APPROVED` → TVA déductible du dashboard

```bash
# Astuce mock : nommez le fichier sncf.jpg / uber.png / bistro.jpg
```

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
