const prisma = require("../lib/prisma");
const tdsService = require("./tdsService");
const setuKoshService = require("./setuKoshService");
const adminService = require("./adminService");
const walletService = require("./walletService");

const EARLY_SETTLEMENT_FEE_PAISE = 25000; // Rs. 250 in paise
const SECURITY_DEPOSIT_PAISE = 500000; // Rs. 5,000 in paise
const WALLET_MIN_BALANCE_PAISE = 50000; // Rs. 500 in paise

/**
 * Calculates volume discount percentage on the admin charge based on monthly sales in the calendar month containing periodEnd.
 */
async function getVolumeDiscountPct(tx, vendorId, periodEnd) {
  const year = periodEnd.getFullYear();
  const month = periodEnd.getMonth();
  const monthStart = new Date(year, month, 1, 0, 0, 0, 0);
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);

  const aggregate = await tx.vendorSale.aggregate({
    where: {
      vendorId,
      status: { notIn: ["REFUNDED", "CANCELLED"] },
      createdAt: {
        gte: monthStart,
        lte: monthEnd
      }
    },
    _sum: { amountPaise: true }
  });

  const monthlySales = aggregate._sum.amountPaise || 0;

  const t5Min = await adminService.getSetting("VOLUME_DISCOUNT_TIER_5_MIN_SALES_PAISE", 50000000, "integer");
  const t5Rate = await adminService.getSetting("VOLUME_DISCOUNT_TIER_5_RATE_PCT", 50, "integer");
  const t4Min = await adminService.getSetting("VOLUME_DISCOUNT_TIER_4_MIN_SALES_PAISE", 20000000, "integer");
  const t4Rate = await adminService.getSetting("VOLUME_DISCOUNT_TIER_4_RATE_PCT", 30, "integer");
  const t3Min = await adminService.getSetting("VOLUME_DISCOUNT_TIER_3_MIN_SALES_PAISE", 10000000, "integer");
  const t3Rate = await adminService.getSetting("VOLUME_DISCOUNT_TIER_3_RATE_PCT", 20, "integer");
  const t2Min = await adminService.getSetting("VOLUME_DISCOUNT_TIER_2_MIN_SALES_PAISE", 5000000, "integer");
  const t2Rate = await adminService.getSetting("VOLUME_DISCOUNT_TIER_2_RATE_PCT", 10, "integer");

  if (monthlySales >= t5Min) return t5Rate;
  if (monthlySales >= t4Min) return t4Rate;
  if (monthlySales >= t3Min) return t3Rate;
  if (monthlySales >= t2Min) return t2Rate;
  return 0;
}

/**
 * Pure integer settlement calculation breakdown for a set of vendor sales.
 */
