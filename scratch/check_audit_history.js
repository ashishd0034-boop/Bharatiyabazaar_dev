const prisma = require("../src/lib/prisma");

async function checkAuditAndHistory() {
  console.log("=== CHECKING AUDIT LOGS AND DB MODIFICATIONS ===");

  const auditLogs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 30
  });

  console.log("Audit Logs count:", auditLogs.length);
  for (const log of auditLogs) {
    console.log(`- [${log.createdAt.toISOString()}] Admin ${log.adminId} Action: ${log.action} Target: ${log.targetId} Details:`, log.details);
  }

  // Check all ledger entries in whole DB around 2026-08-28T08:00 to 08:35
  const ledgers = await prisma.ledgerEntry.findMany({
    where: {
      createdAt: {
        gte: new Date("2026-08-28T07:00:00.000Z"),
        lte: new Date("2026-08-28T09:00:00.000Z")
      }
    },
    orderBy: { createdAt: "asc" },
    include: {
      wallet: {
        include: {
          member: true
        }
      }
    }
  });

  console.log("\nLedger entries around PIN creation period (2026-08-28):", ledgers.length);
  for (const l of ledgers) {
    console.log(`[${l.createdAt.toISOString()}] Member: ${l.wallet.member.memberCode} | Type: ${l.type} | Amount: ₹${l.amountPaise / 100} | Source: ${l.source} | Before: ₹${l.balanceBeforePaise / 100} | After: ₹${l.balanceAfterPaise / 100} | Desc: ${l.description}`);
  }

  await prisma.$disconnect();
}

checkAuditAndHistory().catch(console.error);
