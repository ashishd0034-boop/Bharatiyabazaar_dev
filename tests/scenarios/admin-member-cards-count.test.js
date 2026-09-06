const request = require("supertest");
const app = require("../../src/server");
const prisma = require("../../src/lib/prisma");
const { truncateDb } = require("../helpers/cleanDb");
const { seedSettingsAndSuperAdmin } = require("../../src/lib/seedSettings");
const { purchaseIds } = require("../../src/services/idCardService");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

describe("Scenario: Admin Member Registry Cards Count Isolation Contract", () => {
  const unique = Date.now().toString().slice(-6);
  let adminToken;
  let memberA, memberB, memberC;

  beforeAll(async () => {
    await truncateDb(prisma);
    await seedSettingsAndSuperAdmin();

    const passwordHash = await bcrypt.hash("TestPass123!", 10);
    const adminPassHash = await bcrypt.hash("AdminSecretPass123!", 10);

    // 1. Admin setup
    const admin = await prisma.adminUser.create({
      data: {
        email: `admin_count_${unique}@bb.test`,
        name: "Admin Count Tester",
        passwordHash: adminPassHash,
        role: "ADMIN"
      }
    });

    adminToken = jwt.sign(
      { id: admin.id, email: admin.email, role: "ADMIN", type: "ADMIN" },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    // 2. Member A: Owns 3 cards (1 MAIN + 2 SUB), sponsors 4 referral members
    memberA = await prisma.member.create({
      data: {
        memberCode: `BB${unique}01`,
        name: "Dynamic Test Member A",
        mobile: `98${unique}01`,
        passwordHash,
        kycStatus: "APPROVED",
        mainWallet: { create: { balancePaise: 0 } }
      }
    });
    // Provision 3 owned cards for Member A (1 MAIN + 2 SUB)
    await purchaseIds(memberA.id, 3, null, null);

    const memberACards = await prisma.memberIdCard.findMany({ where: { memberId: memberA.id } });
    const memberAMainCard = memberACards.find(c => c.type === "MAIN");

    // Member A sponsors 4 downstream members
    for (let i = 1; i <= 4; i++) {
      const sponsoredMember = await prisma.member.create({
        data: {
          memberCode: `BB${unique}A${i}`,
          name: `Sponsored Referral A${i}`,
          mobile: `97${unique}${i}1`,
          passwordHash,
          kycStatus: "APPROVED",
          mainWallet: { create: { balancePaise: 0 } }
        }
      });
      await purchaseIds(sponsoredMember.id, 1, memberAMainCard.id, i % 2 === 0 ? "RIGHT" : "LEFT");
    }

    // Attach 2 dummy REBIRTH cards to Member A to simulate AutoPool downstream completions
    await prisma.memberIdCard.createMany({
      data: [
        {
          memberId: memberA.id,
          cardNumber: `RB${unique}91`,
          type: "REBIRTH",
          status: "ACTIVE",
          acbStatus: false
        },
        {
          memberId: memberA.id,
          cardNumber: `RB${unique}92`,
          type: "REBIRTH",
          status: "ACTIVE",
          acbStatus: false
        }
      ]
    });

    // 3. Member B: Owns 7 cards (1 MAIN + 6 SUB), sponsors 1 referral member
    memberB = await prisma.member.create({
      data: {
        memberCode: `BB${unique}02`,
        name: "Dynamic Test Member B",
        mobile: `98${unique}02`,
        passwordHash,
        kycStatus: "APPROVED",
        mainWallet: { create: { balancePaise: 0 } }
      }
    });
    await purchaseIds(memberB.id, 7, null, null);

    const memberBCards = await prisma.memberIdCard.findMany({ where: { memberId: memberB.id } });
    const memberBMainCard = memberBCards.find(c => c.type === "MAIN");

    // Member B sponsors 1 downstream member
    const sponsoredB1 = await prisma.member.create({
      data: {
        memberCode: `BB${unique}B1`,
        name: "Sponsored Referral B1",
        mobile: `97${unique}02`,
        passwordHash,
        kycStatus: "APPROVED",
        mainWallet: { create: { balancePaise: 0 } }
      }
    });
    await purchaseIds(sponsoredB1.id, 1, memberBMainCard.id, "LEFT");

    // 4. Member C: Owns 1 card (1 MAIN), 0 referrals
    memberC = await prisma.member.create({
      data: {
        memberCode: `BB${unique}03`,
        name: "Dynamic Test Member C",
        mobile: `98${unique}03`,
        passwordHash,
        kycStatus: "APPROVED",
        mainWallet: { create: { balancePaise: 0 } }
      }
    });
    await purchaseIds(memberC.id, 1, null, null);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("should return owned card count strictly excluding sponsored referrals and rebirth cards", async () => {
    const res = await request(app)
      .get("/api/admin/members")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const members = res.body.data.members;

    // Verify Member A: 3 owned cards (despite 4 sponsored referrals + 2 rebirth cards)
    const recA = members.find(m => m.id === memberA.id);
    expect(recA).toBeDefined();
    expect(recA.cardsCount).toBe(3);
    expect(recA.ownedCardsCount).toBe(3);
    expect(recA.rebirthCardsCount).toBe(2);

    // Verify Member B: 7 owned cards (despite 1 sponsored referral)
    const recB = members.find(m => m.id === memberB.id);
    expect(recB).toBeDefined();
    expect(recB.cardsCount).toBe(7);
    expect(recB.ownedCardsCount).toBe(7);
    expect(recB.rebirthCardsCount).toBe(0);

    // Verify Member C: 1 owned card (0 referrals)
    const recC = members.find(m => m.id === memberC.id);
    expect(recC).toBeDefined();
    expect(recC.cardsCount).toBe(1);
    expect(recC.ownedCardsCount).toBe(1);
    expect(recC.rebirthCardsCount).toBe(0);
  });
});
