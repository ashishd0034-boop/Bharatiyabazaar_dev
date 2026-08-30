const prisma = require("../../core/database/prisma");
const walletService = require("../../core/services/wallet.service");
const tdsService = require("../../core/services/tds.service");

const ADMIN_CHARGE_PERCENT = {
  BANK: 0.10,
  MEMBER_WALLET: 0.05,
  VOUCHER_CONVERSION: 0.05,
  UPI: 0.10,
  WALLET: 0.05
};

const MIN_WITHDRAWAL_PAISE = 10000; // Rs. 100 = 10,000 paise

/**
 * Preview calculations for withdrawal without applying database mutations.
 * Supports both authenticated member sessions and guest mode (zero prior FY aggregates).
 */
async function previewWithdrawal(memberId, method, amountPaise) {
  const normMethod = (method || "BANK").toUpperCase();
  const adminPercent = ADMIN_CHARGE_PERCENT[normMethod] ?? 0.10;

  // Guest Mode: Zero prior FY aggregates, default 3% rate on > ₹20k
  if (!memberId) {
    const thresholdPaise = 2000000; // Rs. 20,000
    const tdsRate = 0.03;
    const recovered194RPaise = 0;
    const taxableBasePaise = amountPaise;
    let tdsPaise = 0;

    if (taxableBasePaise > thresholdPaise) {
      tdsPaise = Math.floor(((taxableBasePaise - thresholdPaise) * 3) / 100);
    }

    const postTdsPaise = taxableBasePaise - tdsPaise;
    const adminChargePaise = Math.floor((postTdsPaise * (adminPercent * 100)) / 100);
    const netPaise = postTdsPaise - adminChargePaise;

    return {
      grossPaise: amountPaise,
      recovered194RPaise: 0,
      taxableBasePaise,
      tdsSection: "SECTION_194H",
      appliedTdsRatePct: tdsRate * 100,
      estimatedTdsPaise: tdsPaise,
      postTdsPaise,
      adminChargeRatePct: adminPercent * 100,
      estimatedAdminChargePaise: adminChargePaise,
      netPayablePaise: netPaise,
      kycStatus: "GUEST",
      kycTier: "TIER_0",
      currentFyGrossTotalPaise: 0,
      fyThresholdPaise: thresholdPaise,
      isGuest: true
    };
  }

  return await prisma.$transaction(async (tx) => {
    const member = await tx.member.findUnique({ where: { id: memberId } });
    if (!member) throw new Error("Member not found");

    // Step 0: 194R Liability
    const pending194R = await tdsService.getPending194RLiability(tx, memberId);
    const recovered194RPaise = Math.min(amountPaise, pending194R);
    const taxableBasePaise = amountPaise - recovered194RPaise;

    // Step 1: 194H TDS
    const { tdsPaise, rate: tdsRate, priorGrossPaise, thresholdPaise } =
      await tdsService.calculate194HTds(tx, memberId, taxableBasePaise);

    // Step 2: Admin Charge on Post-TDS Amount
    const postTdsPaise = taxableBasePaise - tdsPaise;
    const adminChargePaise = Math.floor((postTdsPaise * (adminPercent * 100)) / 100);

    // Step 3: Net Payable
    const netPaise = postTdsPaise - adminChargePaise;

    return {
      grossPaise: amountPaise,
      recovered194RPaise,
      taxableBasePaise,
      tdsSection: "SECTION_194H",
      appliedTdsRatePct: tdsRate * 100,
      estimatedTdsPaise: tdsPaise,
      postTdsPaise,
      adminChargeRatePct: adminPercent * 100,
      estimatedAdminChargePaise: adminChargePaise,
      netPayablePaise: netPaise,
      kycStatus: member.kycStatus,
      kycTier: member.kycTier,
      currentFyGrossTotalPaise: priorGrossPaise,
      fyThresholdPaise: thresholdPaise,
      isGuest: false
    };
  });
}

/**
 * Request a withdrawal with atomic FOR UPDATE lock and Step 0-3 calculation.
 */
