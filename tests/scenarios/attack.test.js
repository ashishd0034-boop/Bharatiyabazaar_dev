const request = require("supertest");
const app = require("../../src/server");
const prisma = require("../../src/lib/prisma");

describe("Security: IDOR Prevention on /api/id-cards/purchase", () => {
  let attackerToken;
  let attackerId;
  let victimId;

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

    const uniqueSuffix = Date.now().toString().slice(-6);
    
    // Create Victim
    const victimRes = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Victim User",
        mobile: `9000${uniqueSuffix}`,
        password: "password123"
      });
    victimId = victimRes.body.data.member.id;

    // Create Attacker
    const attackerRes = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Attacker User",
        mobile: `9001${uniqueSuffix}`,
        password: "password123"
      });
    attackerId = attackerRes.body.data.member.id;
    attackerToken = attackerRes.body.data.token;

    // Fund attacker wallet for authorized purchase test
    await prisma.wallet.update({
      where: { memberId: attackerId },
      data: { balancePaise: 200000 }
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("should ignore memberId in body and place IDs on the authenticated user", async () => {
    const res = await request(app)
      .post("/api/id-cards/purchase")
      .set("Authorization", `Bearer ${attackerToken}`)
      .send({
        memberId: victimId, // Attacker tries to buy for victim
        count: 2
      });

    expect(res.status).toBe(201);

    // Verify IDs landed on ATTACKER's account, not victim's
    const attackerCards = await prisma.memberIdCard.findMany({
      where: { memberId: attackerId }
    });
    // 1 from registration + 2 from purchase
    expect(attackerCards.length).toBe(3);

    const victimCards = await prisma.memberIdCard.findMany({
      where: { memberId: victimId }
    });
    // 1 from registration only
    expect(victimCards.length).toBe(1);
  });
});
