const prisma = require("../lib/prisma");
const walletService = require("./walletService");

async function requestWithdrawal(memberId, idCardId, method, amountPaise) {
  // Typical admin fee is 10% and TDS is 5%.
  // For this mock implementation, we just use arbitrary percentages,
  // but let's implement the standard 5% TDS and 5% Admin Charge as placeholders.
  const tdsPaise = Math.floor(amountPaise * 0.05);
  const adminChargePaise = Math.floor(amountPaise * 0.05);
  const netPaise = amountPaise - tdsPaise - adminChargePaise;

  return await prisma.withdrawal.create({
    data: {
      memberId,
      idCardId,
      method,
      grossPaise: amountPaise,
      tdsPaise,
      adminChargePaise,
      netPaise,
      status: "REQUESTED"
    }
  });
}

async function processWithdrawal(withdrawalId, action) {
  return await prisma.$transaction(async (tx) => {
    const withdrawal = await tx.withdrawal.findUnique({
      where: { id: withdrawalId }
    });

    if (!withdrawal) {
      throw new Error("Withdrawal not found");
    }

    if (withdrawal.status !== "REQUESTED") {
      throw new Error(`Withdrawal already processed (Status: ${withdrawal.status})`);
    }

    if (action === "REJECT") {
      return await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: "REJECTED",
          completedAt: new Date()
        }
      });
    }

    if (action === "APPROVE") {
      // 1. Debit wallet for the GROSS amount requested
      await walletService.debit(tx, withdrawal.memberId, withdrawal.grossPaise, "WITHDRAWAL", withdrawal.id, "Member cashout request");

      // 2. Mark withdrawal as COMPLETED
      return await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: "COMPLETED",
          completedAt: new Date()
        }
      });
    }

    throw new Error("Invalid action. Must be APPROVE or REJECT.");
  });
}

module.exports = {
  requestWithdrawal,
  processWithdrawal
};
