const { getWalletBalance, getLedgerHistory } = require("../services/walletService");
const prisma = require("../lib/prisma");

async function getBalance(req, res, next) {
  try {
    const wallet = await getWalletBalance(req.member.id);

    // Calculate per-card earnings & wallet bifurcation
    const idCards = await prisma.memberIdCard.findMany({
      where: { memberId: req.member.id },
      include: {
        commissionEntries: true
      },
      orderBy: { createdAt: "asc" }
    });

    const breakdown = idCards.map(c => {
      let withdrawablePaise = 0;
      let onHoldPaise = 0;
      let totalPaise = 0;

      (c.commissionEntries || []).forEach(comm => {
        totalPaise += comm.amountPaise;
        if (comm.status === "WITHDRAWABLE") {
          withdrawablePaise += comm.amountPaise;
        } else if (comm.status === "PENDING_7_DAY" || comm.status === "LOCKED_ACB") {
          onHoldPaise += comm.amountPaise;
        }
      });

      return {
        cardId: c.id,
        cardNumber: c.cardNumber,
        cardType: c.type,
        acbStatus: c.acbStatus,
        withdrawablePaise,
        onHoldPaise,
        totalPaise,
        isCurrentLogin: req.loginContext?.loginCardNumber === c.cardNumber
      };
    });

    const unifiedWalletBalancePaise = wallet.balancePaise || 0;
    const totalAllCardsEarningsPaise = breakdown.reduce((sum, b) => sum + b.totalPaise, 0);
    const totalAllCardsOnHoldPaise = breakdown.reduce((sum, b) => sum + b.onHoldPaise, 0);
    const totalWithdrawableFromCardsPaise = breakdown.reduce((sum, b) => sum + b.withdrawablePaise, 0);
    const memberLevelCreditsPaise = Math.max(0, unifiedWalletBalancePaise - totalWithdrawableFromCardsPaise);

    let filteredBreakdown = breakdown;
    let cardEarnings = null;
    let displayBalancePaise = unifiedWalletBalancePaise;
    let displayTotalEarningsPaise = totalAllCardsEarningsPaise;
    let displayOnHoldPaise = totalAllCardsOnHoldPaise;

    if (req.loginContext?.isSubCard) {
      const active = breakdown.find(b => b.cardNumber === req.loginContext.loginCardNumber) || breakdown[0];
      filteredBreakdown = active ? [active] : [];
      cardEarnings = active ? {
        cardTotalPaise: active.totalPaise,
        cardWithdrawablePaise: active.withdrawablePaise,
        cardOnHoldPaise: active.onHoldPaise,
        acbStatus: active.acbStatus,
        cardNumber: active.cardNumber,
        cardType: active.cardType
      } : null;

      displayBalancePaise = active ? active.withdrawablePaise : 0;
      displayTotalEarningsPaise = active ? active.totalPaise : 0;
      displayOnHoldPaise = active ? active.onHoldPaise : 0;
    }

    res.json({
      success: true,
      data: {
        ...wallet,
        displayBalancePaise,
        displayTotalEarningsPaise,
        displayOnHoldPaise,
        unifiedWalletBalancePaise,
        memberLevelCreditsPaise,
        loginContext: req.loginContext,
        cardEarnings,
        breakdown: filteredBreakdown
      }
    });
  } catch (err) {
    next(err);
  }
}

async function getLedger(req, res, next) {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    
    const history = await getLedgerHistory(req.member.id, limit, offset);
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
    const idCards = await prisma.memberIdCard.findMany({
      where: { memberId: req.member.id },
      select: { id: true, cardNumber: true, type: true }
    });
    const cardMap = {};
    idCards.forEach(c => { cardMap[c.id] = { cardNumber: c.cardNumber, cardType: c.type }; });

    const whereClause = req.loginContext?.isSubCard && req.loginContext?.loginCardId
      ? { idCardId: req.loginContext.loginCardId }
      : { idCardId: { in: idCards.map(i => i.id) } };

    const commissions = await prisma.commissionEntry.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      take: parseInt(req.query.limit) || 50
    });

    const enriched = commissions.map(c => ({
      ...c,
      cardNumber: cardMap[c.idCardId]?.cardNumber || null,
      cardType: cardMap[c.idCardId]?.cardType || null,
      isCurrentLogin: req.loginContext?.loginCardNumber === cardMap[c.idCardId]?.cardNumber
    }));

    res.json({
      success: true,
      data: enriched,
      loginContext: req.loginContext
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
        tdsPaise: 0, // Will be calculated later
        adminChargePaise: Math.round(amountPaise * 0.05), // 5% admin charge
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