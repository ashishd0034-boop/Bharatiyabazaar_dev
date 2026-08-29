const path = require("path");
const dotenv = require("dotenv");

// Load appropriate env
const envFile = process.env.DOTENV_CONFIG_PATH || ".env";
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

const prisma = require("../src/lib/prisma");
const { logAction } = require("../src/services/auditService");

/**
 * Continuous Financial Reconciliation Script
 * Compares wallet.balancePaise with cumulative ledger entries for every wallet.
 * If any divergence is detected, logs error and writes an AuditLog entry.
 */
async function runReconciliation() {
  console.log("================================================================================");
  console.log("🔍 RUNNING PLATFORM-WIDE FINANCIAL LEDGER RECONCILIATION");
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log("================================================================================\n");

  const wallets = await prisma.wallet.findMany({
    include: {
      member: { select: { id: true, memberCode: true, name: true } },
      ledgerEntries: true
    }
  });

  let totalWalletsBalancePaise = 0;
  let totalCreditsPaise = 0;
  let totalDebitsPaise = 0;
  const divergences = [];

  for (const wallet of wallets) {
    totalWalletsBalancePaise += wallet.balancePaise;

    let credits = 0;
    let debits = 0;
    for (const entry of wallet.ledgerEntries) {
      if (entry.type === "CREDIT") credits += entry.amountPaise;
      else if (entry.type === "DEBIT") debits += entry.amountPaise;
    }

    totalCreditsPaise += credits;
    totalDebitsPaise += debits;
    const expectedBalance = credits - debits;
    const delta = wallet.balancePaise - expectedBalance;

    if (delta !== 0) {
      divergences.push({
        walletId: wallet.id,
        memberId: wallet.memberId,
        memberCode: wallet.member?.memberCode || wallet.memberId,
        memberName: wallet.member?.name || "N/A",
        actualBalancePaise: wallet.balancePaise,
        expectedBalancePaise: expectedBalance,
        deltaPaise: delta,
        totalCreditsPaise: credits,
        totalDebitsPaise: debits
      });
    }
  }

  const netLedgerBalancePaise = totalCreditsPaise - totalDebitsPaise;
  const variancePaise = Math.abs(totalWalletsBalancePaise - netLedgerBalancePaise);
  const isReconciled = variancePaise === 0 && divergences.length === 0;

  console.log(`Total Wallets Checked: ${wallets.length}`);
  console.log(`Total Balanced Wallets: ${wallets.length - divergences.length}`);
  console.log(`Total Divergent Wallets: ${divergences.length}`);
  console.log(`Total Wallets Balance: ₹${(totalWalletsBalancePaise / 100).toFixed(2)}`);
  console.log(`Total Ledger Credits: ₹${(totalCreditsPaise / 100).toFixed(2)}`);
  console.log(`Total Ledger Debits:  ₹${(totalDebitsPaise / 100).toFixed(2)}`);
  console.log(`Net Ledger Balance:   ₹${(netLedgerBalancePaise / 100).toFixed(2)}`);
  console.log(`System Variance:      ₹${(variancePaise / 100).toFixed(2)}`);

  if (!isReconciled) {
    console.error(`\n🚨 CRITICAL ALERT: LEDGER DIVERGENCE DETECTED IN ${divergences.length} WALLET(S)!`);
    for (const div of divergences) {
      console.error(`  - Member: ${div.memberCode} | Wallet: ${div.walletId} | Actual: ₹${div.actualBalancePaise / 100} | Expected: ₹${div.expectedBalancePaise / 100} | Δ: ₹${div.deltaPaise / 100}`);
    }

    // Write alert to AuditLog if superadmin exists
    try {
      const superAdmin = await prisma.adminUser.findFirst({ where: { role: "SUPER_ADMIN" } });
      if (superAdmin) {
        await logAction(superAdmin.id, "LEDGER_RECONCILIATION_ALERT", "SYSTEM", {
          divergencesCount: divergences.length,
          totalVariancePaise: variancePaise,
          divergences
        });
        console.log(`✓ Reconciliation failure logged to AuditLog.`);
      }
    } catch (auditErr) {
      console.error("Failed to write to AuditLog:", auditErr.message);
    }
  } else {
    console.log(`\n✅ RECONCILIATION PASS: All ${wallets.length} wallets in perfect parity with cumulative ledger entries (Δ = 0).`);
  }

  return {
    isReconciled,
    totalWalletsChecked: wallets.length,
    divergencesCount: divergences.length,
    variancePaise,
    divergences
  };
}

if (require.main === module) {
  runReconciliation()
    .then((res) => {
      prisma.$disconnect();
      if (!res.isReconciled) process.exit(1);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Reconciliation execution error:", err);
      prisma.$disconnect();
      process.exit(1);
    });
}

module.exports = { runReconciliation };
