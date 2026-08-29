const { truncateDb } = require("../helpers/cleanDb");
const request = require("supertest");
const app = require("../../src/server");
const prisma = require("../../src/lib/prisma");
const walletService = require("../../src/services/walletService");

describe("Security: IDOR Prevention on /api/id-cards/purchase", () => {
  let attackerToken;
  let attackerId;
  let victimId;

  beforeAll(async () => {
    await truncateDb(prisma);

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

    // Fund attacker wallet for authorized purchase test via walletService
    await prisma.$transaction(async (tx) => {
      await walletService.credit(tx, attackerId, 200000, "TEST_DEPOSIT", null, "Test deposit");
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
