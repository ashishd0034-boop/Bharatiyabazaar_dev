/*
  Warnings:

  - You are about to drop the `member_id_cards` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `mysystem_nodes` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "autopool_nodes" DROP CONSTRAINT "autopool_nodes_idCardId_fkey";

-- DropForeignKey
ALTER TABLE "commission_entries" DROP CONSTRAINT "commission_entries_idCardId_fkey";

-- DropForeignKey
ALTER TABLE "member_id_cards" DROP CONSTRAINT "member_id_cards_memberId_fkey";

-- DropForeignKey
ALTER TABLE "mysystem_nodes" DROP CONSTRAINT "mysystem_nodes_idCardId_fkey";

-- DropForeignKey
ALTER TABLE "payonce_ledger" DROP CONSTRAINT "payonce_ledger_idCardId_fkey";

-- DropTable
DROP TABLE "member_id_cards";

-- DropTable
DROP TABLE "mysystem_nodes";

-- CreateTable
CREATE TABLE "MemberIdCard" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "cardNumber" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "acbStatus" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberIdCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MySystemNode" (
    "id" TEXT NOT NULL,
    "idCardId" TEXT NOT NULL,
    "parentNodeId" TEXT,
    "side" TEXT,
    "placementType" TEXT NOT NULL,
    "sponsorIdCardId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MySystemNode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberIdCard_cardNumber_key" ON "MemberIdCard"("cardNumber");

-- CreateIndex
CREATE INDEX "MemberIdCard_memberId_idx" ON "MemberIdCard"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "MySystemNode_idCardId_key" ON "MySystemNode"("idCardId");

-- CreateIndex
CREATE INDEX "MySystemNode_parentNodeId_idx" ON "MySystemNode"("parentNodeId");

-- CreateIndex
CREATE INDEX "MySystemNode_sponsorIdCardId_idx" ON "MySystemNode"("sponsorIdCardId");

-- CreateIndex
CREATE INDEX "withdrawals_idCardId_idx" ON "withdrawals"("idCardId");

-- AddForeignKey
ALTER TABLE "MemberIdCard" ADD CONSTRAINT "MemberIdCard_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autopool_nodes" ADD CONSTRAINT "autopool_nodes_idCardId_fkey" FOREIGN KEY ("idCardId") REFERENCES "MemberIdCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MySystemNode" ADD CONSTRAINT "MySystemNode_idCardId_fkey" FOREIGN KEY ("idCardId") REFERENCES "MemberIdCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MySystemNode" ADD CONSTRAINT "MySystemNode_parentNodeId_fkey" FOREIGN KEY ("parentNodeId") REFERENCES "MySystemNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MySystemNode" ADD CONSTRAINT "MySystemNode_sponsorIdCardId_fkey" FOREIGN KEY ("sponsorIdCardId") REFERENCES "MemberIdCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_idCardId_fkey" FOREIGN KEY ("idCardId") REFERENCES "MemberIdCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payonce_ledger" ADD CONSTRAINT "payonce_ledger_idCardId_fkey" FOREIGN KEY ("idCardId") REFERENCES "MemberIdCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_idCardId_fkey" FOREIGN KEY ("idCardId") REFERENCES "MemberIdCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
