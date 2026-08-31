const prisma = require("../database/prisma");
const walletService = require("./wallet.service");

async function checkAcbStatus(tx, idCardId) {
  const db = tx || prisma;
  const card = await db.memberIdCard.findUnique({
    where: { id: idCardId },
    select: { type: true }
  });
  if (!card || card.type === "REBIRTH") {
    return false; // REBIRTH cards are ACB-exempt and never maintain acbStatus
  }

  // Query nodes directly sponsored by this ID card (direct referrals)
  const sponsoredNodes = await db.mySystemNode.findMany({
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
  const db = tx || prisma;
  const card = await db.memberIdCard.findUnique({
    where: { id: idCardId },
    select: { type: true }
  });
  if (!card || card.type === "REBIRTH") return;

  await db.memberIdCard.update({
    where: { id: idCardId },
    data: {
      acbStatus: true,
      acbUnlockedAt: new Date()
    }
  });
}

async function unlockLockedEarnings(tx, idCardId) {
  const db = tx || prisma;
  // Find all locked commissions for this ID
  const lockedCommissions = await db.commissionEntry.findMany({
    where: {
      idCardId,
      status: "LOCKED_ACB"
    }
  });

  if (lockedCommissions.length === 0) return;

  const idCard = await db.memberIdCard.findUnique({ where: { id: idCardId }});

  for (const commission of lockedCommissions) {
    // 1. Update commission to WITHDRAWABLE
    await db.commissionEntry.update({
      where: { id: commission.id },
      data: { status: "WITHDRAWABLE" }
    });

    // 2. Credit wallet
    await walletService.credit(db, idCard.memberId, commission.amountPaise, commission.stream, commission.id, `ACB Unlocked ${commission.stream} Level ${commission.level}`);
  }
}

module.exports = {
  checkAcbStatus,
  unlockAcb,
  unlockLockedEarnings
};