async function calculateSettlementBreakdown(tx, sales, vendor, options = {}) {
  const { isEarly = false, periodEnd = new Date(), adminRatePctOverride = null } = options;

  const grossSalesPaise = sales.reduce((sum, sale) => sum + sale.amountPaise, 0);

  // Platform Margin: sum of snapshotted marginPaise per sale
  const marginPaise = sales.reduce((sum, sale) => {
    return sum + (sale.marginPaise > 0 ? sale.marginPaise : Math.floor((sale.amountPaise * vendor.marginRatePct) / 100));
  }, 0);

  const postMarginPaise = grossSalesPaise - marginPaise;

  // Admin Charge Rate: Configurable via PlatformSetting or default (10% Bank / 5% Wallet)
  let adminRatePct = adminRatePctOverride;
  if (adminRatePct === null) {
    const settingKey = vendor.payoutMethod === "WALLET" ? "VENDOR_ADMIN_CHARGE_WALLET_PCT" : "VENDOR_ADMIN_CHARGE_BANK_PCT";
    const customRate = await adminService.getSetting(settingKey, vendor.payoutMethod === "WALLET" ? 5 : 10, "number");
    adminRatePct = customRate !== null ? customRate : (vendor.payoutMethod === "WALLET" ? 5 : 10);
  }

  const baseAdminChargePaise = Math.floor((postMarginPaise * adminRatePct) / 100);

  // Volume Discount: Applies to admin charge ONLY
  const discountPct = await getVolumeDiscountPct(tx, vendor.id, periodEnd);
  const volumeDiscountPaise = Math.floor((baseAdminChargePaise * discountPct) / 100);
  const netAdminChargePaise = baseAdminChargePaise - volumeDiscountPaise;

  // Early Fee: Deducted before TDS
  const earlyFeeSetting = await adminService.getSetting("EARLY_SETTLEMENT_FEE_PAISE", EARLY_SETTLEMENT_FEE_PAISE, "integer");
  const earlyFeePaise = isEarly ? earlyFeeSetting : 0;
  const payoutBeforeTdsPaise = Math.max(0, postMarginPaise - netAdminChargePaise - earlyFeePaise);

  // 194C TDS Calculation
  let hasPan = Boolean(vendor.gstin);
  const vMember = vendor.member || (vendor.memberId ? (await tx.member.findUnique({ where: { id: vendor.memberId } })) : null);
  if (vMember) {
    hasPan = Boolean(hasPan || vMember.panVerified || vMember.kycStatus === "VERIFIED" || vMember.kycTier === "TIER2" || vMember.panNumber);
  }
  const entityType = vendor.category === "COMPANY" ? "COMPANY" : "INDIVIDUAL";

  const tdsResult = await tdsService.calculate194C(tx, vendor.id, payoutBeforeTdsPaise, entityType, hasPan);
  const tdsPaise = tdsResult.tdsPaise;
  const netPayablePaise = Math.max(0, payoutBeforeTdsPaise - tdsPaise);

  return {
    grossSalesPaise,
    marginPaise,
    postMarginPaise,
    adminRatePct,
    baseAdminChargePaise,
    volumeDiscountPct: discountPct,
    volumeDiscountPaise,
    netAdminChargePaise,
    earlyFeePaise,
    payoutBeforeTdsPaise,
    tdsPaise,
    tdsRate: tdsResult.rate,
    netPayablePaise
  };
}

/**
 * Process the weekly Monday settlement.
 * Runs for the previous Monday 00:00:00 to Sunday 23:59:59.
 */
