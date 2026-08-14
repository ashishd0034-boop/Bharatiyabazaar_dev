const prisma = require("../lib/prisma");
const walletService = require("./walletService");

async function checkAcbStatus(idCardId) {
  const mySystemNode = await prisma.mySystemNode.findUnique({
    where: { idCardId }
  });

  if (!mySystemNode) {
    return false;
  }

  const children = await prisma.mySystemNode.findMany({
    where: { parentNodeId: mySystemNode.id }
  });

  const hasLeft = children.some(c => c.side === "LEFT");
  const hasRight = children.some(c => c.side === "RIGHT");

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
