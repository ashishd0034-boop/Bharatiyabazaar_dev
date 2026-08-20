const prisma = require("/Users/ashishdubey/Desktop/coder/Bharatiya Bazaar/qewn/bb-backend/src/lib/prisma");
const bcrypt = require("bcrypt");
const { purchaseIds } = require("/Users/ashishdubey/Desktop/coder/Bharatiya Bazaar/qewn/bb-backend/src/services/idCardService");

async function seedFullProductionState() {
  console.log("================================================================================");
  console.log("🌱 SEEDING FULL SYSTEM STATE (15 MEMBERS + 17 CARDS)");
  console.log("================================================================================\n");

  // 1. Wipe all data cleanly
  console.log("1. Cleaning database tables...");
  await prisma.ledgerEntry.deleteMany({});
  await prisma.wallet.deleteMany({});
  await prisma.commissionEntry.deleteMany({});
  await prisma.payOnceLedger.deleteMany({});
  await prisma.mySystemNode.deleteMany({});
  await prisma.autoPoolNode.deleteMany({});
  await prisma.memberIdCard.deleteMany({});
  await prisma.voucher.deleteMany({});
  await prisma.withdrawal.deleteMany({});
  await prisma.setuKoshNode.deleteMany({});
  await prisma.setuKoshCounter.deleteMany({});
  await prisma.member.deleteMany({});
  await prisma.systemCounter.deleteMany({});
  console.log("  ✓ All tables cleaned");

  // 2. Initialize SystemCounters
  await prisma.systemCounter.createMany({
    data: [
      { id: "MEMBER_CODE", currentValue: 10000 },
      { id: "AUTOPOOL_GLOBAL", currentValue: 0 }
    ]
  });

  const passwordHash = await bcrypt.hash("password123", 10);

  // Helper to create member and wallet
  async function createMember(memberCode, name, mobile, sponsorMemberCode = null, side = null) {
    const member = await prisma.member.create({
      data: {
        memberCode,
        name,
        mobile,
        passwordHash,
        kycStatus: "APPROVED",
        kycTier: 1,
        mainWallet: {
          create: {
            balancePaise: 0
          }
        }
      }
    });

    // Update counter
    const num = parseInt(memberCode.replace("BB", ""), 10);
    await prisma.systemCounter.update({
      where: { id: "MEMBER_CODE" },
      data: { currentValue: num }
    });

    return member;
  }

  // 3. Create members 1 to 14
  console.log("\n2. Creating members BB10001 through BB10014...");

  // BB10001 (Root)
  const m1 = await createMember("BB10001", "Test Member 1", "9999900001");
  await purchaseIds(m1.id, 1, null, null);

  async function getMainCard(memberCode) {
    const m = await prisma.member.findUnique({ where: { memberCode } });
    return await prisma.memberIdCard.findFirst({ where: { memberId: m.id, type: "MAIN" } });
  }

  // BB10002 (sponsor: BB10001, LEFT)
  const m2 = await createMember("BB10002", "Test Member 2", "9999900002");
  const c1 = await getMainCard("BB10001");
  await purchaseIds(m2.id, 1, c1.id, "LEFT");

  // BB10003 (sponsor: BB10001, RIGHT)
  const m3 = await createMember("BB10003", "Test Member 3", "9999900003");
  await purchaseIds(m3.id, 1, c1.id, "RIGHT");

  // BB10004 (sponsor: BB10002, LEFT)
  const m4 = await createMember("BB10004", "Test Member 4", "9999900004");
  const c2 = await getMainCard("BB10002");
  await purchaseIds(m4.id, 1, c2.id, "LEFT");

  // BB10005 (sponsor: BB10002, RIGHT)
  const m5 = await createMember("BB10005", "Test Member 5", "9999900005");
  await purchaseIds(m5.id, 1, c2.id, "RIGHT");

  // BB10006 (sponsor: BB10005, RIGHT)
  const m6 = await createMember("BB10006", "Test Member 6", "9999900006");
  const c5 = await getMainCard("BB10005");
  await purchaseIds(m6.id, 1, c5.id, "RIGHT");

  // BB10007 (sponsor: BB10005, LEFT)
  const m7 = await createMember("BB10007", "Test Member 7", "9999900007");
  await purchaseIds(m7.id, 1, c5.id, "LEFT");

  // BB10008 (sponsor: BB10006, LEFT)
  const m8 = await createMember("BB10008", "Test Member 8", "9999900008");
  const c6 = await getMainCard("BB10006");
  await purchaseIds(m8.id, 1, c6.id, "LEFT");

  // BB10009 (sponsor: BB10006, RIGHT)
  const m9 = await createMember("BB10009", "Test Member 9", "9999900009");
  await purchaseIds(m9.id, 1, c6.id, "RIGHT");

  // BB10010 (sponsor: BB10004, LEFT)
  const m10 = await createMember("BB10010", "Test Member 10", "9999900010");
  const c4 = await getMainCard("BB10004");
  await purchaseIds(m10.id, 1, c4.id, "LEFT");

  // BB10011 (sponsor: BB10007, LEFT)
  const m11 = await createMember("BB10011", "Test Member 11", "9999900011");
  const c7 = await getMainCard("BB10007");
  await purchaseIds(m11.id, 1, c7.id, "LEFT");

  // BB10012 (sponsor: BB10007, RIGHT)
  const m12 = await createMember("BB10012", "Test Member 12", "9999900012");
  await purchaseIds(m12.id, 1, c7.id, "RIGHT");

  // BB10013 (sponsor: BB10001, LEFT)
  const m13 = await createMember("BB10013", "Test Member 13", "9999900013");
  await purchaseIds(m13.id, 1, c1.id, "LEFT");

  // BB10014 (sponsor: BB10001, RIGHT)
  const m14 = await createMember("BB10014", "rrr", "9999988888");
  await purchaseIds(m14.id, 1, c1.id, "RIGHT");

  // 4. Create member BB10015 with 3-ID bulk package (sponsor: BB10003, LEFT)
  console.log("\n3. Creating member BB10015 with 3-ID package (BB10015, SB10016, SB10017)...");
  const m15 = await createMember("BB10015", "re", "1010101010");
  const c3 = await getMainCard("BB10003");
  await purchaseIds(m15.id, 3, c3.id, "LEFT");

  console.log("\n✅ All 15 members & 17 cards created!");

  const cardCount = await prisma.memberIdCard.count();
  const memberCount = await prisma.member.count();
  console.log(`\nFinal Summary: Members=${memberCount}, Cards=${cardCount}`);

  await prisma.$disconnect();
}

seedFullProductionState().catch(console.error);