async function processWeeklySettlement(runDate = new Date(), options = {}) {
  const { adminRatePctOverride = null, actorId = null } = options;

  // 1. Determine period boundaries
  const periodEnd = new Date(runDate);
  periodEnd.setHours(0, 0, 0, 0); // Monday 00:00
  periodEnd.setMilliseconds(-1); // Prior Sunday 23:59:59.999

  const periodStart = new Date(periodEnd);
  periodStart.setDate(periodStart.getDate() - 6);
  periodStart.setHours(0, 0, 0, 0); // Prior Monday 00:00:00

  // 2. Idempotency on runDate
  const normalizedRunDate = new Date(runDate);
  normalizedRunDate.setHours(0, 0, 0, 0);

  const existingRun = await prisma.settlementRun.findUnique({
    where: { runDate: normalizedRunDate }
  });

  if (existingRun && existingRun.status === "COMPLETED") {
    return {
      settlementRun: existingRun,
      alreadyRan: true
    };
  }

  const settlementRun = await prisma.settlementRun.upsert({
    where: { runDate: normalizedRunDate },
    update: { status: "RUNNING", startedAt: new Date() },
    create: {
      runDate: normalizedRunDate,
      runType: "REGULAR",
      periodStart,
      periodEnd,
      status: "RUNNING"
    }
  });

  let totalEntries = 0;
  let totalGrossPaise = 0;
  let totalNetPaise = 0;

  try {
    const vendors = await prisma.vendor.findMany({
      where: { status: { in: ["ACTIVE", "VERIFIED"] } },
      include: { member: true }
    });

    for (const vendor of vendors) {
      await prisma.$transaction(async (tx) => {
        // Find unsettled sales for this vendor in period
        const sales = await tx.vendorSale.findMany({
          where: {
            vendorId: vendor.id,
            status: { notIn: ["REFUNDED", "CANCELLED", "SETTLED"] },
            createdAt: {
              gte: periodStart,
              lte: periodEnd
            }
          }
        });

        if (sales.length === 0) return;

        const breakdown = await calculateSettlementBreakdown(tx, sales, vendor, {
          isEarly: false,
          periodEnd,
          adminRatePctOverride
        });

        const settlementStatus = vendor.payoutMethod === "WALLET" ? "COMPLETED" : "PAYOUT_DUE";

        const settlement = await tx.vendorSettlement.create({
          data: {
            vendorId: vendor.id,
            settlementRunId: settlementRun.id,
            grossSalesPaise: breakdown.grossSalesPaise,
            marginPaise: breakdown.marginPaise,
            postMarginPaise: breakdown.postMarginPaise,
            adminChargePaise: breakdown.netAdminChargePaise,
            volumeDiscountPaise: breakdown.volumeDiscountPaise,
            earlyFeePaise: 0,
            payoutBeforeTdsPaise: breakdown.payoutBeforeTdsPaise,
            tdsPaise: breakdown.tdsPaise,
            netPayablePaise: breakdown.netPayablePaise,
            payoutMethod: vendor.payoutMethod,
            status: settlementStatus,
            periodStart,
            periodEnd,
            settledAt: new Date()
          }
        });

        // Mark sales as SETTLED
        await tx.vendorSale.updateMany({
          where: { id: { in: sales.map(s => s.id) } },
          data: { status: "SETTLED" }
        });

        // If WALLET method, credit member wallet
        if (vendor.payoutMethod === "WALLET" && breakdown.netPayablePaise > 0) {
          await walletService.credit(
            tx,
            vendor.memberId,
            breakdown.netPayablePaise,
            "VENDOR_SETTLEMENT",
            settlement.id,
            `Weekly Vendor Settlement Payout for ${vendor.businessName}`
          );
        }

        totalEntries++;
        totalGrossPaise += breakdown.grossSalesPaise;
        totalNetPaise += breakdown.netPayablePaise;
      });
    }

    // Release Weekly Member Commissions (Setu Kosh & Vendor Referral Bonus)
    await prisma.$transaction(async (tx) => {
      await setuKoshService.settlePending(tx, settlementRun.id);
    });

    // Update SettlementRun as COMPLETED
    const completedRun = await prisma.settlementRun.update({
      where: { id: settlementRun.id },
      data: {
        status: "COMPLETED",
        totalEntries,
        totalPaise: totalNetPaise,
        grossPaise: totalGrossPaise,
        netPaise: totalNetPaise,
        vendorCount: totalEntries,
        completedAt: new Date()
      }
    });

    // Audit Log
    await prisma.auditLog.create({
      data: {
        actorId,
        actorType: actorId ? "ADMIN" : "SYSTEM",
        action: "WEEKLY_SETTLEMENT_COMPLETED",
        entityType: "SettlementRun",
        entityId: settlementRun.id,
        metadata: {
          periodStart,
          periodEnd,
          vendorCount: totalEntries,
          grossPaise: totalGrossPaise,
          netPaise: totalNetPaise
        }
      }
    });

    return {
      settlementRun: completedRun,
      totalEntries,
      grossPaise: totalGrossPaise,
      netPaise: totalNetPaise
    };
  } catch (error) {
    await prisma.settlementRun.update({
      where: { id: settlementRun.id },
      data: { status: "FAILED", completedAt: new Date() }
    });
    throw error;
  }
}

/**
 * On-demand Early Settlement for a specific vendor.
 * Flat Rs. 250 fee is deducted; marked runType = EARLY; releases NO member commissions.
 */
