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
 * Platform-wide Financial Wallet & Ledger Reconciliation Report (Per-Wallet & System-Wide)
 */
async function getReconciliationReport(req, res, next) {
  try {
    const wallets = await prisma.wallet.findMany({
      include: {
        member: { select: { id: true, memberCode: true, name: true } },
        ledgerEntries: true
      }
    });

    let totalWalletsBalancePaise = 0;
    let totalCreditsPaise = 0;
    let totalDebitsPaise = 0;
    const divergences = [];

    for (const wallet of wallets) {
      totalWalletsBalancePaise += wallet.balancePaise;

      let credits = 0;
      let debits = 0;
      for (const entry of wallet.ledgerEntries) {
        if (entry.type === "CREDIT") credits += entry.amountPaise;
        else if (entry.type === "DEBIT") debits += entry.amountPaise;
      }

      totalCreditsPaise += credits;
      totalDebitsPaise += debits;
      const expectedBalance = credits - debits;
      const delta = wallet.balancePaise - expectedBalance;

      if (delta !== 0) {
        divergences.push({
          walletId: wallet.id,
          memberId: wallet.memberId,
          memberCode: wallet.member?.memberCode || wallet.memberId,
          memberName: wallet.member?.name || "N/A",
          actualBalancePaise: wallet.balancePaise,
          expectedBalancePaise: expectedBalance,
          deltaPaise: delta,
          totalCreditsPaise: credits,
          totalDebitsPaise: debits
        });
      }
    }

    const netLedgerBalancePaise = totalCreditsPaise - totalDebitsPaise;
    const variancePaise = Math.abs(totalWalletsBalancePaise - netLedgerBalancePaise);
    const isReconciled = variancePaise === 0 && divergences.length === 0;

    res.json({
      success: true,
      data: {
        totalWalletsChecked: wallets.length,
        totalBalancedWallets: wallets.length - divergences.length,
        totalDivergentWallets: divergences.length,
        totalWalletsBalancePaise,
        totalCreditsPaise,
        totalDebitsPaise,
        netLedgerBalancePaise,
        variancePaise,
        isReconciled,
        divergences,
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

/**
 * List all activation PINs (ADMIN & SUPER_ADMIN)
 */
async function listPinsReq(req, res, next) {
  try {
    const pinService = require("../services/pinService");
    const { status, source, purchaserCode, memberCode, purchasedByMemberId, redeemedByMemberId, limit, offset } = req.query;
    const pins = await pinService.listPins({
      status,
      source,
      purchaserCode: purchaserCode || memberCode,
      purchasedByMemberId,
      redeemedByMemberId,
      limit: limit ? parseInt(limit, 10) : 100,
      offset: offset ? parseInt(offset, 10) : 0
    });

    res.json({
      success: true,
      data: pins
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Revoke an unredeemed PIN (ADMIN & SUPER_ADMIN)
 */
async function revokePinReq(req, res, next) {
  try {
    const pinService = require("../services/pinService");
    const { id } = req.params;
    const { reason } = req.body || {};
    const adminId = req.admin.id;

    const revoked = await pinService.revokePin(id, adminId, reason);

    res.json({
      success: true,
      message: "PIN successfully revoked.",
      data: revoked
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Direct Administrative PIN Generation (SUPER_ADMIN only)
 */
async function generateAdminPinsReq(req, res, next) {
  try {
    const pinService = require("../services/pinService");
    const { count = 1, quantity = 1, reason } = req.body;
    const adminId = req.admin.id;
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;

    const result = await pinService.adminGeneratePins(adminId, count, quantity, reason, ipAddress);

    res.status(201).json({
      success: true,
      message: `Successfully generated ${result.totalGenerated} admin activation PIN(s).`,
      data: {
        pins: result.pins,
        totalGenerated: result.totalGenerated,
        issuedByAdmin: req.admin.email,
        reason: result.reason
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * List Members with IdCards & Wallets
 */
async function listMembersReq(req, res, next) {
  try {
    const { search, status, kycStatus, limit = 50, offset = 0 } = req.query;
    const where = {};
    if (status) where.status = status;
    if (kycStatus) where.kycStatus = kycStatus;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { memberCode: { contains: search, mode: "insensitive" } },
        { mobile: { contains: search } }
      ];
    }
    const members = await prisma.member.findMany({
      where,
      include: {
        idCards: true,
        mainWallet: true
      },
      orderBy: { createdAt: "desc" },
      take: parseInt(limit, 10),
      skip: parseInt(offset, 10)
    });
    const total = await prisma.member.count({ where });

    // Defense-in-depth: Never expose passwordHash in member list
    const sanitizedMembers = members.map(m => {
      const { passwordHash, ...rest } = m;
      return rest;
    });

    res.json({ success: true, data: { members: sanitizedMembers, total } });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin Member Password Reset (ADMIN & SUPER_ADMIN)
 */
async function resetMemberPasswordReq(req, res, next) {
  try {
    const adminService = require("../services/adminService");
    const { id } = req.params;
    const adminId = req.admin.id;
    const adminEmail = req.admin.email;
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;

    const result = await adminService.resetMemberPassword(adminId, adminEmail, id, ipAddress);

    res.json({
      success: true,
      message: `Temporary password generated successfully for member ${result.memberCode}.`,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * List Vendors with Sales & Settlements
 */
async function listVendorsReq(req, res, next) {
  try {
    const { search, status } = req.query;
    const where = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { storeName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } }
      ];
    }
    const vendors = await prisma.vendor.findMany({
      where,
      include: {
        sales: { orderBy: { createdAt: "desc" }, take: 5 },
        settlements: { orderBy: { createdAt: "desc" }, take: 5 }
      },
      orderBy: { createdAt: "desc" }
    });
    res.json({ success: true, data: vendors });
  } catch (err) {
    next(err);
  }
}

/**
 * Send System Notification Broadcast
 */
async function broadcastNotificationReq(req, res, next) {
  try {
    const { title, message, type = "SYSTEM", targetMemberId } = req.body;
    if (!title || !message) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Title and message are required." } });
    }
    let count = 0;
    if (targetMemberId) {
      await prisma.notification.create({
        data: {
          memberId: targetMemberId,
          title,
          message,
          type,
          status: "UNREAD"
        }
      });
      count = 1;
    } else {
      const members = await prisma.member.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
      const notificationsData = members.map(m => ({
        memberId: m.id,
        title,
        message,
        type,
        status: "UNREAD"
      }));
      if (notificationsData.length > 0) {
        const result = await prisma.notification.createMany({ data: notificationsData });
        count = result.count;
      }
    }
    await prisma.auditLog.create({
      data: {
        actorId: req.admin.id,
        actorType: "ADMIN",
        action: "BROADCAST_SENT",
        entityType: "Notification",
        entityId: "BROADCAST",
        metadata: { title, targetMemberId: targetMemberId || "ALL_ACTIVE", recipientsCount: count }
      }
    });
    res.json({ success: true, message: `Notification delivered to ${count} recipient(s).`, count });
  } catch (err) {
    next(err);
  }
}

/**
 * KYC Review & Document Queue
 */
async function listKycReq(req, res, next) {
  try {
    const { status } = req.query;
    const where = status ? { kycStatus: status } : {};
    const members = await prisma.member.findMany({
      where,
      select: {
        id: true,
        memberCode: true,
        name: true,
        mobile: true,
        panNumber: true,
        panVerified: true,
        kycTier: true,
        kycStatus: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: { updatedAt: "desc" },
      take: 100
    });
    res.json({ success: true, data: members });
  } catch (err) {
    next(err);
  }
}

async function verifyKycReq(req, res, next) {
  try {
    const { id } = req.params;
    const { approved, panNumber } = req.body;
    const member = await prisma.member.findUnique({ where: { id } });
    if (!member) {
      return res.status(404).json({ success: false, error: { message: "Member not found" } });
    }
    const updated = await prisma.member.update({
      where: { id },
      data: {
        kycStatus: approved ? "APPROVED" : "REJECTED",
        panVerified: approved ? true : false,
        panNumber: panNumber || member.panNumber,
        kycTier: approved ? "TIER_2" : member.kycTier
      }
    });
    await prisma.auditLog.create({
      data: {
        actorId: req.admin.id,
        actorType: "ADMIN",
        action: approved ? "KYC_APPROVED" : "KYC_REJECTED",
        entityType: "Member",
        entityId: id,
        metadata: { memberCode: member.memberCode, panNumber: updated.panNumber }
      }
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * AutoPool Live Tree Data
 */
async function getAutoPoolTreeReq(req, res, next) {
  try {
    const nodes = await prisma.autoPoolNode.findMany({
      include: {
        idCard: {
          include: {
            member: {
              select: { id: true, name: true, memberCode: true }
            }
          }
        }
      },
      orderBy: { globalPosition: "asc" },
      take: 200
    });
    res.json({ success: true, data: nodes });
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
  updateAdminUserRole,
  listPinsReq,
  revokePinReq,
  generateAdminPinsReq,
  listMembersReq,
  resetMemberPasswordReq,
  listVendorsReq,
  broadcastNotificationReq,
  listKycReq,
  verifyKycReq,
  getAutoPoolTreeReq
};

