const withdrawalService = require("./withdrawal.service");
const prisma = require("../../core/database/prisma");

async function request(req, res, next) {
  try {
    // Restrict withdrawals to MAIN card logins only
    if (req.loginContext && req.loginContext.isSubCard) {
      return res.status(403).json({
        success: false,
        error: {
          code: "FORBIDDEN_SUB_CARD",
          message: `Withdrawals can only be initiated when logged in as the MAIN ID (${req.member.memberCode}). You are currently logged in as ${req.loginContext.loginCardNumber} (${req.loginContext.loginCardType}).`
        }
      });
    }

    const { idCardId, method, amountPaise, paymentDetails, idempotencyKey } = req.body;

    // Default to member's MAIN ID card if idCardId is not specified
    let targetCardId = idCardId;
    if (!targetCardId) {
      const mainCard = await prisma.memberIdCard.findFirst({
        where: { memberId: req.member.id, type: "MAIN" }
      });
      if (!mainCard) {
        return res.status(400).json({
          success: false,
          error: { code: "NO_MAIN_CARD", message: "No MAIN ID card found for this member" }
        });
      }
      targetCardId = mainCard.id;
    }

    // Verify idCard belongs to member
    const idCard = await prisma.memberIdCard.findFirst({
      where: { id: targetCardId, memberId: req.member.id }
    });

    if (!idCard) {
      return res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: "ID Card does not belong to you or does not exist" }
      });
    }

    const withdrawal = await withdrawalService.requestWithdrawal(
      req.member.id,
      targetCardId,
      method || "BANK",
      parseInt(amountPaise),
      paymentDetails,
      idempotencyKey || req.headers["x-idempotency-key"] || null
    );

    res.status(201).json({
      success: true,
      data: withdrawal
    });
  } catch (err) {
    if (err.message.includes("Insufficient funds")) {
      return res.status(400).json({ success: false, error: { code: "INSUFFICIENT_FUNDS", message: err.message } });
    }
    if (err.message.includes("ACB status required")) {
      return res.status(400).json({ success: false, error: { code: "ACB_REQUIRED", message: err.message } });
    }
    if (err.message.includes("Minimum withdrawal")) {
      return res.status(400).json({ success: false, error: { code: "MIN_WITHDRAWAL_LIMIT", message: err.message } });
    }
    if (err.message.includes("Invalid withdrawal method")) {
      return res.status(400).json({ success: false, error: { code: "INVALID_METHOD", message: err.message } });
    }
    next(err);
  }
}

async function complete(req, res, next) {
  try {
    const withdrawalId = req.params.id || req.body.withdrawalId;
    if (!withdrawalId) {
      return res.status(400).json({ success: false, error: { code: "BAD_REQUEST", message: "withdrawalId required" } });
    }

    const completed = await withdrawalService.completeWithdrawal(withdrawalId, req.admin?.id);
    res.json({
      success: true,
      data: completed
    });
  } catch (err) {
    if (err.message.includes("not found")) {
      return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: err.message } });
    }
    if (err.message.includes("already processed")) {
      return res.status(400).json({ success: false, error: { code: "INVALID_STATUS_TRANSITION", message: err.message } });
    }
    next(err);
  }
}

async function reject(req, res, next) {
  try {
    const withdrawalId = req.params.id || req.body.withdrawalId;
    const reason = req.body.reason || "Rejected by admin";

    if (!withdrawalId) {
      return res.status(400).json({ success: false, error: { code: "BAD_REQUEST", message: "withdrawalId required" } });
    }

    const rejected = await withdrawalService.rejectWithdrawal(withdrawalId, reason, req.admin?.id);
    res.json({
      success: true,
      data: rejected
    });
  } catch (err) {
    if (err.message.includes("not found")) {
      return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: err.message } });
    }
    if (err.message.includes("already processed")) {
      return res.status(400).json({ success: false, error: { code: "INVALID_STATUS_TRANSITION", message: err.message } });
    }
    next(err);
  }
}

async function getHistory(req, res, next) {
  try {
    const withdrawals = await withdrawalService.getWithdrawalHistory(req.member.id);

    res.json({
      success: true,
      data: withdrawals
    });
  } catch (err) {
    next(err);
  }
}

async function getTdsPreview(req, res, next) {
  try {
    const { amountPaise, method } = req.query;
    if (!amountPaise || isNaN(parseInt(amountPaise))) {
      return res.status(400).json({
        success: false,
        error: { code: "BAD_REQUEST", message: "amountPaise query param required and must be an integer" }
      });
    }

    const memberId = req.member ? req.member.id : null;
    const preview = await withdrawalService.previewWithdrawal(memberId, method || "BANK", parseInt(amountPaise));

    res.json({
      success: true,
      data: preview
    });
  } catch (err) {
    next(err);
  }
}

async function getPending(req, res, next) {
  try {
    const withdrawals = await withdrawalService.getPendingWithdrawals(req.query);
    res.json({
      success: true,
      data: withdrawals
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  request,
  complete,
  reject,
  getHistory,
  getTdsPreview,
  getPending
};
