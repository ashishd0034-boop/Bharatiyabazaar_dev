const cron = require("node-cron");
const prisma = require("../lib/prisma");
const acbService = require("../services/acbService");
const walletService = require("../services/walletService");

async function run7DaySweep() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  let processed = 0;
  
  const pendingCommissions = await prisma.commissionEntry.findMany({
    where: {
      status: "PENDING_7_DAY",
      createdAt: { lte: sevenDaysAgo }
    },
    include: { idCard: true }
  });

  for (const commission of pendingCommissions) {
    await prisma.$transaction(async (tx) => {
      // Idempotency check inside transaction
      const current = await tx.commissionEntry.findUnique({ where: { id: commission.id }});
      if (current.status !== "PENDING_7_DAY") return;

      // Check if source card owner has ACB
      let hasAcb = false;
      const ownerMainCard = await tx.memberIdCard.findFirst({
        where: { memberId: commission.idCard.memberId, type: "MAIN" }
      });
      if (ownerMainCard && ownerMainCard.acbStatus) {
        hasAcb = true;
      }

      if (hasAcb) {
        await tx.commissionEntry.update({
          where: { id: commission.id },
          data: { status: "WITHDRAWABLE" }
        });
        
        await walletService.credit(tx, commission.idCard.memberId, commission.amountPaise, commission.stream, commission.id, `7-day hold released for ${commission.stream} Level ${commission.level}`);
      } else {
        await tx.commissionEntry.update({
          where: { id: commission.id },
          data: { status: "LOCKED_ACB" }
        });
      }
      processed++;
    });
  }
  return processed;
}

async function runAcbSweep() {
  let processed = 0;
  const cards = await prisma.memberIdCard.findMany({
    where: { acbStatus: false },
    include: { sponsoredNodes: true }
  });

  await prisma.$transaction(async (tx) => {
    for (const card of cards) {
      const qualifies = await acbService.checkAcbStatus(tx, card.id);
      if (qualifies) {
        await acbService.unlockAcb(tx, card.id);
        await acbService.unlockLockedEarnings(tx, card.id);
        processed++;
      }
    }
  });
  return processed;
}

cron.schedule("0 * * * *", async () => {
  try {
    const holdProcessed = await run7DaySweep();
    const acbProcessed = await runAcbSweep();
    console.log(`[JOB SUMMARY] Hourly Sweep: Processed ${holdProcessed} 7-day holds, Unlocked ${acbProcessed} ACB statuses.`);
  } catch (error) {
    console.error("[JOB ERROR] Hourly Sweep Failed:", error);
  }
});

module.exports = {
  run7DaySweep,
  runAcbSweep
};
