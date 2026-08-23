const { getSettings, updateSetting } = require("../services/adminService");
const { completeWithdrawal, rejectWithdrawal } = require("../services/withdrawalService");
const { getAuditLogs } = require("../services/auditService");
const { processWeeklySettlement, penalizeVendor, checkDepositFreeze } = require("../services/settlementService");
const prisma = require("../lib/prisma");

async function getAllSettings(req, res, next) {
  try {
    const settings = await getSettings();
    res.json({
      success: true,
      data: settings
    });
  } catch (err) {
    next(err);
  }
}

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

async function getLogs(req, res, next) {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const logs = await getAuditLogs({}, limit);
    res.json({
      success: true,
      data: logs
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAllSettings,
  updateSettingValue,
  approveWithdrawalReq,
  rejectWithdrawalReq,
  runSettlement,
  penalizeVendorReq,
  freezeVendorReq,
  getLogs
};
