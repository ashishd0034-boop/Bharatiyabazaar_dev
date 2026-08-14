const prisma = require("../lib/prisma");
const walletService = require("./walletService");
const tdsService = require("./tdsService");

const ADMIN_CHARGE_PERCENT = {
  BANK: 0.10,
  MEMBER_WALLET: 0.05,
  VOUCHER_CONVERSION: 0.05
};

async function requestWithdrawal(memberId, idCardId, method, amountPaise, paymentDetails = null) {
  if (amountPaise < 50000) {
    throw new Error("Minimum withdrawal amount is Rs. 500");
  }
  
  if (!ADMIN_CHARGE_PERCENT[method]) {
    throw new Error("Invalid withdrawal method");
  }

  return await prisma.$transaction(async (tx) => {
    // 1. Debit the wallet immediately (Escrow)
    // The walletService will throw an error if balance goes below 0.
    await walletService.debit(tx, memberId, amountPaise, "WITHDRAWAL_ESCROW", null, "Withdrawal Request Escrow");

    // 2. Create the withdrawal record
    return await tx.withdrawal.create({
      data: {
        memberId,
        idCardId,
        method,
        grossPaise: amountPaise,
        tdsPaise: 0,
        adminChargePaise: 0,
        netPaise: 0,
        status: "REQUESTED",
        paymentDetails
      }
    });
  });
}

async function processWithdrawal(withdrawalId, action, rejectionReason = null) {
  return await prisma.$transaction(async (tx) => {
    const withdrawal = await tx.withdrawal.findUnique({
      where: { id: withdrawalId }
    });

    if (!withdrawal) throw new Error("Withdrawal not found");
    if (withdrawal.status !== "REQUESTED") throw new Error(`Withdrawal already processed (Status: ${withdrawal.status})`);

    if (action === "REJECT") {
      // Refund the wallet (release escrow)
      await walletService.credit(tx, withdrawal.memberId, withdrawal.grossPaise, "WITHDRAWAL_REFUND", withdrawal.id, `Withdrawal Rejected: ${rejectionReason}`);
      
      return await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: "REJECTED",
          completedAt: new Date(),
          rejectionReason
        }
      });
    }

    if (action === "APPROVE") {
      // 1. Calculate TDS
      const { tdsPaise, taxablePaise } = await tdsService.calculate194HTds(tx, withdrawal.memberId, withdrawal.grossPaise);
      
      // 2. Calculate Admin Fee and Net Payable
      const postTdsPaise = withdrawal.grossPaise - tdsPaise;
      const adminPercent = ADMIN_CHARGE_PERCENT[withdrawal.method];
      
      // Strict Integer Math
      const adminChargePaise = Math.floor((postTdsPaise * (adminPercent * 100)) / 100);
      const netPaise = postTdsPaise - adminChargePaise;
      
      // Math Assertion
      if (withdrawal.grossPaise !== (netPaise + tdsPaise + adminChargePaise)) {
        throw new Error("Ledger Math Assertion Failed: Gross does not equal Net + TDS + Admin.");
      }

      // 3. Reverse Escrow (Wallet Balance temporarily restored)
      await walletService.credit(tx, withdrawal.memberId, withdrawal.grossPaise, "ESCROW_RELEASED", withdrawal.id, "Reversing escrow for final payout splits");
      
      // 4. Debit the specific splits
      await walletService.debit(tx, withdrawal.memberId, netPaise, "WITHDRAWAL_PAYOUT", withdrawal.id, `Net Payout via ${withdrawal.method}`);
      if (tdsPaise > 0) {
        await walletService.debit(tx, withdrawal.memberId, tdsPaise, "TDS_DEDUCTED", withdrawal.id, "TDS Section 194H");
        
        // Track in TdsLedger
        await tx.tdsLedger.create({
          data: {
            memberId: withdrawal.memberId,
            section: "SECTION_194H",
            amountPaise: tdsPaise,
            status: "HELD",
            referenceId: withdrawal.id
          }
        });
      }
      if (adminChargePaise > 0) {
        await walletService.debit(tx, withdrawal.memberId, adminChargePaise, "ADMIN_FEE", withdrawal.id, "Admin Charge");
      }
      
      // 5. Mark as Completed
      return await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          tdsPaise,
          adminChargePaise,
          netPaise
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
