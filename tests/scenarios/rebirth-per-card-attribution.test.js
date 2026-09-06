const request = require("supertest");
const app = require("../../src/server");
const prisma = require("../../src/lib/prisma");
const { truncateDb } = require("../helpers/cleanDb");
const { seedSettingsAndSuperAdmin } = require("../../src/lib/seedSettings");
const { purchaseIds } = require("../../src/services/idCardService");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

describe("Scenario: Per-Card Rebirth & Voucher Attribution Contract", () => {
  const unique = Date.now().toString().slice(-6);
  let member;
  let mainCard, sub1Card, sub2Card;
  let mainToken, sub1Token;

  beforeAll(async () => {
    await truncateDb(prisma);
    await seedSettingsAndSuperAdmin();

    const passwordHash = await bcrypt.hash("TestPass123!", 10);

    // 1. Create primary test member
    member = await prisma.member.create({
      data: {
        memberCode: `BB${unique}01`,
        name: "Rebirth Attribution Tester",
        mobile: `99${unique}01`,
        passwordHash,
        kycStatus: "APPROVED",
        mainWallet: { create: { balancePaise: 0 } }
      }
    });

    // 2. Provision 3 cards for member (MAIN at pos 1, SUB1 at pos 2, SUB2 at pos 3)
    const cards = await purchaseIds(member.id, 3, null, null);
    mainCard = cards.find(c => c.type === "MAIN");
    sub1Card = cards.find(c => c.cardNumber.startsWith("SB") && c.cardNumber.endsWith("02") || c.type === "SUB");
    
    const allCards = await prisma.memberIdCard.findMany({
      where: { memberId: member.id },
      include: { autoPoolNode: true }
    });
    mainCard = allCards.find(c => c.type === "MAIN");
    sub1Card = allCards.find(c => c.autoPoolNode?.globalPosition === 2);
    sub2Card = allCards.find(c => c.autoPoolNode?.globalPosition === 3);

    // Tokens for MAIN and SUB1 login contexts
    mainToken = jwt.sign(
      {
        id: member.id,
        loginCardId: mainCard.id,
        loginCardNumber: mainCard.cardNumber,
        loginCardType: "MAIN"
      },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    sub1Token = jwt.sign(
      {
        id: member.id,
        loginCardId: sub1Card.id,
        loginCardNumber: sub1Card.cardNumber,
        loginCardType: "SUB"
      },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    // 3. Populate AutoPool tree to trigger completions:
    // Pos 1 (MAIN) completes Level 4 at global position 31 (triggering Rebirth #1 for MAIN at pos 32)
    // Pos 2 (SUB1) completes Level 4 at global position 47 (triggering Rebirth #2 for SUB1 at pos 48)
    // Pos 1 (MAIN) completes Level 5 at global position 63 (triggering Rebirth #3 for MAIN at pos 64 + Level 5 Voucher)
    // Pos 3 (SUB2) completes Level 4 at global position 63 (triggering Rebirth #4 for SUB2 at pos 65)

    // We create dummy members and purchase cards up to global position 65
    let currentGlobalCount = 3;
    let dummyIndex = 10;
    while (currentGlobalCount < 63) {
      const dummy = await prisma.member.create({
        data: {
          memberCode: `BB${unique}${dummyIndex}`,
          name: `Dummy ${dummyIndex}`,
          mobile: `99${unique}${dummyIndex}`,
          passwordHash,
          mainWallet: { create: { balancePaise: 0 } }
        }
      });
      dummyIndex++;
      const needed = Math.min(10, 63 - currentGlobalCount);
      const purchased = await purchaseIds(dummy.id, needed, null, null);
      currentGlobalCount += purchased.length;
    }
  });

  afterAll(async () => {
    await truncateDb(prisma);
    await prisma.$disconnect();
  });

  test("Database Invariant: Rebirth cards and vouchers are stored with earning card attribution", async () => {
    const memberRebirths = await prisma.memberIdCard.findMany({
      where: { memberId: member.id, type: "REBIRTH" },
      include: { earnedByCard: true }
    });

    expect(memberRebirths.length).toBeGreaterThanOrEqual(4);

    const mainRebirths = memberRebirths.filter(r => r.earnedByIdCardId === mainCard.id);
    const sub1Rebirths = memberRebirths.filter(r => r.earnedByIdCardId === sub1Card.id);
    const sub2Rebirths = memberRebirths.filter(r => r.earnedByIdCardId === sub2Card.id);

    // MAIN completed Level 4 (pos 31) and Level 5 (pos 63) -> 2 Rebirth cards
    expect(mainRebirths.length).toBe(2);
    // SUB1 completed Level 4 (pos 47) -> 1 Rebirth card
    expect(sub1Rebirths.length).toBe(1);
    // SUB2 completed Level 4 (pos 63) -> 1 Rebirth card
    expect(sub2Rebirths.length).toBe(1);

    // Check Vouchers in DB
    const memberVouchers = await prisma.voucher.findMany({
      where: { memberId: member.id }
    });

    expect(memberVouchers.length).toBe(1);
    expect(memberVouchers[0].sourceType).toBe("AUTOPOOL_LEVEL_5");
    expect(memberVouchers[0].faceValuePaise).toBe(20000);
    expect(memberVouchers[0].idCardId).toBe(mainCard.id);
  });

  test("API Contract (MAIN View): /api/members/profile and /api/members/autopool-tree return only MAIN-earned rewards", async () => {
    const profileRes = await request(app)
      .get("/api/members/profile")
      .set("Authorization", `Bearer ${mainToken}`)
      .expect(200);

    expect(profileRes.body.success).toBe(true);
    const profile = profileRes.body.data;

    // Active card must be MAIN
    expect(profile.activeCard.id).toBe(mainCard.id);
    expect(profile.activeCard.type).toBe("MAIN");

    // Filtered by active card
    const mainEarnedRebirths = profile.idCards.filter(c => c.type === "REBIRTH" && c.earnedByIdCardId === mainCard.id);
    expect(mainEarnedRebirths.length).toBe(2);

    const mainEarnedVouchers = profile.vouchers.filter(v => v.idCardId === mainCard.id);
    expect(mainEarnedVouchers.length).toBe(1);
    expect(mainEarnedVouchers[0].sourceType).toBe("AUTOPOOL_LEVEL_5");

    // AutoPool Tree Stats
    const apRes = await request(app)
      .get("/api/members/autopool-tree")
      .set("Authorization", `Bearer ${mainToken}`)
      .expect(200);

    expect(apRes.body.success).toBe(true);
    expect(apRes.body.data.myStats.rebirthIds).toBe(2);
    expect(apRes.body.data.myStats.vouchersPaise).toBe(20000);
  });

  test("API Contract (SUB1 View): /api/members/profile and /api/members/autopool-tree return only SUB1-earned rewards", async () => {
    const profileRes = await request(app)
      .get("/api/members/profile")
      .set("Authorization", `Bearer ${sub1Token}`)
      .expect(200);

    expect(profileRes.body.success).toBe(true);
    const profile = profileRes.body.data;

    // Active card must be SUB1
    expect(profile.activeCard.id).toBe(sub1Card.id);
    expect(profile.activeCard.type).toBe("SUB");

    // Filtered by active card (SUB1)
    const sub1EarnedRebirths = profile.idCards.filter(c => c.type === "REBIRTH" && c.earnedByIdCardId === sub1Card.id);
    expect(sub1EarnedRebirths.length).toBe(1);

    const sub1EarnedVouchers = profile.vouchers.filter(v => v.idCardId === sub1Card.id);
    expect(sub1EarnedVouchers.length).toBe(0);

    // AutoPool Tree Stats
    const apRes = await request(app)
      .get("/api/members/autopool-tree")
      .set("Authorization", `Bearer ${sub1Token}`)
      .expect(200);

    expect(apRes.body.success).toBe(true);
    expect(apRes.body.data.myStats.rebirthIds).toBe(1);
    expect(apRes.body.data.myStats.vouchersPaise).toBe(0);
  });
});
