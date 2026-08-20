const prisma = require("/Users/ashishdubey/Desktop/coder/Bharatiya Bazaar/qewn/bb-backend/src/lib/prisma");

async function runHealthCheck() {
  console.log("================================================================================");
  console.log("🩺 READ-ONLY SYSTEM HEALTH CHECK & FINANCIAL INVARIANT AUDIT");
  console.log("================================================================================\n");

  const members = await prisma.member.findMany({
    include: {
      idCards: {
        include: {
          autoPoolNode: true,
          commissionEntries: true
        }
      },
      mainWallet: {
        include: {
          ledgerEntries: true
        }
      }
    },
    orderBy: { memberCode: "asc" }
  });

  let allInvariantsPass = true;
  let allParityPass = true;
  let allPrefixesPass = true;

  console.log("MEMBER   | WALLET    | ON-HOLD   | TOTAL COMM | INVARIANT | MAIN CARD  | AP POS | PARITY | CARDS & TYPES");
  console.log("-------------------------------------------------------------------------------------------------------------------");

  for (const m of members) {
    const walletBalance = m.mainWallet ? m.mainWallet.balancePaise : 0;
    
    // Calculate commissions across all cards owned by member
    let onHoldPaise = 0;
    let totalCommPaise = 0;
    const cardSummaries = [];

    for (const card of m.idCards) {
      // Check prefix
      const expectedPrefix = card.type === "SUB" ? "SB" : (card.type === "REBIRTH" ? "RB" : "BB");
      if (!card.cardNumber.startsWith(expectedPrefix)) {
        allPrefixesPass = false;
      }
      cardSummaries.push(`${card.cardNumber} (${card.type})`);

      for (const comm of card.commissionEntries) {
        totalCommPaise += comm.amountPaise;
        if (comm.status === "PENDING_7_DAY" || comm.status === "LOCKED_ACB") {
          onHoldPaise += comm.amountPaise;
        }
      }
    }

    const invariantPass = (walletBalance + onHoldPaise === totalCommPaise);
    if (!invariantPass) allInvariantsPass = false;

    const mainCard = m.idCards.find(c => c.type === "MAIN");
    const apPos = mainCard?.autoPoolNode?.globalPosition;
    const parityMatch = (m.memberCode === mainCard?.cardNumber && mainCard?.cardNumber === ("BB" + String(10000 + apPos)));
    if (!parityMatch) allParityPass = false;

    console.log(
      `${(m.memberCode || 'N/A').padEnd(8)} | ` +
      `Rs.${(walletBalance / 100).toFixed(2).padStart(6)} | ` +
      `Rs.${(onHoldPaise / 100).toFixed(2).padStart(6)} | ` +
      `Rs.${(totalCommPaise / 100).toFixed(2).padStart(7)} | ` +
      `${invariantPass ? "✅ PASS   " : "❌ FAIL   "} | ` +
      `${(mainCard?.cardNumber || 'N/A').padEnd(10)} | ` +
      `#${String(apPos || 'N/A').padEnd(5)} | ` +
      `${parityMatch ? "✅ MATCH" : "❌ MISMATCH"} | ` +
      `${cardSummaries.join(', ')}`
    );
  }

  console.log("-------------------------------------------------------------------------------------------------------------------");

  // Global counts & counters
  const totalCommissions = await prisma.commissionEntry.count();
  const totalPayOnce = await prisma.payOnceLedger.count();
  const totalLedgers = await prisma.ledgerEntry.count();
  const memberCounter = await prisma.systemCounter.findUnique({ where: { id: "MEMBER_CODE" } });
  const apCounter = await prisma.systemCounter.findUnique({ where: { id: "AUTOPOOL_GLOBAL" } });

  console.log("\n📊 GLOBAL SYSTEM INTEGRITY SUMMARY:");
  console.log(`  - Financial Invariants (Wallet + OnHold == Total): ${allInvariantsPass ? '✅ 100% PASS' : '❌ FAIL'}`);
  console.log(`  - 1:1:1 MAIN Card Parity (memberCode == MAIN == BB10000+Pos): ${allParityPass ? '✅ 100% PASS' : '❌ FAIL'}`);
  console.log(`  - Card Prefix Conventions (MAIN=BB, SUB=SB, REBIRTH=RB): ${allPrefixesPass ? '✅ 100% PASS' : '❌ FAIL'}`);
  console.log(`  - Total CommissionEntry Records: ${totalCommissions}`);
  console.log(`  - Total PayOnceLedger Records:   ${totalPayOnce}`);
  console.log(`  - Total LedgerEntry Records:     ${totalLedgers}`);
  console.log(`  - SystemCounter MEMBER_CODE:     ${memberCounter?.currentValue} (Expected: 10015)`);
  console.log(`  - SystemCounter AUTOPOOL_GLOBAL: ${apCounter?.currentValue} (Expected: 17)`);

  console.log("\n================================================================================\n");

  await prisma.$disconnect();
}

runHealthCheck();
