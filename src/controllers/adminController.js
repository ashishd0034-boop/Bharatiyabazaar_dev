const { getAllSettings, getSetting, updateSetting, updateCategoryMargin } = require("../services/adminService");
const { completeWithdrawal, rejectWithdrawal } = require("../services/withdrawalService");
const { getAuditLogs } = require("../services/auditService");
const { processWeeklySettlement, penalizeVendor } = require("../services/settlementService");
const prisma = require("../lib/prisma");
const bcrypt = require("bcrypt");

/**
 * List all Platform Settings
 */
async function listSettings(req, res, next) {
  try {
    const settings = await getAllSettings();
    res.json({
      success: true,
      data: settings
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get Single Setting
 */
async function getSingleSetting(req, res, next) {
  try {
    const { key } = req.params;
    const value = await getSetting(key, null);
    if (value === null) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: `Setting ${key} not found` }
      });
    }
    res.json({
      success: true,
      data: { key, value }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Update Setting Value
 */
async function updateSettingValue(req, res, next) {
  try {
    const { key } = req.params;
    const { value, description } = req.body;
    const setting = await updateSetting(key, value, req.admin.id, description);
    res.json({
      success: true,
      data: setting
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Update Category Margin with applyToExisting toggle
 */
async function updateCategoryMarginReq(req, res, next) {
  try {
    const { category } = req.params;
    const { marginRatePct, applyToExisting = false, description } = req.body;
    const result = await updateCategoryMargin(category, marginRatePct, applyToExisting, req.admin.id, description);
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Approve Withdrawal Request (Operational decision by ADMIN or SUPER_ADMIN)
 */
async function approveWithdrawalReq(req, res, next) {
  try {
    const { id } = req.params;
    const withdrawal = await completeWithdrawal(id, req.admin.id);
    res.json({
      success: true,
      data: withdrawal
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Reject Withdrawal Request (Operational decision by ADMIN or SUPER_ADMIN)
 */
async function rejectWithdrawalReq(req, res, next) {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const withdrawal = await rejectWithdrawal(id, reason, req.admin.id);
    res.json({
      success: true,
      data: withdrawal
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Run Weekly/On-demand Settlement
 */
async function runSettlement(req, res, next) {
  try {
    const runDate = req.body.runDate ? new Date(req.body.runDate) : new Date();
    const result = await processWeeklySettlement(runDate, {
      adminRatePctOverride: req.body.adminRatePctOverride ? parseFloat(req.body.adminRatePctOverride) : null,
      actorId: req.admin.id
    });
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Penalize Vendor for Fraud / Violation
 */
async function penalizeVendorReq(req, res, next) {
  try {
    const { id } = req.params;
    const { penaltyType, transactionAmountPaise } = req.body;
    const result = await penalizeVendor(id, penaltyType, parseInt(transactionAmountPaise) || 0, req.admin.id);
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Freeze / Unfreeze Vendor Account
 */
async function freezeVendorReq(req, res, next) {
  try {
    const { id } = req.params;
    const { freeze = true } = req.body;
    const vendor = await prisma.vendor.update({
      where: { id },
      data: {
        isDepositFrozen: freeze,
        status: freeze ? "FROZEN" : "ACTIVE"
      }
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.admin.id,
        actorType: "ADMIN",
        action: freeze ? "VENDOR_MANUAL_FREEZE" : "VENDOR_MANUAL_UNFREEZE",
        entityType: "Vendor",
        entityId: id,
        metadata: { status: vendor.status, isDepositFrozen: vendor.isDepositFrozen }
      }
    });

    res.json({
      success: true,
      data: vendor
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get Audit Logs (SUPER_ADMIN only)
 */
async function getLogs(req, res, next) {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const logs = await getAuditLogs({}, limit);
    res.json({
      success: true,
      data: logs
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Platform-wide Dashboard Summary Metrics
 */
async function getDashboardStats(req, res, next) {
  try {
    const [
      totalMembers,
      totalIdCards,
      autopoolGlobalCount,
      activeVendors,
      pendingWithdrawals,
      pending194RAgg,
      recentLogs
    ] = await Promise.all([
      prisma.member.count(),
      prisma.memberIdCard.count(),
      prisma.autoPoolNode.count(),
      prisma.vendor.count({
        where: { status: { in: ["ACTIVE", "VERIFIED"] } }
      }),
      prisma.withdrawal.findMany({
        where: { status: "REQUESTED" },
        select: { grossPaise: true }
      }),
      prisma.tdsLedger.aggregate({
        where: { section: "194R", status: { in: ["HELD", "PENDING"] } },
        _sum: { amountPaise: true }
      }),
      prisma.auditLog.findMany({
        take: 10,
        orderBy: { createdAt: "desc" }
      })
    ]);

    const pendingWithdrawalsCount = pendingWithdrawals.length;
    const pendingWithdrawalsAmountPaise = pendingWithdrawals.reduce((sum, w) => sum + w.grossPaise, 0);
    const pending194RPaise = pending194RAgg._sum.amountPaise || 0;

    res.json({
      success: true,
      data: {
        totalMembers,
        totalIdCards,
        autopoolGlobalPosition: autopoolGlobalCount,
        activeVendors,
        pendingWithdrawalsCount,
        pendingWithdrawalsAmountPaise,
        pending194RPaise,
        recentLogs
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Platform-wide Financial Wallet & Ledger Reconciliation Report
 */
async function getReconciliationReport(req, res, next) {
  try {
    const [walletAgg, heldCommissionsAgg, ledgerCredits, ledgerDebits] = await Promise.all([
      prisma.wallet.aggregate({
        _sum: { balancePaise: true }
      }),
      prisma.commissionEntry.aggregate({
        where: { status: "HELD" },
        _sum: { amountPaise: true }
      }),
      prisma.ledgerEntry.aggregate({
        where: { type: "CREDIT" },
        _sum: { amountPaise: true }
      }),
      prisma.ledgerEntry.aggregate({
        where: { type: "DEBIT" },
        _sum: { amountPaise: true }
      })
    ]);

    const totalWalletsBalancePaise = walletAgg._sum.balancePaise || 0;
    const totalWalletsOnHoldPaise = heldCommissionsAgg._sum.amountPaise || 0;
    const totalWalletLiabilitiesPaise = totalWalletsBalancePaise;

    const totalCreditsPaise = ledgerCredits._sum.amountPaise || 0;
    const totalDebitsPaise = ledgerDebits._sum.amountPaise || 0;
    const netLedgerBalancePaise = totalCreditsPaise - totalDebitsPaise;

    const variancePaise = Math.abs(totalWalletLiabilitiesPaise - netLedgerBalancePaise);
    const isReconciled = variancePaise === 0;

    res.json({
      success: true,
      data: {
        totalWalletsBalancePaise,
        totalWalletsOnHoldPaise,
        totalWalletLiabilitiesPaise,
        totalCreditsPaise,
        totalDebitsPaise,
        netLedgerBalancePaise,
        variancePaise,
        isReconciled,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Pending Withdrawals Queue Report (status === "REQUESTED")
 */
async function getPendingWithdrawalsReport(req, res, next) {
  try {
    const withdrawals = await prisma.withdrawal.findMany({
      where: { status: "REQUESTED" },
      include: {
        member: {
          select: {
            id: true,
            name: true,
            mobile: true,
            memberCode: true,
            kycStatus: true,
            panNumber: true
          }
        },
        idCard: {
          select: {
            id: true,
            cardNumber: true,
            type: true
          }
        }
      },
      orderBy: { requestedAt: "desc" }
    });

    res.json({
      success: true,
      data: withdrawals
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Aggregate TDS Compliance Summary Report
 */
async function getTdsSummaryReport(req, res, next) {
  try {
    const records = await prisma.tdsLedger.groupBy({
      by: ["section", "status"],
      _sum: { amountPaise: true },
      _count: { id: true }
    });

    const summary = {
      "194H": { HELD: 0, DEPOSITED: 0, REVERSED: 0, total: 0 },
      "194R": { HELD: 0, DEPOSITED: 0, REVERSED: 0, total: 0 },
      "194C": { HELD: 0, DEPOSITED: 0, REVERSED: 0, total: 0 }
    };

    records.forEach(r => {
      const sec = r.section;
      const st = r.status;
      const amt = r._sum.amountPaise || 0;
      if (summary[sec]) {
        summary[sec][st] = (summary[sec][st] || 0) + amt;
        if (st === "HELD" || st === "DEPOSITED") {
          summary[sec].total += amt;
        }
      }
    });

    res.json({
      success: true,
      data: summary
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Historical Vendor Settlements Report across all vendors
 */
async function getSettlementsReport(req, res, next) {
  try {
    const settlements = await prisma.vendorSettlement.findMany({
      include: {
        vendor: {
          select: {
            id: true,
            businessName: true,
            category: true,
            marginRatePct: true
          }
        }
      },
      orderBy: { periodStart: "desc" },
      take: 100
    });

    res.json({
      success: true,
      data: settlements
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin User Management: List Users (SUPER_ADMIN only)
 */
async function listAdminUsers(req, res, next) {
  try {
    const admins = await prisma.adminUser.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        createdAt: true
      },
      orderBy: { createdAt: "desc" }
    });

    res.json({
      success: true,
      data: admins
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin User Management: Create Admin User (SUPER_ADMIN only)
 */
async function createAdminUser(req, res, next) {
  try {
    const { email, name, password, role = "ADMIN" } = req.body;
    const existing = await prisma.adminUser.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({
        success: false,
        error: { code: "ALREADY_EXISTS", message: `Admin with email ${email} already exists` }
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newAdmin = await prisma.adminUser.create({
      data: {
        email: email.trim().toLowerCase(),
        name: name.trim(),
        passwordHash,
        role: role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN",
        status: "ACTIVE"
      },
      select: { id: true, email: true, name: true, role: true, status: true, createdAt: true }
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.admin.id,
        actorType: "ADMIN",
        action: "ADMIN_USER_CREATE",
        entityType: "AdminUser",
        entityId: newAdmin.id,
        metadata: { email: newAdmin.email, role: newAdmin.role }
      }
    });

    res.status(201).json({
      success: true,
      data: newAdmin
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin User Management: Change Role (SUPER_ADMIN only)
 */
async function updateAdminUserRole(req, res, next) {
  try {
    const { id } = req.params;
    const { role } = req.body;

    const targetAdmin = await prisma.adminUser.findUnique({ where: { id } });
    if (!targetAdmin) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Admin user not found" }
      });
    }

    const updated = await prisma.adminUser.update({
      where: { id },
      data: { role: role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN" },
      select: { id: true, email: true, name: true, role: true, status: true, updatedAt: true }
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.admin.id,
        actorType: "ADMIN",
        action: "ADMIN_USER_ROLE_CHANGE",
        entityType: "AdminUser",
        entityId: id,
        metadata: { beforeRole: targetAdmin.role, afterRole: updated.role }
      }
    });

    res.json({
      success: true,
      data: updated
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listSettings,
  getSingleSetting,
  updateSettingValue,
  updateCategoryMarginReq,
  approveWithdrawalReq,
  rejectWithdrawalReq,
  runSettlement,
  penalizeVendorReq,
  freezeVendorReq,
  getLogs,
  getDashboardStats,
  getReconciliationReport,
  getPendingWithdrawalsReport,
  getTdsSummaryReport,
  getSettlementsReport,
  listAdminUsers,
  createAdminUser,
  updateAdminUserRole
};
