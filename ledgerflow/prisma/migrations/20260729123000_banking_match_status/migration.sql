-- CreateEnum
CREATE TYPE "BankMatchStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'IGNORED');

-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN IF NOT EXISTS "status" "BankMatchStatus" NOT NULL DEFAULT 'UNMATCHED';
ALTER TABLE "BankTransaction" ADD COLUMN IF NOT EXISTS "matchedExpenseId" TEXT;

-- Backfill
UPDATE "BankTransaction" SET "status" = 'MATCHED' WHERE "isMatched" = true;
UPDATE "BankTransaction" SET "status" = 'UNMATCHED' WHERE "isMatched" = false AND ("status" IS NULL OR "status" = 'UNMATCHED');

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BankTransaction_bankAccountId_status_idx" ON "BankTransaction"("bankAccountId", "status");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_matchedExpenseId_fkey" FOREIGN KEY ("matchedExpenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
