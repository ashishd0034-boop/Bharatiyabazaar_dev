const { getSettings, updateSetting } = require("../services/adminService");
const { completeWithdrawal, rejectWithdrawal } = require("../services/withdrawalService");
const { getAuditLogs } = require("../services/auditService");
const { processWeeklySettlement } = require("../services/settlementService");

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
    const result = await processWeeklySettlement();
    res.json({
      success: true,
      data: result
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
  getLogs
};