async function requestWithdrawal(memberId, idCardId, method, amountPaise, paymentDetails = null, idempotencyKey = null) {
  if (amountPaise < MIN_WITHDRAWAL_PAISE) {
    throw new Error("Minimum withdrawal amount is Rs. 100");
  }

  const normMethod = (method || "BANK").toUpperCase();
  if (ADMIN_CHARGE_PERCENT[normMethod] === undefined) {
    throw new Error("Invalid withdrawal method. Supported: BANK, MEMBER_WALLET, VOUCHER_CONVERSION, UPI");
  }

  return await prisma.$transaction(async (tx) => {
    // 0. Idempotency Check
    if (idempotencyKey) {
      const existing = await tx.withdrawal.findUnique({
        where: { idempotencyKey }
      });
      if (existing) return existing;
    }

    // 1. Verify MAIN ID and ACB Status
    const idCard = await tx.memberIdCard.findFirst({
      where: { id: idCardId, memberId }
    });

    if (!idCard) {
      throw new Error("ID card not found or does not belong to member");
    }

    if (idCard.type !== "MAIN") {
      throw new Error("Withdrawals can only be initiated from MAIN ID card");
    }

    if (!idCard.acbStatus) {
      throw new Error("ACB status required for withdrawals. Achieve 1 LEFT + 1 RIGHT direct referral.");
    }

    // 2. Atomic Balance Check with Row Locking
    const wallets = await tx.$queryRaw`
      SELECT * FROM wallets WHERE "memberId" = ${memberId} FOR UPDATE
    `;
    const wallet = wallets && wallets[0];

    if (!wallet || wallet.balancePaise < amountPaise) {
      throw new Error(`Insufficient funds for member ${memberId}`);
    }

    // 3. Step 0: 194R Liability Recovery Preview
    const pending194R = await tdsService.getPending194RLiability(tx, memberId);
    const recovered194RPaise = Math.min(amountPaise, pending194R);
    const taxableBasePaise = amountPaise - recovered194RPaise;

    // 4. Step 1: 194H TDS on Taxable Base
    const { tdsPaise } = await tdsService.calculate194HTds(tx, memberId, taxableBasePaise);

    // 5. Step 2: Admin Charge on Post-TDS Amount
    const postTdsPaise = taxableBasePaise - tdsPaise;
    const adminPercent = ADMIN_CHARGE_PERCENT[normMethod];
    const adminChargePaise = Math.floor((postTdsPaise * (adminPercent * 100)) / 100);

    // 6. Step 3: Net Payable
    const netPaise = postTdsPaise - adminChargePaise;

    // Invariant Check
    if (amountPaise !== (recovered194RPaise + tdsPaise + adminChargePaise + netPaise)) {
      throw new Error("Ledger Math Assertion Failed: Gross does not equal Recovery + TDS + Admin + Net.");
    }

    // 7. Debit Escrow from Wallet
    await walletService.debit(tx, memberId, amountPaise, "WITHDRAWAL_ESCROW", null, "Withdrawal Request Escrow");

    // 8. Create Withdrawal Record
    const withdrawal = await tx.withdrawal.create({
      data: {
        memberId,
        idCardId,
        method: normMethod,
        grossPaise: amountPaise,
        recovered194RPaise,
        tdsPaise,
        adminChargePaise,
        netPaise,
        idempotencyKey: idempotencyKey || null,
        status: "REQUESTED",
        paymentDetails: paymentDetails ? JSON.stringify(paymentDetails) : null
      }
    });

    // 9. Hold TDS in TdsLedger as PENDING if applicable
    if (tdsPaise > 0) {
      await tx.tdsLedger.create({
        data: {
          memberId,
          section: "SECTION_194H",
          amountPaise: tdsPaise,
          status: "PENDING",
          referenceId: withdrawal.id
        }
      });
    }

    return withdrawal;
  });
}

/**
 * Complete / Approve Withdrawal: releases escrow and writes distinct split ledger entries.
 */
