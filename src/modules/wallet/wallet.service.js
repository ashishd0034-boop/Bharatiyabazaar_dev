const prisma = require("../../core/database/prisma");
const coreWalletService = require("../../core/services/wallet.service");

/**
 * Returns unified wallet balance and per-card earnings bifurcation for a member.
 */
async function getWalletBalance(memberId, loginContext = null) {
  const wallet = await coreWalletService.getWalletBalance(memberId);

  // Calculate per-card earnings & wallet bifurcation
  const idCards = await prisma.memberIdCard.findMany({
    where: { memberId },
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
      isCurrentLogin: loginContext?.loginCardNumber === c.cardNumber
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

  if (loginContext?.isSubCard) {
    const active = breakdown.find(b => b.cardNumber === loginContext.loginCardNumber) || breakdown[0];
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

  return {
    ...wallet,
    displayBalancePaise,
    displayTotalEarningsPaise,
    displayOnHoldPaise,
    unifiedWalletBalancePaise,
    memberLevelCreditsPaise,
    loginContext,
    cardEarnings,
    breakdown: filteredBreakdown
  };
}

/**
 * Returns structured, double-entry ledger history for a member.
 */
async function getLedgerHistory(memberId, limit = 50, offset = 0) {
  return await coreWalletService.getLedgerHistory(memberId, limit, offset);
}

/**
 * Returns commission entries scoped to member cards or active login card.
 */
async function getCommissions(memberId, loginContext = null, limit = 50) {
  const idCards = await prisma.memberIdCard.findMany({
    where: { memberId },
    select: { id: true, cardNumber: true, type: true }
  });
  const cardMap = {};
  idCards.forEach(c => { cardMap[c.id] = { cardNumber: c.cardNumber, cardType: c.type }; });

  const whereClause = loginContext?.isSubCard && loginContext?.loginCardId
    ? { idCardId: loginContext.loginCardId }
    : { idCardId: { in: idCards.map(i => i.id) } };

  const commissions = await prisma.commissionEntry.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    take: parseInt(limit) || 50
  });

  const enriched = commissions.map(c => ({
    ...c,
    cardNumber: cardMap[c.idCardId]?.cardNumber || null,
    cardType: cardMap[c.idCardId]?.cardType || null,
    isCurrentLogin: loginContext?.loginCardNumber === cardMap[c.idCardId]?.cardNumber
  }));

  return {
    commissions: enriched,
    loginContext
  };
}

module.exports = {
  getWalletBalance,
  getLedgerHistory,
  getCommissions
};
