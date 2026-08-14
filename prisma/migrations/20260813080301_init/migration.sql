-- CreateTable
CREATE TABLE "members" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "pinCode" TEXT,
    "gender" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "panNumber" TEXT,
    "panVerified" BOOLEAN NOT NULL DEFAULT false,
    "kycTier" INTEGER NOT NULL DEFAULT 1,
    "kycStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_id_cards" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "cardNumber" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "acbStatus" BOOLEAN NOT NULL DEFAULT false,
    "acbUnlockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_id_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autopool_nodes" (
    "id" TEXT NOT NULL,
    "idCardId" TEXT NOT NULL,
    "parentNodeId" TEXT,
    "side" TEXT,
    "globalPosition" INTEGER NOT NULL,
    "depthLevel" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autopool_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mysystem_nodes" (
    "id" TEXT NOT NULL,
    "idCardId" TEXT NOT NULL,
    "parentNodeId" TEXT,
    "side" TEXT,
    "placementType" TEXT NOT NULL DEFAULT 'AUTO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mysystem_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "setukosh_nodes" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "parentNodeId" TEXT,
    "side" TEXT,
    "globalPosition" INTEGER NOT NULL,
    "depthLevel" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "setukosh_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "setukosh_counters" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "counterPaise" INTEGER NOT NULL DEFAULT 0,
    "idsCreated" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "setukosh_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "balancePaise" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "referenceId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_entries" (
    "id" TEXT NOT NULL,
    "idCardId" TEXT NOT NULL,
    "stream" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "sourceIdCardId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payonce_ledger" (
    "id" TEXT NOT NULL,
    "idCardId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "paidVia" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payonce_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vouchers" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "idCardId" TEXT,
    "sourceType" TEXT NOT NULL,
    "faceValuePaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "idCardId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "grossPaise" INTEGER NOT NULL,
    "tdsPaise" INTEGER NOT NULL,
    "adminChargePaise" INTEGER NOT NULL,
    "netPaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tds_ledger" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tds_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "gstin" TEXT,
    "address" TEXT,
    "pinCode" TEXT,
    "marginRatePct" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROVISIONAL',
    "securityDepositPaise" INTEGER NOT NULL DEFAULT 500000,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_sales" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "idCardId" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_settlements" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "grossSalesPaise" INTEGER NOT NULL,
    "marginPaise" INTEGER NOT NULL,
    "postMarginPaise" INTEGER NOT NULL,
    "adminChargePaise" INTEGER NOT NULL,
    "tdsPaise" INTEGER NOT NULL,
    "netPayablePaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "vendor_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_referral_bonus" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "referredVendorId" TEXT NOT NULL,
    "bonusPaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_referral_bonus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "performedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "members_mobile_key" ON "members"("mobile");

-- CreateIndex
CREATE UNIQUE INDEX "member_id_cards_cardNumber_key" ON "member_id_cards"("cardNumber");

-- CreateIndex
CREATE UNIQUE INDEX "autopool_nodes_idCardId_key" ON "autopool_nodes"("idCardId");

-- CreateIndex
CREATE UNIQUE INDEX "autopool_nodes_globalPosition_key" ON "autopool_nodes"("globalPosition");

-- CreateIndex
CREATE UNIQUE INDEX "mysystem_nodes_idCardId_key" ON "mysystem_nodes"("idCardId");

-- CreateIndex
CREATE UNIQUE INDEX "setukosh_nodes_globalPosition_key" ON "setukosh_nodes"("globalPosition");

-- CreateIndex
CREATE UNIQUE INDEX "setukosh_counters_memberId_key" ON "setukosh_counters"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_memberId_key" ON "wallets"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "payonce_ledger_idCardId_level_key" ON "payonce_ledger"("idCardId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_memberId_key" ON "vendors"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_settings_key_key" ON "platform_settings"("key");

-- AddForeignKey
ALTER TABLE "member_id_cards" ADD CONSTRAINT "member_id_cards_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autopool_nodes" ADD CONSTRAINT "autopool_nodes_idCardId_fkey" FOREIGN KEY ("idCardId") REFERENCES "member_id_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mysystem_nodes" ADD CONSTRAINT "mysystem_nodes_idCardId_fkey" FOREIGN KEY ("idCardId") REFERENCES "member_id_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setukosh_nodes" ADD CONSTRAINT "setukosh_nodes_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setukosh_counters" ADD CONSTRAINT "setukosh_counters_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_idCardId_fkey" FOREIGN KEY ("idCardId") REFERENCES "member_id_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payonce_ledger" ADD CONSTRAINT "payonce_ledger_idCardId_fkey" FOREIGN KEY ("idCardId") REFERENCES "member_id_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tds_ledger" ADD CONSTRAINT "tds_ledger_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_sales" ADD CONSTRAINT "vendor_sales_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_settlements" ADD CONSTRAINT "vendor_settlements_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_referral_bonus" ADD CONSTRAINT "vendor_referral_bonus_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
