const prisma = require("../lib/prisma");
const adminService = require("./adminService");

// Section Thresholds (in Paise)
const THRESHOLD_194H_PAISE = 2000000;   // ₹20,000
const THRESHOLD_194R_PAISE = 2000000;   // ₹20,000
const SINGLE_194C_PAISE = 3000000;      // ₹30,000
const AGGREGATE_194C_PAISE = 10000000;  // ₹1,00,000

/**
 * Returns exact start and end timestamps for the Indian Financial Year (April 1 to March 31).
 */
function getCurrentFinancialYearRange(date = new Date()) {
  const d = new Date(date);
  let year = d.getFullYear();
  const month = d.getMonth(); // 0 = Jan, 3 = Apr

  if (month < 3) {
    year = year - 1;
  }

  const startDate = new Date(year, 3, 1, 0, 0, 0, 0); // Apr 1 00:00:00
  const endDate = new Date(year + 1, 2, 31, 23, 59, 59, 999); // Mar 31 23:59:59.999

  return { startDate, endDate };
}

const getCurrentFYDateRange = getCurrentFinancialYearRange;

/**
 * Section 194H: Member Cash Commissions
 * ₹20k FY threshold, marginal method, 3% with PAN / KYC Tier 2 / Verified, 20% without.
 */
async function calculate194HTds(tx, memberId, requestGrossPaise) {
  const member = await tx.member.findUnique({ where: { id: memberId } });
  if (!member) {
    throw new Error(`Member with id ${memberId} not found`);
  }

  let rate = 0.03;
  const isPanVerified = member.panVerified || member.kycStatus === "VERIFIED" || member.kycTier === "TIER2";

  if (isPanVerified) {
    const dynamicRate = await adminService.getSetting("TDS_194H_RATE").catch(() => null);
    rate = dynamicRate ? parseFloat(dynamicRate) / 100 : 0.03;
  } else {
    const unverifiedRate = await adminService.getSetting("TDS_UNVERIFIED_RATE").catch(() => null);
    rate = unverifiedRate ? parseFloat(unverifiedRate) / 100 : 0.20;
  }

  const { startDate, endDate } = getCurrentFinancialYearRange();

  // Find all COMPLETED withdrawals in the current FY
  const pastWithdrawals = await tx.withdrawal.findMany({
    where: {
      memberId,
      status: "COMPLETED",
      completedAt: {
        gte: startDate,
        lte: endDate
      }
    }
  });

  const priorGrossPaise = pastWithdrawals.reduce((sum, w) => sum + (w.grossPaise - (w.recovered194RPaise || 0)), 0);
  const totalGrossPaise = priorGrossPaise + requestGrossPaise;

  let taxablePaise = 0;

  if (totalGrossPaise > THRESHOLD_194H_PAISE) {
    if (priorGrossPaise >= THRESHOLD_194H_PAISE) {
      taxablePaise = requestGrossPaise;
    } else {
      taxablePaise = totalGrossPaise - THRESHOLD_194H_PAISE;
    }
  }

  const tdsPaise = Math.floor((taxablePaise * (rate * 100)) / 100);

  return {
    tdsPaise,
    taxablePaise,
    rate,
    priorGrossPaise,
    totalGrossPaise,
    thresholdPaise: THRESHOLD_194H_PAISE,
    isPanVerified
  };
}

/**
 * Section 194R: Product Vouchers
 * ₹20k FY threshold, full aggregate method (10% of FULL aggregate once crossed).
 */
