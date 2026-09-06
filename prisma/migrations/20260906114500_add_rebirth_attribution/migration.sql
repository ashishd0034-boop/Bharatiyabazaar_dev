-- AlterTable
ALTER TABLE "MemberIdCard" ADD COLUMN IF NOT EXISTS "earnedByIdCardId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MemberIdCard_earnedByIdCardId_idx" ON "MemberIdCard"("earnedByIdCardId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "vouchers_idCardId_idx" ON "vouchers"("idCardId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MemberIdCard_earnedByIdCardId_fkey'
  ) THEN
    ALTER TABLE "MemberIdCard" ADD CONSTRAINT "MemberIdCard_earnedByIdCardId_fkey" FOREIGN KEY ("earnedByIdCardId") REFERENCES "MemberIdCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vouchers_idCardId_fkey'
  ) THEN
    ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_idCardId_fkey" FOREIGN KEY ("idCardId") REFERENCES "MemberIdCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
