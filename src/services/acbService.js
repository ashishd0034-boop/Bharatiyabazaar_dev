const prisma = require("../lib/prisma");
const walletService = require("./walletService");

async function checkAcbStatus(tx, idCardId) {
  // Query nodes directly sponsored by this ID card (direct referrals)
  const sponsoredNodes = await tx.mySystemNode.findMany({
    where: { sponsorIdCardId: idCardId }
  });

  if (sponsoredNodes.length === 0) {
    return false;
  }

  const hasLeft = sponsoredNodes.some(n => n.side === "LEFT");
  const hasRight = sponsoredNodes.some(n => n.side === "RIGHT");

  return hasLeft && hasRight;
}

async function unlockAcb(tx, idCardId) {
  await tx.memberIdCard.update({
    where: { id: idCardId },
    data: {
      acbStatus: true,
      acbUnlockedAt: new Date()
    }
  });
}

async function unlockLockedEarnings(tx, idCardId) {
  // Find all locked commissions for this ID
  const lockedCommissions = await tx.commissionEntry.findMany({
    where: {
      idCardId,
      status: "LOCKED_ACB"
    }
  });

  if (lockedCommissions.length === 0) return;

  const idCard = await tx.memberIdCard.findUnique({ where: { id: idCardId }});

  for (const commission of lockedCommissions) {
    // 1. Update commission to WITHDRAWABLE
    await tx.commissionEntry.update({
      where: { id: commission.id },
      data: { status: "WITHDRAWABLE" }
    });

    // 2. Credit wallet
    await walletService.credit(tx, idCard.memberId, commission.amountPaise, commission.stream, commission.id, `ACB Unlocked ${commission.stream} Level ${commission.level}`);
  }
}

module.exports = {
  checkAcbStatus,
  unlockAcb,
  unlockLockedEarnings
};