async function processEarlySettlement(vendorId, options = {}) {
  const { adminRatePctOverride = null, actorId = null } = options;

  return await prisma.$transaction(async (tx) => {
    const vendor = await tx.vendor.findUnique({
      where: { id: vendorId },
      include: { member: true }
    });

    if (!vendor) {
      throw new Error(`Vendor ${vendorId} not found`);
    }

    // Find all unsettled sales
    const sales = await tx.vendorSale.findMany({
      where: {
        vendorId: vendor.id,
        status: { notIn: ["REFUNDED", "CANCELLED", "SETTLED"] }
      }
    });

    if (sales.length === 0) {
      throw new Error("No unsettled sales available for early settlement");
    }

    const now = new Date();
    const periodStart = sales.reduce((min, s) => s.createdAt < min ? s.createdAt : min, sales[0].createdAt);
    const periodEnd = now;

    const breakdown = await calculateSettlementBreakdown(tx, sales, vendor, {
      isEarly: true,
      periodEnd: now,
      adminRatePctOverride
    });

    // Create SettlementRun marked EARLY
    const settlementRun = await tx.settlementRun.create({
      data: {
        runDate: now,
        runType: "EARLY",
        periodStart,
        periodEnd,
        status: "COMPLETED",
        totalEntries: 1,
        totalPaise: breakdown.netPayablePaise,
        grossPaise: breakdown.grossSalesPaise,
        netPaise: breakdown.netPayablePaise,
        vendorCount: 1,
        completedAt: now
      }
    });

    const settlementStatus = vendor.payoutMethod === "WALLET" ? "COMPLETED" : "PAYOUT_DUE";

    const settlement = await tx.vendorSettlement.create({
      data: {
        vendorId: vendor.id,
        settlementRunId: settlementRun.id,
        grossSalesPaise: breakdown.grossSalesPaise,
        marginPaise: breakdown.marginPaise,
        postMarginPaise: breakdown.postMarginPaise,
        adminChargePaise: breakdown.netAdminChargePaise,
        volumeDiscountPaise: breakdown.volumeDiscountPaise,
        earlyFeePaise: breakdown.earlyFeePaise,
        payoutBeforeTdsPaise: breakdown.payoutBeforeTdsPaise,
        tdsPaise: breakdown.tdsPaise,
        netPayablePaise: breakdown.netPayablePaise,
        payoutMethod: vendor.payoutMethod,
        status: settlementStatus,
        periodStart,
        periodEnd,
        settledAt: now
      }
    });

    // Mark sales as SETTLED
    await tx.vendorSale.updateMany({
      where: { id: { in: sales.map(s => s.id) } },
      data: { status: "SETTLED" }
    });

    // If WALLET, credit wallet
    if (vendor.payoutMethod === "WALLET" && breakdown.netPayablePaise > 0) {
      await walletService.credit(
        tx,
        vendor.memberId,
        breakdown.netPayablePaise,
        "VENDOR_SETTLEMENT",
        settlement.id,
        `Early Vendor Settlement Payout for ${vendor.businessName} (Rs. 250 fee applied)`
      );
    }

    // Audit Log
    await tx.auditLog.create({
      data: {
        actorId: actorId || vendor.memberId,
        actorType: actorId ? "ADMIN" : "MEMBER",
        action: "EARLY_SETTLEMENT_EXECUTED",
        entityType: "VendorSettlement",
        entityId: settlement.id,
        metadata: {
          vendorId: vendor.id,
          grossSalesPaise: breakdown.grossSalesPaise,
          earlyFeePaise: breakdown.earlyFeePaise,
          netPayablePaise: breakdown.netPayablePaise
        }
      }
    });

    return settlement;
  });
}

/**
 * Inactivity Lifecycle Daily Sweep:
 * Evaluates days since last sale:
 * >= 31 days -> INACTIVE
 * >= 91 days -> FROZEN (deposit frozen)
 * >= 181 days -> CLOSED (earnings streams redirected to COMPANY_WALLET)
 */
