const prisma = require("../lib/prisma");

async function checkAcbStatus(idCardId) {
  // Find the MY SYSTEM node for this ID
  const mySystemNode = await prisma.mySystemNode.findUnique({
    where: { idCardId }
  });

  if (!mySystemNode) {
    return false;
  }

  // Find direct children
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
  await tx.commissionEntry.updateMany({
    where: {
      idCardId,
      status: "LOCKED_ACB"
    },
    data: {
      status: "CONFIRMED"
    }
  });
}

module.exports = {
  checkAcbStatus,
  unlockAcb,
  unlockLockedEarnings
};
