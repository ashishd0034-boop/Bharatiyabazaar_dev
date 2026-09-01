const walletService = require("./wallet.service");
const prisma = require("../../core/database/prisma");

async function getBalance(req, res, next) {
  try {
    const data = await walletService.getWalletBalance(req.member.id, req.loginContext);
    res.json({
      success: true,
      data
    });
  } catch (err) {
    next(err);
  }
}

async function getLedger(req, res, next) {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const history = await walletService.getLedgerHistory(req.member.id, limit, offset);
    res.json({
      success: true,
      data: history
    });
  } catch (err) {
    next(err);
  }
}

async function getCommissions(req, res, next) {
  try {
    const result = await walletService.getCommissions(req.member.id, req.loginContext, req.query.limit);
    res.json({
      success: true,
      data: result.commissions,
      totalCount: result.totalCount,
      loginContext: result.loginContext
    });
  } catch (err) {
    next(err);
  }
}

async function requestWithdrawal(req, res, next) {
  try {
    // 🛡️ SECURITY GUARD: Restrict withdrawals to MAIN card logins only
    if (req.loginContext && req.loginContext.isSubCard) {
      return res.status(403).json({
        success: false,
        error: {
          code: "FORBIDDEN_SUB_CARD",
          message: `Withdrawals can only be initiated when logged in as the MAIN ID (${req.member.memberCode}). You are currently logged in as ${req.loginContext.loginCardNumber} (${req.loginContext.loginCardType}).`
        }
      });
    }

    const { amountPaise, method, bankDetails } = req.body;
    const memberId = req.member.id;

    // Validate minimum withdrawal (Rs.100 = 10000 paise)
    if (amountPaise < 10000) {
      return res.status(400).json({
        success: false,
        error: { message: "Minimum withdrawal is Rs.100" }
      });
    }

    // Check if member has a MAIN ID card with ACB status
    const mainCard = await prisma.memberIdCard.findFirst({
      where: { memberId, type: "MAIN" }
    });

    if (!mainCard) {
      return res.status(400).json({
        success: false,
        error: { message: "No MAIN ID card found" }
      });
    }

    if (!mainCard.acbStatus) {
      return res.status(400).json({
        success: false,
        error: { message: "ACB status required for withdrawals. Achieve 1 LEFT + 1 RIGHT direct referral." }
      });
    }

    // Create withdrawal request
    const withdrawal = await prisma.withdrawal.create({
      data: {
        memberId,
        idCardId: mainCard.id,
        method: method || "BANK",
        grossPaise: amountPaise,
        tdsPaise: 0,
        adminChargePaise: Math.round(amountPaise * 0.05),
        netPaise: Math.round(amountPaise * 0.95),
        status: "REQUESTED",
        paymentDetails: bankDetails ? JSON.stringify(bankDetails) : null
      }
    });

    res.json({
      success: true,
      data: withdrawal
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getBalance,
  getLedger,
  getCommissions,
  requestWithdrawal
};