async function sweepVendorInactivity(currentDate = new Date()) {
  const vendors = await prisma.vendor.findMany({
    where: { status: { in: ["ACTIVE", "INACTIVE", "FROZEN"] } }
  });

  const companyWalletSetting = await adminService.getSetting("COMPANY_WALLET_MEMBER_ID").catch(() => null);
  const companyWalletTarget = companyWalletSetting || "COMPANY_WALLET";

  const results = {
    inactivated: 0,
    frozen: 0,
    closed: 0
  };

  const inactiveDaysLimit = await adminService.getSetting("VENDOR_INACTIVITY_INACTIVE_DAYS", 31, "integer");
  const frozenDaysLimit = await adminService.getSetting("VENDOR_INACTIVITY_FROZEN_DAYS", 91, "integer");
  const closedDaysLimit = await adminService.getSetting("VENDOR_INACTIVITY_CLOSED_DAYS", 181, "integer");

  for (const vendor of vendors) {
    const referenceDate = vendor.lastSaleAt || vendor.joinedAt;
    const diffMs = currentDate.getTime() - new Date(referenceDate).getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays >= closedDaysLimit && vendor.status !== "CLOSED") {
      await prisma.$transaction(async (tx) => {
        await tx.vendor.update({
          where: { id: vendor.id },
          data: { status: "CLOSED", isDepositFrozen: true }
        });

        // Ensure companyWalletTarget member exists before updating foreign key
        await tx.member.upsert({
          where: { id: companyWalletTarget },
          create: {
            id: companyWalletTarget,
            name: "Company Reserve Wallet",
            mobile: "0000000000",
            status: "SYSTEM"
          },
          update: {}
        });

        // Redirect pending vendor referral bonuses to COMPANY_WALLET
        await tx.vendorReferralBonus.updateMany({
          where: { referredVendorId: vendor.id, status: "PENDING" },
          data: { memberId: companyWalletTarget }
        });

        await tx.auditLog.create({
          data: {
            actorType: "SYSTEM",
            action: "VENDOR_LIFECYCLE_CLOSED",
            entityType: "Vendor",
            entityId: vendor.id,
            metadata: { diffDays, previousStatus: vendor.status, redirectedTo: companyWalletTarget }
          }
        });
      });
      results.closed++;
    } else if (diffDays >= frozenDaysLimit && vendor.status !== "FROZEN" && vendor.status !== "CLOSED") {
      await prisma.vendor.update({
        where: { id: vendor.id },
        data: { status: "FROZEN", isDepositFrozen: true }
      });

      await prisma.auditLog.create({
        data: {
          actorType: "SYSTEM",
          action: "VENDOR_LIFECYCLE_FROZEN",
          entityType: "Vendor",
          entityId: vendor.id,
          metadata: { diffDays, previousStatus: vendor.status }
        }
      });
      results.frozen++;
    } else if (diffDays >= inactiveDaysLimit && vendor.status === "ACTIVE") {
      await prisma.vendor.update({
        where: { id: vendor.id },
        data: { status: "INACTIVE" }
      });

      await prisma.auditLog.create({
        data: {
          actorType: "SYSTEM",
          action: "VENDOR_LIFECYCLE_INACTIVE",
          entityType: "Vendor",
          entityId: vendor.id,
          metadata: { diffDays, previousStatus: vendor.status }
        }
      });
      results.inactivated++;
    }
  }

  return results;
}

/**
 * Security Deposit Freeze Check:
 * Auto-freezes deposit if vendor wallet balance < Rs. 500.
 */
