const prisma = require("./src/lib/prisma");
const { purchaseIds } = require("./src/services/idCardService");

async function buildNetwork() {
  console.log("\n🏗️  Building complete network with sponsor tracking...\n");

  // Helper to get MAIN card for a member
  async function getMainCard(memberCode) {
    const member = await prisma.member.findUnique({ where: { memberCode } });
    if (!member) throw new Error(`Member ${memberCode} not found`);
    const card = await prisma.memberIdCard.findFirst({ 
      where: { memberId: member.id, type: "MAIN" } 
    });
    return card;
  }

  try {
    // 1. BB10001 - Root (no sponsor)
    console.log("1. Creating BB10001 (ROOT)...");
    const m1 = await prisma.member.findUnique({ where: { memberCode: "BB10001" } });
    await purchaseIds(m1.id, 1, null, null);
    console.log("   ✓ BB10001 created as ROOT\n");

    // 2. BB10002 - Sponsored by BB10001, LEFT
    console.log("2. Creating BB10002 (sponsored by BB10001, LEFT)...");
    const card1 = await getMainCard("BB10001");
    const m2 = await prisma.member.findUnique({ where: { memberCode: "BB10002" } });
    await purchaseIds(m2.id, 1, card1.id, "LEFT");
    console.log("   ✓ BB10002 placed LEFT under BB10001\n");

    // 3. BB10003 - Sponsored by BB10001, RIGHT
    console.log("3. Creating BB10003 (sponsored by BB10001, RIGHT)...");
    const m3 = await prisma.member.findUnique({ where: { memberCode: "BB10003" } });
    await purchaseIds(m3.id, 1, card1.id, "RIGHT");
    console.log("   ✓ BB10003 placed RIGHT under BB10001\n");

    // 4. BB10004 - Sponsored by BB10002, LEFT
    console.log("4. Creating BB10004 (sponsored by BB10002, LEFT)...");
    const card2 = await getMainCard("BB10002");
    const m4 = await prisma.member.findUnique({ where: { memberCode: "BB10004" } });
    await purchaseIds(m4.id, 1, card2.id, "LEFT");
    console.log("   ✓ BB10004 placed LEFT under BB10002\n");

    // 5. BB10005 - Sponsored by BB10002, RIGHT
    console.log("5. Creating BB10005 (sponsored by BB10002, RIGHT)...");
    const m5 = await prisma.member.findUnique({ where: { memberCode: "BB10005" } });
    await purchaseIds(m5.id, 1, card2.id, "RIGHT");
    console.log("   ✓ BB10005 placed RIGHT under BB10002\n");

    // 6. BB10006 - Sponsored by BB10005, RIGHT
    console.log("6. Creating BB10006 (sponsored by BB10005, RIGHT)...");
    const card5 = await getMainCard("BB10005");
    const m6 = await prisma.member.findUnique({ where: { memberCode: "BB10006" } });
    await purchaseIds(m6.id, 1, card5.id, "RIGHT");
    console.log("   ✓ BB10006 placed RIGHT under BB10005\n");

    // 7. BB10007 - Sponsored by BB10005, LEFT
    console.log("7. Creating BB10007 (sponsored by BB10005, LEFT)...");
    const m7 = await prisma.member.findUnique({ where: { memberCode: "BB10007" } });
    await purchaseIds(m7.id, 1, card5.id, "LEFT");
    console.log("   ✓ BB10007 placed LEFT under BB10005\n");

    // 8. BB10008 - Sponsored by BB10006, LEFT
    console.log("8. Creating BB10008 (sponsored by BB10006, LEFT)...");
    const card6 = await getMainCard("BB10006");
    const m8 = await prisma.member.findUnique({ where: { memberCode: "BB10008" } });
    await purchaseIds(m8.id, 1, card6.id, "LEFT");
    console.log("   ✓ BB10008 placed LEFT under BB10006\n");

    // 9. BB10009 - Sponsored by BB10006, RIGHT
    console.log("9. Creating BB10009 (sponsored by BB10006, RIGHT)...");
    const m9 = await prisma.member.findUnique({ where: { memberCode: "BB10009" } });
    await purchaseIds(m9.id, 1, card6.id, "RIGHT");
    console.log("   ✓ BB10009 placed RIGHT under BB10006\n");

    // 10. BB10010 - Sponsored by BB10004, LEFT
    console.log("10. Creating BB10010 (sponsored by BB10004, LEFT)...");
    const card4 = await getMainCard("BB10004");
    const m10 = await prisma.member.findUnique({ where: { memberCode: "BB10010" } });
    await purchaseIds(m10.id, 1, card4.id, "LEFT");
    console.log("   ✓ BB10010 placed LEFT under BB10004\n");

    // 11. BB10011 - Sponsored by BB10007, LEFT
    console.log("11. Creating BB10011 (sponsored by BB10007, LEFT)...");
    const card7 = await getMainCard("BB10007");
    const m11 = await prisma.member.findUnique({ where: { memberCode: "BB10011" } });
    await purchaseIds(m11.id, 1, card7.id, "LEFT");
    console.log("   ✓ BB10011 placed LEFT under BB10007\n");

    // 12. BB10012 - Sponsored by BB10007, RIGHT
    console.log("12. Creating BB10012 (sponsored by BB10007, RIGHT)...");
    const m12 = await prisma.member.findUnique({ where: { memberCode: "BB10012" } });
    await purchaseIds(m12.id, 1, card7.id, "RIGHT");
    console.log("   ✓ BB10012 placed RIGHT under BB10007\n");

    // 13. BB10013 - THE KEY TEST: Sponsored by BB10001 LEFT (should spill to extreme-left)
    console.log("13. Creating BB10013 (sponsored by BB10001, LEFT - should spill!)...");
    const m13 = await prisma.member.findUnique({ where: { memberCode: "BB10013" } });
    await purchaseIds(m13.id, 1, card1.id, "LEFT");
    console.log("   ✓ BB10013 should spill to extreme-left vacant slot\n");

    console.log("✅ Network built successfully!\n");
    
    // Quick verification
    const totalCards = await prisma.memberIdCard.count();
    const totalNodes = await prisma.mySystemNode.count();
    console.log(`📊 Final stats:`);
    console.log(`   - ID Cards: ${totalCards}`);
    console.log(`   - MY SYSTEM Nodes: ${totalNodes}\n`);

  } catch (error) {
    console.error("\n❌ Error building network:", error.message);
    console.error(error.stack);
  }

  await prisma.$disconnect();
}

buildNetwork();