async function calculate194R(tx, memberId, newVoucherFaceValuePaise, currentVoucherId = null) {
  const { startDate, endDate } = getCurrentFinancialYearRange();

  // 1. Get all vouchers redeemed in current FY
  const redeemedVouchers = await tx.voucher.findMany({
    where: {
      memberId,
      status: "REDEEMED",
      redeemedAt: {
        gte: startDate,
        lte: endDate
      }
    }
  });

  const priorRedeemedPaise = redeemedVouchers
    .filter(v => v.id !== currentVoucherId)
    .reduce((sum, v) => sum + v.faceValuePaise, 0);
  const totalVoucherPaise = priorRedeemedPaise + newVoucherFaceValuePaise;

  // 2. Get existing 194R liability recorded in current FY
  const past194RLedger = await tx.tdsLedger.findMany({
    where: {
      memberId,
      section: "SECTION_194R",
      createdAt: {
        gte: startDate,
        lte: endDate
      },
      status: { in: ["PENDING", "HELD", "DEPOSITED", "RECOVERED"] }
    }
  });

  const existing194RLiabilityPaise = past194RLedger.reduce((sum, l) => sum + l.amountPaise, 0);

  let liabilityPaise = 0;
  if (totalVoucherPaise > THRESHOLD_194R_PAISE) {
    // 10% on FULL aggregate
    const totalTargetTaxPaise = Math.floor((totalVoucherPaise * 10) / 100);
    liabilityPaise = Math.max(0, totalTargetTaxPaise - existing194RLiabilityPaise);
  }

  return {
    liabilityPaise,
    totalVoucherPaise,
    priorRedeemedPaise,
    thresholdExceeded: totalVoucherPaise > THRESHOLD_194R_PAISE,
    existingLiabilityPaise: existing194RLiabilityPaise
  };
}

/**
 * Hook to record 194R liability on voucher redemption.
 */
async function create194RLiability(tx, memberId, voucherFaceValuePaise, referenceId = null) {
  const calc = await calculate194R(tx, memberId, voucherFaceValuePaise, referenceId);

  if (calc.liabilityPaise > 0) {
    await tx.tdsLedger.create({
      data: {
        memberId,
        section: "SECTION_194R",
        amountPaise: calc.liabilityPaise,
        status: "PENDING",
        referenceId
      }
    });
  }

  return calc;
}

/**
 * Section 194C: Vendor Settlements
 * ₹30k single / ₹1L aggregate per FY. Rates: 1% individual+PAN, 2% company+PAN, 20% no PAN.
 */
async function calculate194C(tx, vendorId, settlementAmountPaise, entityType = "INDIVIDUAL", hasPan = true) {
  let rate = 0.20;
  if (hasPan) {
    rate = entityType.toUpperCase() === "COMPANY" ? 0.02 : 0.01;
  }

  const { startDate, endDate } = getCurrentFinancialYearRange();

  const pastSettlements = await tx.vendorSettlement.findMany({
    where: {
      vendorId,
      status: "SETTLED",
      settledAt: {
        gte: startDate,
        lte: endDate
      }
    }
  });

  const priorGrossPaise = pastSettlements.reduce((sum, s) => sum + s.grossSalesPaise, 0);
  const totalGrossPaise = priorGrossPaise + settlementAmountPaise;

  const isSingleThresholdCrossed = settlementAmountPaise >= SINGLE_194C_PAISE;
  const isAggregateThresholdCrossed = totalGrossPaise > AGGREGATE_194C_PAISE;

  let taxablePaise = 0;

  if (isSingleThresholdCrossed || isAggregateThresholdCrossed) {
    if (priorGrossPaise >= AGGREGATE_194C_PAISE || isSingleThresholdCrossed) {
      taxablePaise = settlementAmountPaise;
    } else {
      taxablePaise = totalGrossPaise - AGGREGATE_194C_PAISE;
    }
  }

  const tdsPaise = Math.floor((taxablePaise * (rate * 100)) / 100);

  return {
    tdsPaise,
    taxablePaise,
    rate,
    thresholdExceeded: isSingleThresholdCrossed || isAggregateThresholdCrossed
  };
}

/**
 * Section 194H: Vendor Referral Bonus
 * ₹20k FY threshold, 3% with PAN / 20% without.
 */
