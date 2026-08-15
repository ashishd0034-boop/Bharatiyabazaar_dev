const { requestWithdrawal } = require("../services/withdrawalService");
const prisma = require("../lib/prisma");

async function request(req, res, next) {
  try {
    const { idCardId, method, amountPaise } = req.body;
    
    // Verify idCard belongs to member
    const idCard = await prisma.memberIdCard.findFirst({
      where: { id: idCardId, memberId: req.member.id }
    });
    if (!idCard) {
      return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "ID Card does not belong to you or does not exist" } });
    }

    const withdrawal = await requestWithdrawal(req.member.id, idCardId, method, amountPaise);

    res.status(201).json({
      success: true,
      data: withdrawal
    });
  } catch (err) {
    next(err);
  }
}

async function getHistory(req, res, next) {
  try {
    const withdrawals = await prisma.withdrawal.findMany({
      where: { memberId: req.member.id },
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

async function getTdsPreview(req, res, next) {
  try {
    // This could just call a mock function or the TDS service directly
    // to preview how much TDS would be deducted for an amount.
    const { amountPaise } = req.query;
    if (!amountPaise) {
       return res.status(400).json({ success: false, error: { code: "BAD_REQUEST", message: "amountPaise query param required" } });
    }
    
    // For now, we simulate the calculation as done in requestWithdrawal
    // This usually requires fetching the dynamic rate.
    const platformSetting = await prisma.platformSetting.findUnique({ where: { key: "TDS_RATE_PCT" } });
    const dynamicRate = platformSetting ? parseFloat(platformSetting.value) : 5.0;

    const rate = req.member.kycStatus === "VERIFIED" ? dynamicRate : 20.0;
    const tdsPaise = Math.floor(parseInt(amountPaise) * (rate / 100));

    res.json({
      success: true,
      data: {
        amountPaise: parseInt(amountPaise),
        kycStatus: req.member.kycStatus,
        appliedRate: rate,
        estimatedTdsPaise: tdsPaise
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  request,
  getHistory,
  getTdsPreview
};