async function checkDepositFreeze(tx, vendorId) {
  const vendor = await tx.vendor.findUnique({
    where: { id: vendorId },
    include: { member: { include: { wallet: true } } }
  });

  if (!vendor) return;

  const walletBalance = vendor.walletBalancePaise || vendor.member?.wallet?.balancePaise || 0;

  if (walletBalance < WALLET_MIN_BALANCE_PAISE && !vendor.isDepositFrozen) {
    await tx.vendor.update({
      where: { id: vendor.id },
      data: { isDepositFrozen: true }
    });
  } else if (walletBalance >= WALLET_MIN_BALANCE_PAISE && vendor.isDepositFrozen && vendor.status !== "FROZEN" && vendor.status !== "CLOSED") {
    await tx.vendor.update({
      where: { id: vendor.id },
      data: { isDepositFrozen: false }
    });
  }
}

/**
 * Admin Fraud Penalty:
 * FRAUD = 10x transaction value + permanent deactivation
 * TAMPERING = 5x transaction value
 * QR_REFUSAL = Rs. 1,000 (100,000 paise) flat
 *
 * Recovery Order: Pending member commissions covered from security deposit FIRST, then forfeit penalty.
 */
async function penalizeVendor(vendorId, penaltyType, transactionAmountPaise = 0, actorId = null) {
  return await prisma.$transaction(async (tx) => {
    const vendor = await tx.vendor.findUnique({
      where: { id: vendorId },
      include: { member: true }
    });

    if (!vendor) {
      throw new Error(`Vendor ${vendorId} not found`);
    }

    let penaltyPaise = 0;
    const normType = (penaltyType || "").toUpperCase();

    if (normType === "FRAUD") {
      penaltyPaise = transactionAmountPaise * 10;
    } else if (normType === "TAMPERING") {
      penaltyPaise = transactionAmountPaise * 5;
    } else if (normType === "QR_REFUSAL") {
      penaltyPaise = 100000; // Flat Rs. 1,000
    } else {
      throw new Error(`Invalid penalty type: ${penaltyType}`);
    }

    // 1. Cover pending member commissions for this vendor from deposit first
    const pendingCommissions = await tx.commissionEntry.findMany({
      where: {
        status: "PENDING_SETTLEMENT",
        idCard: { memberId: vendor.memberId }
      }
    });

    let depositRemaining = vendor.securityDepositPaise;
    let memberCommissionsCovered = 0;

    for (const comm of pendingCommissions) {
      if (depositRemaining >= comm.amountPaise) {
        depositRemaining -= comm.amountPaise;
        memberCommissionsCovered += comm.amountPaise;
      }
    }

    // 2. Forfeit remainder of penalty
    const penaltyDeducted = Math.min(depositRemaining, penaltyPaise);
    depositRemaining -= penaltyDeducted;

    const newStatus = normType === "FRAUD" ? "CLOSED" : vendor.status;

    const updatedVendor = await tx.vendor.update({
      where: { id: vendor.id },
      data: {
        securityDepositPaise: depositRemaining,
        status: newStatus,
        isDepositFrozen: depositRemaining < SECURITY_DEPOSIT_PAISE
      }
    });

    // 3. Write AuditLog
    await tx.auditLog.create({
      data: {
        actorId,
        actorType: "ADMIN",
        action: `VENDOR_PENALTY_${normType}`,
        entityType: "Vendor",
        entityId: vendor.id,
        metadata: {
          penaltyType: normType,
          penaltyPaise,
          memberCommissionsCovered,
          penaltyDeductedFromDeposit: penaltyDeducted,
          remainingDepositPaise: depositRemaining,
          newStatus
        }
      }
    });

    return {
      vendor: updatedVendor,
      penaltyType: normType,
      penaltyPaise,
      memberCommissionsCovered,
      penaltyDeducted,
      remainingDepositPaise: depositRemaining
    };
  });
}

module.exports = {
  getVolumeDiscountPct,
  calculateSettlementBreakdown,
  processWeeklySettlement,
  processEarlySettlement,
  sweepVendorInactivity,
  checkDepositFreeze,
  penalizeVendor,
  EARLY_SETTLEMENT_FEE_PAISE,
  SECURITY_DEPOSIT_PAISE,
  WALLET_MIN_BALANCE_PAISE
};