async function calculate194HVendorReferralTds(tx, memberId, bonusAmountPaise) {
  const member = await tx.member.findUnique({ where: { id: memberId } });
  const isPanVerified = member?.panVerified || member?.kycStatus === "VERIFIED" || member?.kycTier === "TIER2";
  const rate = isPanVerified ? 0.03 : 0.20;

  const { startDate, endDate } = getCurrentFinancialYearRange();

  const pastBonuses = await tx.vendorReferralBonus.findMany({
    where: {
      memberId,
      status: "PAID",
      createdAt: {
        gte: startDate,
        lte: endDate
      }
    }
  });

  const priorBonusPaise = pastBonuses.reduce((sum, b) => sum + b.bonusPaise, 0);
  const totalBonusPaise = priorBonusPaise + bonusAmountPaise;

  let taxablePaise = 0;
  if (totalBonusPaise > THRESHOLD_194H_PAISE) {
    if (priorBonusPaise >= THRESHOLD_194H_PAISE) {
      taxablePaise = bonusAmountPaise;
    } else {
      taxablePaise = totalBonusPaise - THRESHOLD_194H_PAISE;
    }
  }

  const tdsPaise = Math.floor((taxablePaise * (rate * 100)) / 100);

  return {
    tdsPaise,
    taxablePaise,
    rate
  };
}

/**
 * Gets outstanding (unrecovered) 194R voucher liability for a member.
 */
async function getPending194RLiability(tx, memberId) {
  const pendingEntries = await tx.tdsLedger.findMany({
    where: {
      memberId,
      section: "SECTION_194R",
      status: { in: ["PENDING", "HELD"] }
    }
  });

  return pendingEntries.reduce((sum, e) => sum + e.amountPaise, 0);
}

/**
 * Settles/recovers 194R liability up to maxDeductPaise.
 */
async function recover194RLiability(tx, memberId, maxDeductPaise) {
  if (maxDeductPaise <= 0) return 0;

  const pendingEntries = await tx.tdsLedger.findMany({
    where: {
      memberId,
      section: "SECTION_194R",
      status: { in: ["PENDING", "HELD"] }
    },
    orderBy: { createdAt: "asc" }
  });

  let remainingToDeduct = maxDeductPaise;
  let totalRecovered = 0;

  for (const entry of pendingEntries) {
    if (remainingToDeduct <= 0) break;

    if (entry.amountPaise <= remainingToDeduct) {
      await tx.tdsLedger.update({
        where: { id: entry.id },
        data: { status: "RECOVERED" }
      });
      remainingToDeduct -= entry.amountPaise;
      totalRecovered += entry.amountPaise;
    } else {
      // Partial recovery: split entry
      await tx.tdsLedger.update({
        where: { id: entry.id },
        data: { amountPaise: entry.amountPaise - remainingToDeduct }
      });

      await tx.tdsLedger.create({
        data: {
          memberId,
          section: "SECTION_194R",
          amountPaise: remainingToDeduct,
          status: "RECOVERED",
          referenceId: entry.referenceId
        }
      });

      totalRecovered += remainingToDeduct;
      remainingToDeduct = 0;
    }
  }

  return totalRecovered;
}

/**
 * Creates generic TdsLedger entry.
 */
async function trackTDSLedger(tx, { memberId, section, amountPaise, status = "HELD", referenceId = null }) {
  return await tx.tdsLedger.create({
    data: {
      memberId,
      section,
      amountPaise,
      status,
      referenceId
    }
  });
}

/**
 * Marks TDS entries associated with a withdrawal as DEPOSITED.
 */
async function depositTDS(tx, withdrawalId) {
  return await tx.tdsLedger.updateMany({
    where: {
      referenceId: withdrawalId,
      status: { in: ["PENDING", "HELD"] }
    },
    data: {
      status: "DEPOSITED"
    }
  });
}

/**
 * Reverses TDS entries associated with a rejected withdrawal.
 */
async function reverseTDS(tx, withdrawalId) {
  return await tx.tdsLedger.updateMany({
    where: {
      referenceId: withdrawalId,
      status: { in: ["PENDING", "HELD"] }
    },
    data: {
      status: "REVERSED"
    }
  });
}

module.exports = {
  getCurrentFinancialYearRange,
  getCurrentFYDateRange,
  calculate194HTds,
  calculate194R,
  create194RLiability,
  calculate194C,
  calculate194HVendorReferralTds,
  getPending194RLiability,
  recover194RLiability,
  trackTDSLedger,
  depositTDS,
  reverseTDS,
  THRESHOLD_194H_PAISE,
  THRESHOLD_194R_PAISE,
  SINGLE_194C_PAISE,
  AGGREGATE_194C_PAISE
};
