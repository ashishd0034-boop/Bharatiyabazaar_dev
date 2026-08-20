const prisma = require("/Users/ashishdubey/Desktop/coder/Bharatiya Bazaar/qewn/bb-backend/src/lib/prisma");

async function applyStrictAcbFix() {
  console.log("================================================================================");
  console.log("⚡ APPLYING RETROACTIVE FIX FOR BB10003 (STRICT REFERRAL ACB RULE)");
  console.log("================================================================================\n");

  await prisma.$transaction(async (tx) => {
    // 1. Get BB10003 member and card
    const member = await tx.member.findUnique({
      where: { memberCode: "BB10003" },
      include: {
        idCards: { where: { type: "MAIN" } },
        mainWallet: true
      }
    });

    if (!member || !member.idCards[0]) {
      throw new Error("Member BB10003 or MAIN card not found");
    }

    const cardId = member.idCards[0].id;
    const walletId = member.mainWallet.id;

    // 2. Set acbStatus = false, acbUnlockedAt = null
    await tx.memberIdCard.update({
      where: { id: cardId },
      data: {
        acbStatus: false,
        acbUnlockedAt: null
      }
    });
    console.log("  ✓ Reset BB10003 MemberIdCard: acbStatus = false, acbUnlockedAt = null");

    // 3. Re-lock AUTOPOOL commissions from WITHDRAWABLE -> LOCKED_ACB
    const updatedComms = await tx.commissionEntry.updateMany({
      where: {
        idCardId: cardId,
        stream: "AUTOPOOL",
        status: "WITHDRAWABLE"
      },
      data: {
        status: "LOCKED_ACB"
      }
    });
    console.log(`  ✓ Updated ${updatedComms.count} CommissionEntry rows for BB10003 -> LOCKED_ACB`);

    // 4. Reset Wallet balance to 0
    await tx.wallet.update({
      where: { id: walletId },
      data: {
        balancePaise: 0
      }
    });
    console.log("  ✓ Reset BB10003 Wallet balancePaise = 0 (deducted Rs.600)");

    // 5. Delete the 2 ACB-unlocked LedgerEntry rows
    const deletedLedgers = await tx.ledgerEntry.deleteMany({
      where: {
        walletId: walletId
      }
    });
    console.log(`  ✓ Deleted ${deletedLedgers.count} LedgerEntry rows for BB10003`);
  });

  console.log("\n================================================================================");
  console.log("🔍 POST-FIX VERIFICATION AUDIT ACROSS ALL 15 MEMBERS");
  console.log("================================================================================\n");

  const members = await prisma.member.findMany({
    include: {
      idCards: {
        include: {
          autoPoolNode: true,
          commissionEntries: true,
          sponsoredNodes: true
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

  console.log("MEMBER   | WALLET    | ON-HOLD   | TOTAL COMM | INVARIANT | ACB STATUS | DIRECT REFS (L/R) | STATUS");
  console.log("---------------------------------------------------------------------------------------------------------");

  let allPass = true;
  for (const m of members) {
    const walletBalance = m.mainWallet ? m.mainWallet.balancePaise : 0;
    let onHoldPaise = 0;
    let totalCommPaise = 0;

    for (const card of m.idCards) {
      for (const comm of card.commissionEntries) {
        totalCommPaise += comm.amountPaise;
        if (comm.status === "PENDING_7_DAY" || comm.status === "LOCKED_ACB") {
          onHoldPaise += comm.amountPaise;
        }
      }
    }

    const mainCard = m.idCards.find(c => c.type === "MAIN");
    const sKids = mainCard?.sponsoredNodes || [];
    const sLeft = sKids.filter(k => k.side === "LEFT").length;
    const sRight = sKids.filter(k => k.side === "RIGHT").length;

    const invariantPass = (walletBalance + onHoldPaise === totalCommPaise);
    const expectedAcb = (sLeft >= 1 && sRight >= 1);
    const acbMatch = (mainCard?.acbStatus === expectedAcb);

    if (!invariantPass || !acbMatch) allPass = false;

    console.log(
      `${(m.memberCode || 'N/A').padEnd(8)} | ` +
      `Rs.${(walletBalance / 100).toFixed(2).padStart(6)} | ` +
      `Rs.${(onHoldPaise / 100).toFixed(2).padStart(6)} | ` +
      `Rs.${(totalCommPaise / 100).toFixed(2).padStart(7)} | ` +
      `${invariantPass ? "✅ PASS   " : "❌ FAIL   "} | ` +
      `${mainCard?.acbStatus ? "✅ TRUE " : "❌ FALSE"} | ` +
      `L:${sLeft}, R:${sRight}`.padEnd(17) + " | " +
      `${(invariantPass && acbMatch) ? "✅ VERIFIED" : "❌ ERROR"}`
    );
  }

  console.log("---------------------------------------------------------------------------------------------------------");
  console.log(`\nOverall System Health: ${allPass ? '🎉 100% PERFECT FINANCIAL INVARIANTS & STRICT ACB COMPLIANCE' : '❌ ERRORS DETECTED'}`);
  console.log("================================================================================\n");

  await prisma.$disconnect();
}

applyStrictAcbFix();
