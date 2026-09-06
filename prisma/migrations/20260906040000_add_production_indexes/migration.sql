-- CreateIndex
CREATE INDEX IF NOT EXISTS "ledger_entries_walletId_idx" ON "ledger_entries"("walletId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ledger_entries_createdAt_idx" ON "ledger_entries"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "withdrawals_memberId_idx" ON "withdrawals"("memberId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "withdrawals_status_idx" ON "withdrawals"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "vendor_sales_vendorId_idx" ON "vendor_sales"("vendorId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "vendor_sales_createdAt_idx" ON "vendor_sales"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "vendor_settlements_vendorId_idx" ON "vendor_settlements"("vendorId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "vendor_settlements_status_idx" ON "vendor_settlements"("status");