async function completeWithdrawal(withdrawalId, adminId = null) {
  return await prisma.$transaction(async (tx) => {
    const withdrawal = await tx.withdrawal.findUnique({
      where: { id: withdrawalId }
    });

    if (!withdrawal) throw new Error("Withdrawal not found");
    if (withdrawal.status !== "REQUESTED") {
      throw new Error(`Withdrawal already processed (Status: ${withdrawal.status})`);
    }

    // 1. Recover Step 0 194R Liability if any
    if (withdrawal.recovered194RPaise > 0) {
      await tdsService.recover194RLiability(tx, withdrawal.memberId, withdrawal.recovered194RPaise);
    }

    // 2. Reverse Escrow
    await walletService.credit(
      tx,
      withdrawal.memberId,
      withdrawal.grossPaise,
      "ESCROW_RELEASED",
      withdrawal.id,
      "Reversing escrow for final payout splits"
    );

    // 3. Post Individual Split Debits
    await walletService.debit(
      tx,
      withdrawal.memberId,
      withdrawal.netPaise,
      "WITHDRAWAL_PAYOUT",
      withdrawal.id,
      `Net Payout via ${withdrawal.method}`
    );

    if (withdrawal.tdsPaise > 0) {
      await walletService.debit(
        tx,
        withdrawal.memberId,
        withdrawal.tdsPaise,
        "TDS_DEDUCTED",
        withdrawal.id,
        "TDS Section 194H"
      );
      // Mark TDS as deposited
      await tdsService.depositTDS(tx, withdrawal.id);
    }

    if (withdrawal.adminChargePaise > 0) {
      await walletService.debit(
        tx,
        withdrawal.memberId,
        withdrawal.adminChargePaise,
        "ADMIN_FEE",
        withdrawal.id,
        "Admin Charge"
      );
    }

    if (withdrawal.recovered194RPaise > 0) {
      await walletService.debit(
        tx,
        withdrawal.memberId,
        withdrawal.recovered194RPaise,
        "TDS_194R_RECOVERY",
        withdrawal.id,
        "194R Voucher Tax Recovery"
      );
    }

    // 4. Mark Withdrawal as COMPLETED
    return await tx.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: "COMPLETED",
        completedAt: new Date()
      }
    });
  });
}

/**
 * Reject Withdrawal: refunds escrow in full and reverses held TDS.
 */
async function rejectWithdrawal(withdrawalId, rejectionReason = "Rejected by admin", adminId = null) {
  return await prisma.$transaction(async (tx) => {
    const withdrawal = await tx.withdrawal.findUnique({
      where: { id: withdrawalId }
    });

    if (!withdrawal) throw new Error("Withdrawal not found");
    if (withdrawal.status !== "REQUESTED") {
      throw new Error(`Withdrawal already processed (Status: ${withdrawal.status})`);
    }

    // 1. Refund the wallet (release escrow)
    await walletService.credit(
      tx,
      withdrawal.memberId,
      withdrawal.grossPaise,
      "WITHDRAWAL_REFUND",
      withdrawal.id,
      `Withdrawal Rejected: ${rejectionReason}`
    );

    // 2. Reverse TDS Ledger entries
    await tdsService.reverseTDS(tx, withdrawal.id);

    // 3. Mark as REJECTED
    return await tx.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: "REJECTED",
        completedAt: new Date(),
        rejectionReason
      }
    });
  });
}

async function processWithdrawal(withdrawalId, action, rejectionReason = null) {
  if (action === "APPROVE" || action === "COMPLETE") {
    return await completeWithdrawal(withdrawalId);
  }
  if (action === "REJECT") {
    return await rejectWithdrawal(withdrawalId, rejectionReason);
  }
  throw new Error("Invalid action. Must be APPROVE or REJECT.");
}

/**
 * Get withdrawal history for a member.
 */
async function getWithdrawalHistory(memberId, filters = {}) {
  const where = { memberId };
  if (filters.status) where.status = filters.status;

  return await prisma.withdrawal.findMany({
    where,
    orderBy: { requestedAt: "desc" },
    take: filters.limit || 50,
    skip: filters.offset || 0
  });
}

/**
 * Get pending withdrawals for admin review.
 */
async function getPendingWithdrawals(adminFilters = {}) {
  const where = { status: "REQUESTED" };

  return await prisma.withdrawal.findMany({
    where,
    include: {
      member: {
        select: { id: true, memberCode: true, name: true, mobile: true, kycStatus: true }
      },
      idCard: {
        select: { id: true, cardNumber: true, type: true, acbStatus: true }
      }
    },
    orderBy: { requestedAt: "asc" },
    take: adminFilters.limit || 50,
    skip: adminFilters.offset || 0
  });
}

module.exports = {
  previewWithdrawal,
  requestWithdrawal,
  createWithdrawalRequest: requestWithdrawal,
  completeWithdrawal,
  approveWithdrawal: completeWithdrawal,
  rejectWithdrawal,
  processWithdrawal,
  getWithdrawalHistory,
  getPendingWithdrawals,
  ADMIN_CHARGE_PERCENT,
  MIN_WITHDRAWAL_PAISE
};
