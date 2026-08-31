const request = require("supertest");
const app = require("../../src/server");
const prisma = require("../../src/lib/prisma");
const { truncateDb } = require("../helpers/cleanDb");
const { seedSettingsAndSuperAdmin } = require("../../src/lib/seedSettings");
const { adminGeneratePins } = require("../../src/services/pinService");

describe("Scenario: Commission Card-Grouped Ordering & Card Details", () => {
  let superAdmin;
  let member, mainCard, subCard2, subCard3, rebirthCard;
  let mainToken, sub2Token;

  beforeAll(async () => {
    await truncateDb(prisma);
    await seedSettingsAndSuperAdmin();

    superAdmin = await prisma.adminUser.findFirst({ where: { role: "SUPER_ADMIN" } });

    // 1. Generate 3-ID PIN for member registration
    const pinRes = await adminGeneratePins(superAdmin.id, 1, 3, "Group Order Test");
    const pin = pinRes.pins[0];

    // 2. Register Member with 3 IDs (BB10001 MAIN, SB10002 SUB, SB10003 SUB)
    const regRes = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Group Order Member",
        mobile: "9888661234",
        password: "password123",
        pinCode: "110001",
        activationPin: pin.pinCode,
        side: "LEFT"
      });

    if (regRes.status !== 201) {
      console.error("Registration failed:", regRes.status, regRes.body);
    }
    expect(regRes.status).toBe(201);
    member = regRes.body.data.member;

    const cards = await prisma.memberIdCard.findMany({
      where: { memberId: member.id },
      orderBy: { createdAt: "asc" }
    });

    mainCard = cards.find(c => c.type === "MAIN");
    subCard2 = cards.find(c => c.cardNumber.endsWith("2") || (c.type === "SUB" && c.cardNumber.includes("2")));
    subCard3 = cards.find(c => c.cardNumber.endsWith("3") || (c.type === "SUB" && c.cardNumber.includes("3")));

    // Manually create a REBIRTH card for member
    rebirthCard = await prisma.memberIdCard.create({
      data: {
        memberId: member.id,
        cardNumber: "RB10001_1",
        type: "REBIRTH",
        status: "ACTIVE",
        acbStatus: false
      }
    });

    // Clear placement bonuses from registration so we can test with explicit timestamps
    await prisma.commissionEntry.deleteMany({
      where: { idCardId: { in: [mainCard.id, subCard2.id, subCard3.id, rebirthCard.id] } }
    });

    // 3. Create commissions with intentionally interleaved dates:
    // Day base: Now minus N days
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    // SB10002: Day 10 (newest overall) and Day 2 (older)
    await prisma.commissionEntry.create({
      data: {
        idCardId: subCard2.id,
        stream: "AUTOPOOL",
        level: 1,
        amountPaise: 30000,
        status: "WITHDRAWABLE",
        createdAt: new Date(now - 1 * day) // Day 10 (most recent)
      }
    });
    await prisma.commissionEntry.create({
      data: {
        idCardId: subCard2.id,
        stream: "MY_SYSTEM",
        level: 1,
        amountPaise: 30000,
        status: "WITHDRAWABLE",
        createdAt: new Date(now - 9 * day) // Day 2
      }
    });

    // BB10001 (MAIN): Day 8 and Day 4
    await prisma.commissionEntry.create({
      data: {
        idCardId: mainCard.id,
        stream: "AUTOPOOL",
        level: 1,
        amountPaise: 30000,
        status: "WITHDRAWABLE",
        createdAt: new Date(now - 3 * day) // Day 8
      }
    });
    await prisma.commissionEntry.create({
      data: {
        idCardId: mainCard.id,
        stream: "MY_SYSTEM",
        level: 1,
        amountPaise: 30000,
        status: "PENDING_7_DAY",
        createdAt: new Date(now - 7 * day) // Day 4
      }
    });

    // SB10003: Day 7
    await prisma.commissionEntry.create({
      data: {
        idCardId: subCard3.id,
        stream: "AUTOPOOL",
        level: 1,
        amountPaise: 30000,
        status: "WITHDRAWABLE",
        createdAt: new Date(now - 4 * day) // Day 7
      }
    });

    // RB10001_1: Day 9 and Day 1
    await prisma.commissionEntry.create({
      data: {
        idCardId: rebirthCard.id,
        stream: "AUTOPOOL",
        level: 1,
        amountPaise: 30000,
        status: "WITHDRAWABLE",
        createdAt: new Date(now - 2 * day) // Day 9
      }
    });
    await prisma.commissionEntry.create({
      data: {
        idCardId: rebirthCard.id,
        stream: "MY_SYSTEM",
        level: 1,
        amountPaise: 30000,
        status: "PENDING_7_DAY",
        createdAt: new Date(now - 10 * day) // Day 1
      }
    });

    // Login tokens
    const mainLogin = await request(app)
      .post("/api/auth/login")
      .send({ mobile: mainCard.cardNumber, password: "password123" });
    mainToken = mainLogin.body.data.token;

    const subLogin = await request(app)
      .post("/api/auth/login")
      .send({ mobile: subCard2.cardNumber, password: "password123" });
    sub2Token = subLogin.body.data.token;
  });

  afterAll(async () => {
    await truncateDb(prisma);
    await prisma.$disconnect();
  });

  it("1. Server-Side Card-Grouped Ordering: MAIN first, then SUB (asc), then REBIRTH (asc), newest within each card", async () => {
    const res = await request(app)
      .get("/api/wallet/commissions?limit=100")
      .set("Authorization", `Bearer ${mainToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const comms = res.body.data;
    expect(comms.length).toBe(7);

    // Verify all rows have cardNumber and cardType populated
    comms.forEach(c => {
      expect(c.cardNumber).toBeTruthy();
      expect(c.cardType).toBeTruthy();
    });

    // Assert exact order:
    // 0: BB10001 (MAIN) Day 8
    expect(comms[0].cardNumber).toBe(mainCard.cardNumber);
    expect(comms[0].cardType).toBe("MAIN");
    expect(comms[0].stream).toBe("AUTOPOOL");

    // 1: BB10001 (MAIN) Day 4
    expect(comms[1].cardNumber).toBe(mainCard.cardNumber);
    expect(comms[1].cardType).toBe("MAIN");
    expect(comms[1].stream).toBe("MY_SYSTEM");

    // 2: SB10002 (SUB) Day 10
    expect(comms[2].cardNumber).toBe(subCard2.cardNumber);
    expect(comms[2].cardType).toBe("SUB");
    expect(comms[2].stream).toBe("AUTOPOOL");

    // 3: SB10002 (SUB) Day 2
    expect(comms[3].cardNumber).toBe(subCard2.cardNumber);
    expect(comms[3].cardType).toBe("SUB");
    expect(comms[3].stream).toBe("MY_SYSTEM");

    // 4: SB10003 (SUB) Day 7
    expect(comms[4].cardNumber).toBe(subCard3.cardNumber);
    expect(comms[4].cardType).toBe("SUB");
    expect(comms[4].stream).toBe("AUTOPOOL");

    // 5: RB10001_1 (REBIRTH) Day 9
    expect(comms[5].cardNumber).toBe(rebirthCard.cardNumber);
    expect(comms[5].cardType).toBe("REBIRTH");
    expect(comms[5].stream).toBe("AUTOPOOL");

    // 6: RB10001_1 (REBIRTH) Day 1
    expect(comms[6].cardNumber).toBe(rebirthCard.cardNumber);
    expect(comms[6].cardType).toBe("REBIRTH");
    expect(comms[6].stream).toBe("MY_SYSTEM");
  });

  it("2. SUB Card Login Scope: Directly logged into SB10002 returns only SB10002's commissions in newest-first order", async () => {
    const res = await request(app)
      .get("/api/wallet/commissions?limit=100")
      .set("Authorization", `Bearer ${sub2Token}`);

    expect(res.status).toBe(200);
    const comms = res.body.data;
    expect(comms.length).toBe(2);

    expect(comms[0].cardNumber).toBe(subCard2.cardNumber);
    expect(comms[0].stream).toBe("AUTOPOOL"); // Day 10 (newer)

    expect(comms[1].cardNumber).toBe(subCard2.cardNumber);
    expect(comms[1].stream).toBe("MY_SYSTEM"); // Day 2 (older)
  });

  it("3. Stream & Status Filtering: Preserves card-grouped order", async () => {
    const res = await request(app)
      .get("/api/wallet/commissions?limit=100")
      .set("Authorization", `Bearer ${mainToken}`);

    const comms = res.body.data;

    // Filter by AUTOPOOL stream
    const autopoolComms = comms.filter(c => c.stream === "AUTOPOOL");
    expect(autopoolComms.length).toBe(4);
    expect(autopoolComms[0].cardNumber).toBe(mainCard.cardNumber);
    expect(autopoolComms[1].cardNumber).toBe(subCard2.cardNumber);
    expect(autopoolComms[2].cardNumber).toBe(subCard3.cardNumber);
    expect(autopoolComms[3].cardNumber).toBe(rebirthCard.cardNumber);

    // Filter by PENDING_7_DAY status
    const pendingComms = comms.filter(c => c.status === "PENDING_7_DAY");
    expect(pendingComms.length).toBe(2);
    expect(pendingComms[0].cardNumber).toBe(mainCard.cardNumber);
    expect(pendingComms[1].cardNumber).toBe(rebirthCard.cardNumber);
  });
});
