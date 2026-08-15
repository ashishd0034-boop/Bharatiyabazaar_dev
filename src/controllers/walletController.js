const { getWalletBalance, getLedgerHistory } = require("../services/walletService");
const prisma = require("../lib/prisma");

async function getBalance(req, res, next) {
  try {
    const wallet = await getWalletBalance(req.member.id);
    res.json({
      success: true,
      data: wallet
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
      select: { id: true }
    });
    const idCardIds = idCards.map(i => i.id);

    const commissions = await prisma.commissionEntry.findMany({
      where: { idCardId: { in: idCardIds } },
      orderBy: { createdAt: "desc" },
      take: parseInt(req.query.limit) || 50
    });

    res.json({
      success: true,
      data: commissions
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getBalance,
  getLedger,
  getCommissions
};
