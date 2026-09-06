const request = require("supertest");
const app = require("../../src/server");
const prisma = require("../../src/lib/prisma");
const { truncateDb } = require("../helpers/cleanDb");
const { seedSettingsAndSuperAdmin } = require("../../src/lib/seedSettings");
const { purchaseIds } = require("../../src/services/idCardService");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

describe("Scenario: Cross-Page Stat Parity Invariant Contract (FINALIZED.md §10.5)", () => {
  const unique = Date.now().toString().slice(-6);
  let member;
  let mainCard, sub1Card;
  let mainToken, sub1Token;

  beforeAll(async () => {
    await truncateDb(prisma);
    await seedSettingsAndSuperAdmin();

    const passwordHash = await bcrypt.hash("ParityPass123!", 10);

    // 1. Create member
    member = await prisma.member.create({
      data: {
        memberCode: `BB${unique}01`,
        name: "Stat Parity Member",
        mobile: `98${unique}01`,
        passwordHash,
        kycStatus: "APPROVED",
        mainWallet: { create: { balancePaise: 0 } }
      }
    });

    // 2. Provision 3 cards: MAIN (pos 1), SUB1 (pos 2), SUB2 (pos 3)
    await purchaseIds(member.id, 3, null, null);

    const allCards = await prisma.memberIdCard.findMany({
      where: { memberId: member.id },
      include: { autoPoolNode: true }
    });
    mainCard = allCards.find(c => c.type === "MAIN");
    sub1Card = allCards.find(c => c.autoPoolNode?.globalPosition === 2);

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

    // 3. Fill AutoPool to global position 63 so that:
    // - Pos 1 (MAIN) completes Level 4 (pos 31) and Level 5 (pos 63) -> 2 rebirths, 1 voucher (₹200)
    // - Pos 2 (SUB1) completes Level 4 (pos 47) -> 1 rebirth, 0 vouchers
    let currentGlobalCount = 3;
    let dummyIndex = 10;
    while (currentGlobalCount < 63) {
      const dummy = await prisma.member.create({
        data: {
          memberCode: `BB${unique}${dummyIndex}`,
          name: `Dummy ${dummyIndex}`,
          mobile: `98${unique}${dummyIndex}`,
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

  test("MAIN Card: All member endpoints return identical scoped stats backing Dashboard, AutoPool, Rebirth, Commissions, and Hindi views", async () => {
    // 1. Fetch from /api/members/autopool-tree (Backing Dashboard, AutoPool, Rebirth, Commissions, Hindi)
    const apRes = await request(app)
      .get("/api/members/autopool-tree")
      .set("Authorization", `Bearer ${mainToken}`)
      .expect(200);

    expect(apRes.body.success).toBe(true);
    const apStats = apRes.body.data.myStats;

    // MAIN completed Level 4 + Level 5
    expect(apStats.rebirthIds).toBe(2);
    expect(apStats.vouchersPaise).toBe(20000); // Rs.200.00

    // 2. Fetch from /api/members/profile (Fallback backing Rebirth, Commissions, Hindi)
    const profileRes = await request(app)
      .get("/api/members/profile")
      .set("Authorization", `Bearer ${mainToken}`)
      .expect(200);

    expect(profileRes.body.success).toBe(true);
    const profile = profileRes.body.data;
    const activeCardId = profile.activeCard.id;
    expect(activeCardId).toBe(mainCard.id);

    // Profile card-filtered fallback calculations
    const cardRebirths = (profile.idCards || []).filter(c => c.type === "REBIRTH" && c.earnedByIdCardId === activeCardId);
    const cardVouchers = (profile.vouchers || []).filter(v => v.idCardId === activeCardId);
    const voucherSumPaise = cardVouchers.reduce((s, v) => s + (v.faceValuePaise || 0), 0);

    expect(cardRebirths.length).toBe(2);
    expect(voucherSumPaise).toBe(20000);

    // 3. Mathematical Identity: Primary API === Fallback derivation
    expect(apStats.rebirthIds).toBe(cardRebirths.length);
    expect(apStats.vouchersPaise).toBe(voucherSumPaise);
  });

  test("SUB1 Card: All member endpoints return SUB1-only scoped stats with zero MAIN accumulation", async () => {
    // 1. Fetch from /api/members/autopool-tree under SUB1 context
    const apRes = await request(app)
      .get("/api/members/autopool-tree")
      .set("Authorization", `Bearer ${sub1Token}`)
      .expect(200);

    expect(apRes.body.success).toBe(true);
    const apStats = apRes.body.data.myStats;

    // SUB1 completed Level 4 (1 rebirth) but not Level 5 (0 vouchers)
    expect(apStats.rebirthIds).toBe(1);
    expect(apStats.vouchersPaise).toBe(0);

    // 2. Fetch from /api/members/profile under SUB1 context
    const profileRes = await request(app)
      .get("/api/members/profile")
      .set("Authorization", `Bearer ${sub1Token}`)
      .expect(200);

    expect(profileRes.body.success).toBe(true);
    const profile = profileRes.body.data;
    const activeCardId = profile.activeCard.id;
    expect(activeCardId).toBe(sub1Card.id);

    const cardRebirths = (profile.idCards || []).filter(c => c.type === "REBIRTH" && c.earnedByIdCardId === activeCardId);
    const cardVouchers = (profile.vouchers || []).filter(v => v.idCardId === activeCardId);
    const voucherSumPaise = cardVouchers.reduce((s, v) => s + (v.faceValuePaise || 0), 0);

    expect(cardRebirths.length).toBe(1);
    expect(voucherSumPaise).toBe(0);

    // Cross-page derivation equality for SUB1
    expect(apStats.rebirthIds).toBe(cardRebirths.length);
    expect(apStats.vouchersPaise).toBe(voucherSumPaise);
  });

  test("Unified Wallet Isolation: Cash balance is shared across member, but Rebirth/Voucher stats remain strictly per-card", async () => {
    const walletResMain = await request(app)
      .get("/api/wallet/balance")
      .set("Authorization", `Bearer ${mainToken}`)
      .expect(200);

    const walletResSub = await request(app)
      .get("/api/wallet/balance")
      .set("Authorization", `Bearer ${sub1Token}`)
      .expect(200);

    // Unified wallet balance is identical across cards for same member
    expect(walletResMain.body.data.balancePaise).toBe(walletResSub.body.data.balancePaise);

    // But AutoPool reward metrics are strictly card-isolated
    const apMain = await request(app).get("/api/members/autopool-tree").set("Authorization", `Bearer ${mainToken}`);
    const apSub = await request(app).get("/api/members/autopool-tree").set("Authorization", `Bearer ${sub1Token}`);

    expect(apMain.body.data.myStats.rebirthIds).not.toBe(apSub.body.data.myStats.rebirthIds);
    expect(apMain.body.data.myStats.vouchersPaise).not.toBe(apSub.body.data.myStats.vouchersPaise);
  });
});
