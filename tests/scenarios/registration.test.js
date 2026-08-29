const request = require("supertest");
const app = require("../../src/server");
const prisma = require("../../src/lib/prisma");

describe("Regression Guard: Registration Flow with Multiple IDs", () => {
  let newMemberToken;
  let newMemberId;
  const testMobile = "8888" + Date.now().toString().slice(-6);

  beforeAll(async () => {
    await prisma.ledgerEntry.deleteMany({});
    await prisma.withdrawal.deleteMany({});
    await prisma.tdsLedger.deleteMany({});
    await prisma.commissionEntry.deleteMany({});
    await prisma.vendorReferralBonus.deleteMany({});
    await prisma.vendorSettlement.deleteMany({});
    await prisma.vendorSale.deleteMany({});
    await prisma.setuKoshNode.deleteMany({});
    await prisma.setuKoshCounter.deleteMany({});
    await prisma.payOnceLedger.deleteMany({});
    await prisma.autoPoolNode.deleteMany({});
    await prisma.mySystemNode.deleteMany({});
    await prisma.voucher.deleteMany({});
    await prisma.memberIdCard.deleteMany({});
    await prisma.vendor.deleteMany({});
    await prisma.wallet.deleteMany({});
    await prisma.member.deleteMany({});
    await prisma.systemCounter.deleteMany({});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("should register a member and buy exactly 1 MAIN ID initially", async () => {
    const regRes = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Regression Test User",
        mobile: testMobile,
        password: "password123"
      });

    expect(regRes.status).toBe(201);
    expect(regRes.body.success).toBe(true);
    expect(regRes.body.data.token).toBeDefined();

    newMemberToken = regRes.body.data.token;
    newMemberId = regRes.body.data.member.id;

    // Check DB for cards
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

    // 2. Fund member wallet
    await prisma.wallet.update({
      where: { memberId: newMemberId },
      data: { balancePaise: 200000 }
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
