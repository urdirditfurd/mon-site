-- CreateEnum
CREATE TYPE "CategorizationSource" AS ENUM ('RULE', 'HEURISTIC', 'LLM', 'FALLBACK', 'MANUAL');

-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN IF NOT EXISTS "suggestionConfidence" DOUBLE PRECISION;
ALTER TABLE "BankTransaction" ADD COLUMN IF NOT EXISTS "suggestionReason" TEXT;
ALTER TABLE "BankTransaction" ADD COLUMN IF NOT EXISTS "suggestionSource" "CategorizationSource";
ALTER TABLE "BankTransaction" ADD COLUMN IF NOT EXISTS "categorizedAccountId" TEXT;
ALTER TABLE "BankTransaction" ADD COLUMN IF NOT EXISTS "categorizedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CategorizationRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategorizationRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CategorizationRule_companyId_keyword_key" ON "CategorizationRule"("companyId", "keyword");
CREATE INDEX IF NOT EXISTS "CategorizationRule_companyId_isActive_priority_idx" ON "CategorizationRule"("companyId", "isActive", "priority");

DO $$ BEGIN
 ALTER TABLE "CategorizationRule" ADD CONSTRAINT "CategorizationRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
 ALTER TABLE "CategorizationRule" ADD CONSTRAINT "CategorizationRule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
 ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_categorizedAccountId_fkey" FOREIGN KEY ("categorizedAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
