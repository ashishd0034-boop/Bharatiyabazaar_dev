const cron = require("node-cron");
const prisma = require("../lib/prisma");
const acbService = require("../services/acbService");
const walletService = require("../services/walletService");
const settlementService = require("../services/settlementService");

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
      const current = await tx.commissionEntry.findUnique({ where: { id: commission.id } });
      if (current.status !== "PENDING_7_DAY") return;

      // Check if beneficiary ID card has ACB satisfied (REBIRTH is ACB-exempt; MAIN/SUB require own ACB)
      const isRebirth = commission.idCard.type === "REBIRTH";
      const hasAcb = isRebirth ? true : Boolean(commission.idCard.acbStatus);

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
    where: { type: { in: ["MAIN", "SUB"] }, acbStatus: false },
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

/**
 * Weekly Monday Settlement Sweep at 00:00 UTC/IST
 */
async function runMondaySettlement() {
  try {
    const result = await settlementService.processWeeklySettlement(new Date());
    console.log(`[JOB SUMMARY] Weekly Settlement: Processed ${result.totalEntries} vendor payouts, Total Net: Rs. ${(result.netPaise / 100).toFixed(2)}`);
    return result;
  } catch (error) {
    console.error("[JOB ERROR] Weekly Settlement Failed:", error);
    throw error;
  }
}

/**
 * Daily Inactivity Lifecycle Sweep at 02:00
 */
async function runDailyInactivitySweep() {
  try {
    const result = await settlementService.sweepVendorInactivity(new Date());
    console.log(`[JOB SUMMARY] Inactivity Sweep: Inactivated: ${result.inactivated}, Frozen: ${result.frozen}, Closed: ${result.closed}`);
    return result;
  } catch (error) {
    console.error("[JOB ERROR] Inactivity Sweep Failed:", error);
    throw error;
  }
}

// Register background cron jobs in production / development (disabled in test runs)
if (process.env.NODE_ENV !== "test") {
  // 1. Hourly 7-day and ACB Sweeps
  cron.schedule("0 * * * *", async () => {
    try {
      const holdProcessed = await run7DaySweep();
      const acbProcessed = await runAcbSweep();
      console.log(`[JOB SUMMARY] Hourly Sweep: Processed ${holdProcessed} 7-day holds, Unlocked ${acbProcessed} ACB statuses.`);
    } catch (error) {
      console.error("[JOB ERROR] Hourly Sweep Failed:", error);
    }
  });

  // 2. Weekly Monday Settlement at 00:00 ("0 0 * * MON")
  cron.schedule("0 0 * * MON", async () => {
    await runMondaySettlement().catch(() => {});
  });

  // 3. Daily Inactivity Lifecycle Sweep at 02:00 ("0 2 * * *")
  cron.schedule("0 2 * * *", async () => {
    await runDailyInactivitySweep().catch(() => {});
  });
}

module.exports = {
  run7DaySweep,
  runAcbSweep,
  runMondaySettlement,
  runDailyInactivitySweep
};
