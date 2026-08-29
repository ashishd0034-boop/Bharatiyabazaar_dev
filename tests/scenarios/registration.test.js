const { truncateDb } = require("../helpers/cleanDb");
const request = require("supertest");
const app = require("../../src/server");
const prisma = require("../../src/lib/prisma");
const walletService = require("../../src/services/walletService");

describe("Registration and Additional ID Purchase Flow", () => {
  const unique = Date.now().toString().slice(-6);
  let newMemberId;
  let newMemberToken;
  const testMobile = "8888" + unique;

  beforeAll(async () => {
    await truncateDb(prisma);
    const { seedSettingsAndSuperAdmin } = require("../../src/lib/seedSettings");
    await seedSettingsAndSuperAdmin();
  });

  afterAll(async () => {
    await truncateDb(prisma);
    await prisma.$disconnect();
  });

  it("should register a new member with MAIN ID card", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Registration Flow Tester",
        mobile: testMobile,
        password: "Password123",
        pinCode: "110001",
        side: "LEFT"
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.member).toBeDefined();
    expect(res.body.data.token).toBeDefined();

    newMemberId = res.body.data.member.id;
    newMemberToken = res.body.data.token;

    const cards = await prisma.memberIdCard.findMany({
      where: { memberId: newMemberId }
    });

    expect(cards.length).toBe(1);
    expect(cards[0].type).toBe("MAIN");
  });

  it("should reject purchasing additional IDs without wallet funds/PIN, then allow with wallet balance", async () => {
    // 1. Verify blocked without funds
    const failRes = await request(app)
      .post("/api/id-cards/purchase-additional")
      .set("Authorization", `Bearer ${newMemberToken}`)
      .send({ count: 2 });

    expect(failRes.status).toBe(400);
    expect(failRes.body.success).toBe(false);

    // 2. Fund member wallet via walletService
    await prisma.$transaction(async (tx) => {
      await walletService.credit(tx, newMemberId, 200000, "TEST_DEPOSIT", null, "Test deposit");
    });

    // 3. Purchase succeeds with wallet debit
    const subRes = await request(app)
      .post("/api/id-cards/purchase-additional")
      .set("Authorization", `Bearer ${newMemberToken}`)
      .send({ count: 2 });

    expect(subRes.status).toBe(200);
    expect(subRes.body.success).toBe(true);

    const cards = await prisma.memberIdCard.findMany({
      where: { memberId: newMemberId },
      orderBy: { createdAt: "asc" }
    });

    // 1 MAIN + 2 SUB = 3 cards total
    expect(cards.length).toBe(3);
    expect(cards[0].type).toBe("MAIN");
    expect(cards[1].type).toBe("SUB");
    expect(cards[2].type).toBe("SUB");

    const member = await prisma.member.findUnique({ where: { id: newMemberId } });
    expect(member.memberCode).toBe(cards[0].cardNumber); // memberCode === MAIN cardNumber
  });
});
