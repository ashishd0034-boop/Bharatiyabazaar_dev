/*
  Warnings:

  - Added the required column `balanceAfterPaise` to the `ledger_entries` table without a default value. This is not possible if the table is not empty.
  - Added the required column `balanceBeforePaise` to the `ledger_entries` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ledger_entries" ADD COLUMN     "balanceAfterPaise" INTEGER NOT NULL,
ADD COLUMN     "balanceBeforePaise" INTEGER NOT NULL;
