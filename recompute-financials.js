const prisma = require("./src/lib/prisma");

const AMOUNTS = {
  1: 30000,
  2: 30000,
  3: 20000
};

async function recomputeFinancials() {
  console.log("================================================================================");
  console.log("🔄 PHASE 2 — FINANCIAL RECOMPUTE & STATE REBUILD");
  console.log("================================================================================\n");

  // ---------------------------------------------------------------------------
  // STEP 1: WIPE ALL FINANCIAL STATE
  // ---------------------------------------------------------------------------
  console.log("Step 1: Wiping all financial records & resetting statuses...");

  const delComm = await prisma.commissionEntry.deleteMany({});
  console.log(`  ✓ Deleted ${delComm.count} CommissionEntry rows`);

  const delPayOnce = await prisma.payOnceLedger.deleteMany({});
  console.log(`  ✓ Deleted ${delPayOnce.count} PayOnceLedger rows`);

  const delLedger = await prisma.ledgerEntry.deleteMany({});
  console.log(`  ✓ Deleted ${delLedger.count} LedgerEntry rows`);

  const resetWallets = await prisma.wallet.updateMany({
    data: { balancePaise: 0 }
  });
  console.log(`  ✓ Reset ${resetWallets.count} Wallets to balance 0 paise`);

  const resetCards = await prisma.memberIdCard.updateMany({
    data: {
      acbStatus: false,
      acbUnlockedAt: null
    }
  });
  console.log(`  ✓ Reset ${resetCards.count} MemberIdCards ACB status to false\n`);

  // ---------------------------------------------------------------------------
  // STEP 2: REBUILD FROM ACTIVE TREES
  // ---------------------------------------------------------------------------
  console.log("Step 2: Rebuilding financial state from current active trees...\n");

  // Fetch all active data
  const allCards = await prisma.memberIdCard.findMany({
    include: {
      member: true,
      autoPoolNode: true,
      mySystemNode: true
    },
    orderBy: { createdAt: "asc" }
  });

  const allMySystemNodes = await prisma.mySystemNode.findMany({
    include: {
      idCard: { include: { member: true } }
    }
  });

  const allAutoPoolNodes = await prisma.autoPoolNode.findMany({
    include: {
      idCard: { include: { member: true } }
    },
    orderBy: { globalPosition: "asc" }
  });

  const apPosMap = new Map();
  allAutoPoolNodes.forEach(n => apPosMap.set(n.globalPosition, n));

  // A. Unlock ACB for eligible MAIN cards (LEFT + RIGHT child in MY_SYSTEM)
  console.log("  A. Evaluating ACB Status...");
  for (const card of allCards) {
    if (card.type === "MAIN" && card.mySystemNode) {
      const children = allMySystemNodes.filter(n => n.parentNodeId === card.mySystemNode.id);
      const hasLeft = children.some(c => c.side === "LEFT");
      const hasRight = children.some(c => c.side === "RIGHT");

      if (hasLeft && hasRight) {
        await prisma.memberIdCard.update({
          where: { id: card.id },
          data: {
            acbStatus: true,
            acbUnlockedAt: new Date()
          }
        });
        card.acbStatus = true;
        card.acbUnlockedAt = new Date();
        console.log(`     ✓ ACB Unlocked for ${card.cardNumber} (${card.member.memberCode} - ${card.member.name})`);
      }
    }
  }

  // B. Process MY_SYSTEM Commissions (L1..L3)
  console.log("\n  B. Processing MY_SYSTEM Commissions...");

  function countAtDepth(rootId, depth) {
    let currentIds = [rootId];
    for (let d = 1; d <= depth; d++) {
      const children = allMySystemNodes.filter(n => n.parentNodeId && currentIds.includes(n.parentNodeId));
      if (children.length === 0) return 0;
      currentIds = children.map(c => c.id);
    }
    return currentIds.length;
  }

  // Process in tree order
  for (const msNode of allMySystemNodes) {
    const card = allCards.find(c => c.id === msNode.idCardId);
    if (!card) continue;

    for (let L = 1; L <= 3; L++) {
      const required = Math.pow(2, L);
      const actual = countAtDepth(msNode.id, L);

      if (actual === required) {
        const amountPaise = AMOUNTS[L];
        const comm = await prisma.commissionEntry.create({
          data: {
            idCardId: card.id,
            stream: "MY_SYSTEM",
            level: L,
            amountPaise,
            status: "PENDING_7_DAY"
          }
        });

        await prisma.payOnceLedger.create({
          data: {
            idCardId: card.id,
            level: L,
            paidVia: "MY_SYSTEM"
          }
        });

        console.log(`     ✓ MY_SYSTEM L${L} complete for ${card.cardNumber} (${card.member.memberCode}): Rs.${amountPaise / 100} (PENDING_7_DAY)`);
      }
    }
  }

  // C. Process AUTOPOOL Commissions (L1..L3)
  console.log("\n  C. Processing AUTOPOOL Commissions...");

  for (const apNode of allAutoPoolNodes) {
    const card = allCards.find(c => c.id === apNode.idCardId);
    if (!card) continue;

    const P = apNode.globalPosition;

    for (let L = 1; L <= 3; L++) {
      const startPos = P * Math.pow(2, L);
      const endPos = startPos + Math.pow(2, L) - 1;
      const requiredSize = Math.pow(2, L);

      let filled = 0;
      for (let pos = startPos; pos <= endPos; pos++) {
        if (apPosMap.has(pos)) filled++;
      }

      if (filled === requiredSize) {
        // Check Pay-Once
        const alreadyPaid = await prisma.payOnceLedger.findUnique({
          where: {
            idCardId_level: {
              idCardId: card.id,
              level: L
            }
          }
        });

        if (alreadyPaid) {
          await prisma.commissionEntry.create({
            data: {
              idCardId: card.id,
              stream: "AUTOPOOL",
              level: L,
              amountPaise: 0,
              status: "PAY_ONCE_BLOCKED"
            }
          });
          console.log(`     ✓ AUTOPOOL L${L} for ${card.cardNumber} (${card.member.memberCode}): Rs.0 (PAY_ONCE_BLOCKED, paid via ${alreadyPaid.paidVia})`);
        } else {
          // Check ACB status of owner's MAIN card
          const ownerMainCard = allCards.find(c => c.memberId === card.memberId && c.type === "MAIN");
          const isAcb = ownerMainCard ? ownerMainCard.acbStatus : false;
          const status = isAcb ? "WITHDRAWABLE" : "LOCKED_ACB";
          const amountPaise = AMOUNTS[L];

          const comm = await prisma.commissionEntry.create({
            data: {
              idCardId: card.id,
              stream: "AUTOPOOL",
              level: L,
              amountPaise,
              status
            }
          });

          await prisma.payOnceLedger.create({
            data: {
              idCardId: card.id,
              level: L,
              paidVia: "AUTOPOOL"
            }
          });

          console.log(`     ✓ AUTOPOOL L${L} for ${card.cardNumber} (${card.member.memberCode}): Rs.${amountPaise / 100} (${status})`);
        }
      }
    }
  }

  // D. Credit Wallets & Rebuild LedgerEntries for WITHDRAWABLE Commissions
  console.log("\n  D. Crediting Wallets & Building Ledger Entries...");

  const withdrawableComms = await prisma.commissionEntry.findMany({
    where: { status: "WITHDRAWABLE" },
    include: {
      idCard: { include: { member: true } }
    },
    orderBy: { createdAt: "asc" }
  });

  for (const comm of withdrawableComms) {
    const memberId = comm.idCard.memberId;
    let wallet = await prisma.wallet.findUnique({ where: { memberId } });
    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: { memberId, balancePaise: 0 }
      });
    }

    const balanceBefore = wallet.balancePaise;
    const balanceAfter = balanceBefore + comm.amountPaise;

    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balancePaise: balanceAfter }
    });

    await prisma.ledgerEntry.create({
      data: {
        walletId: wallet.id,
        type: "CREDIT",
        amountPaise: comm.amountPaise,
        balanceBeforePaise: balanceBefore,
        balanceAfterPaise: balanceAfter,
        source: comm.stream,
        referenceId: comm.id,
        description: `Commission for ${comm.stream} Level ${comm.level}`
      }
    });

    console.log(`     ✓ Credited Rs.${comm.amountPaise / 100} to ${comm.idCard.member.memberCode} wallet (New Balance: Rs.${balanceAfter / 100})`);
  }

  // ---------------------------------------------------------------------------
  // STEP 3: FIX SYSTEM COUNTERS TO REALITY
  // ---------------------------------------------------------------------------
  console.log("\nStep 3: Updating System Counters to reality...");

  const updatedApCounter = await prisma.systemCounter.upsert({
    where: { id: "AUTOPOOL_GLOBAL" },
    update: { currentValue: 14 },
    create: { id: "AUTOPOOL_GLOBAL", currentValue: 14 }
  });
  console.log(`  ✓ SystemCounter 'AUTOPOOL_GLOBAL' set to: ${updatedApCounter.currentValue}`);

  const updatedMemberCounter = await prisma.systemCounter.upsert({
    where: { id: "MEMBER_CODE" },
    update: { currentValue: 10014 },
    create: { id: "MEMBER_CODE", currentValue: 10014 }
  });
  console.log(`  ✓ SystemCounter 'MEMBER_CODE' set to: ${updatedMemberCounter.currentValue}\n`);

  // ---------------------------------------------------------------------------
  // STEP 4: SELF-VERIFY AND PRINT PER-MEMBER TABLE
  // ---------------------------------------------------------------------------
  console.log("================================================================================");
  console.log("📊 STEP 4: PER-MEMBER FINANCIAL AUDIT & RECONCILIATION TABLE");
  console.log("================================================================================\n");

  const members = await prisma.member.findMany({
    include: {
      mainWallet: { include: { ledgerEntries: true } },
      idCards: {
        include: {
          commissionEntries: { orderBy: { createdAt: "asc" } },
          payOnceLedgerEntries: true
        }
      }
    },
    orderBy: { memberCode: "asc" }
  });

  const totalCommsCount = await prisma.commissionEntry.count();
  const totalPayOnceCount = await prisma.payOnceLedger.count();
  const totalLedgerCount = await prisma.ledgerEntry.count();

  console.log("MEMBER   | WALLET    | ON-HOLD   | TOTAL     | INVARIANT | COMMISSION BREAKDOWN");
  console.log("---------------------------------------------------------------------------------------------------------------");

  let allInvariantsPass = true;

  for (const m of members) {
    const walletBalancePaise = m.mainWallet?.balancePaise || 0;
    const allMemberComms = m.idCards.flatMap(c => c.commissionEntries);

    const totalPaise = allMemberComms.reduce((s, c) => s + c.amountPaise, 0);
    const onHoldPaise = allMemberComms
      .filter(c => c.status === "PENDING_7_DAY" || c.status === "LOCKED_ACB")
      .reduce((s, c) => s + c.amountPaise, 0);

    const invariantPass = (walletBalancePaise + onHoldPaise === totalPaise);
    if (!invariantPass) allInvariantsPass = false;

    const commSummary = allMemberComms.length > 0
      ? allMemberComms.map(c => `${c.stream} L${c.level}: Rs.${c.amountPaise / 100} (${c.status})`).join("; ")
      : "None";

    console.log(
      `${(m.memberCode || m.id).padEnd(8)} | ` +
      `Rs.${(walletBalancePaise / 100).toFixed(2).padStart(6)} | ` +
      `Rs.${(onHoldPaise / 100).toFixed(2).padStart(6)} | ` +
      `Rs.${(totalPaise / 100).toFixed(2).padStart(6)} | ` +
      `${(invariantPass ? "✅ PASS" : "❌ FAIL")}   | ` +
      `${commSummary}`
    );
  }

  console.log("---------------------------------------------------------------------------------------------------------------");
  console.log(`\n📋 TOTAL COUNTS AUDIT:`);
  console.log(`  - Total CommissionEntry count: ${totalCommsCount} (Expected: 14) -> ${totalCommsCount === 14 ? "✅ MATCH" : "❌ MISMATCH"}`);
  console.log(`  - Total PayOnceLedger count:   ${totalPayOnceCount} (Expected: 10) -> ${totalPayOnceCount === 10 ? "✅ MATCH" : "❌ MISMATCH"}`);
  console.log(`  - Total LedgerEntry count:     ${totalLedgerCount} (Expected: 2)  -> ${totalLedgerCount === 2 ? "✅ MATCH" : "❌ MISMATCH"}`);
  console.log(`  - All Invariants Pass:         ${allInvariantsPass ? "✅ YES (Wallet + OnHold == Total for all)" : "❌ NO"}`);
  console.log(`  - Counters: AUTOPOOL_GLOBAL=${updatedApCounter.currentValue}, MEMBER_CODE=${updatedMemberCounter.currentValue}`);

  console.log("\n================================================================================\n");

  await prisma.$disconnect();
}

recomputeFinancials();
