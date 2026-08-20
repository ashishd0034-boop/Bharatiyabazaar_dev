const prisma = require("/Users/ashishdubey/Desktop/coder/Bharatiya Bazaar/qewn/bb-backend/src/lib/prisma");

async function migrateAndVerify() {
  console.log("================================================================================");
  console.log("🔄 R3 CONSISTENCY MIGRATION: RENAME CARD PREFIXES");
  console.log("================================================================================\n");

  // Run database migration in transaction
  const result = await prisma.$transaction(async (tx) => {
    // 1. Update SUB cards
    const subCardsBefore = await tx.memberIdCard.findMany({
      where: { type: "SUB", cardNumber: { startsWith: "BB" } }
    });

    for (const card of subCardsBefore) {
      const newCardNumber = "SB" + card.cardNumber.slice(2);
      await tx.memberIdCard.update({
        where: { id: card.id },
        data: { cardNumber: newCardNumber }
      });
      console.log(`  ✓ Updated SUB card ID ${card.id}: ${card.cardNumber} -> ${newCardNumber}`);
    }

    // 2. Update REBIRTH cards
    const rebirthCardsBefore = await tx.memberIdCard.findMany({
      where: { type: "REBIRTH", cardNumber: { startsWith: "BB" } }
    });

    for (const card of rebirthCardsBefore) {
      const newCardNumber = "RB" + card.cardNumber.slice(2);
      await tx.memberIdCard.update({
        where: { id: card.id },
        data: { cardNumber: newCardNumber }
      });
      console.log(`  ✓ Updated REBIRTH card ID ${card.id}: ${card.cardNumber} -> ${newCardNumber}`);
    }

    return {
      subsMigrated: subCardsBefore.length,
      rebirthsMigrated: rebirthCardsBefore.length
    };
  });

  console.log(`\nMigration completed: ${result.subsMigrated} SUB cards and ${result.rebirthsMigrated} REBIRTH cards updated.`);

  console.log("\n================================================================================");
  console.log("📊 READ-ONLY VERIFICATION AUDIT");
  console.log("================================================================================\n");

  // (a) Member BB10015 tree & cards (if BB10015 exists)
  const member15 = await prisma.member.findUnique({
    where: { memberCode: "BB10015" },
    include: {
      idCards: {
        include: {
          mySystemNode: {
            include: {
              parent: { include: { idCard: true } },
              children: { include: { idCard: true } }
            }
          },
          autoPoolNode: true
        },
        orderBy: { cardNumber: "asc" }
      }
    }
  });

  if (member15) {
    console.log(`Member BB10015 Details (${member15.name}, ${member15.mobile}):`);
    member15.idCards.forEach(c => {
      const parentCard = c.mySystemNode?.parent?.idCard?.cardNumber || 'ROOT';
      const side = c.mySystemNode?.side || '-';
      const pool = c.autoPoolNode?.globalPosition ? `#${c.autoPoolNode.globalPosition}` : '-';
      console.log(`  - Card: ${c.cardNumber.padEnd(9)} | Type: ${c.type.padEnd(7)} | Placed Under: ${(parentCard + ' (' + side + ')').padEnd(16)} | AutoPool: ${pool}`);
    });
  } else {
    console.log("Member BB10015 not yet registered in DB.");
  }

  // (b) Full Card List with new prefixes
  console.log("\n📋 ALL ID CARDS IN SYSTEM:");
  console.log("CARD NUMBER | TYPE    | OWNER CODE  | OWNER NAME     | AP POS | ACB STATUS");
  console.log("-----------------------------------------------------------------------------");
  const allCards = await prisma.memberIdCard.findMany({
    include: {
      member: true,
      autoPoolNode: true
    },
    orderBy: { autoPoolNode: { globalPosition: "asc" } }
  });

  allCards.forEach(c => {
    console.log(
      `${c.cardNumber.padEnd(11)} | ` +
      `${c.type.padEnd(7)} | ` +
      `${(c.member.memberCode || 'N/A').padEnd(11)} | ` +
      `${(c.member.name || '').padEnd(14)} | ` +
      `#${String(c.autoPoolNode?.globalPosition || 'N/A').padEnd(6)} | ` +
      `${c.acbStatus ? '✅ ACB' : 'Pending'}`
    );
  });
  console.log("-----------------------------------------------------------------------------");

  // (c) Parity Table for all MAIN cards (1:1:1)
  console.log("\n📋 MAIN CARDS 1:1:1 PARITY AUDIT:");
  console.log("MEMBER CODE | MAIN CARD  | AUTOPOOL POS | 1:1:1 PARITY");
  console.log("-------------------------------------------------------");
  const allMembers = await prisma.member.findMany({
    include: {
      idCards: {
        include: { autoPoolNode: true }
      }
    },
    orderBy: { memberCode: "asc" }
  });

  let allParityMatch = true;
  allMembers.forEach((m, idx) => {
    const mainCard = m.idCards.find(c => c.type === "MAIN");
    const isParity = (m.memberCode === mainCard?.cardNumber);
    if (!isParity) allParityMatch = false;

    console.log(
      `${(m.memberCode || 'N/A').padEnd(11)} | ` +
      `${(mainCard?.cardNumber || 'N/A').padEnd(10)} | ` +
      `#${String(mainCard?.autoPoolNode?.globalPosition || 'N/A').padEnd(12)} | ` +
      `${isParity ? '✅ MATCH' : '❌ MISMATCH'}`
    );
  });
  console.log("-------------------------------------------------------");
  console.log(`Main Cards Parity Status: ${allParityMatch ? '🎉 100% PERFECT 1:1:1 PARITY PRESERVED' : '❌ MISMATCH DETECTED'}`);

  // (d) System Counters
  const memberCounter = await prisma.systemCounter.findUnique({ where: { id: "MEMBER_CODE" } });
  const apCounter = await prisma.systemCounter.findUnique({ where: { id: "AUTOPOOL_GLOBAL" } });

  console.log(`\nSystem Counters:`);
  console.log(`  - MEMBER_CODE:     ${memberCounter?.currentValue}`);
  console.log(`  - AUTOPOOL_GLOBAL: ${apCounter?.currentValue}`);

  console.log("\n================================================================================\n");

  await prisma.$disconnect();
}

migrateAndVerify();
