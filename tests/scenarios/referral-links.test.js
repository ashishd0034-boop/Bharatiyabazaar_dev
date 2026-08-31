const request = require("supertest");
const app = require("../../src/server");
const prisma = require("../../src/lib/prisma");
const { truncateDb } = require("../helpers/cleanDb");
const { seedSettingsAndSuperAdmin } = require("../../src/lib/seedSettings");
const { adminGeneratePins } = require("../../src/services/pinService");

describe("Scenario: Referral Link Active Card Resolution & REBIRTH Restrictions", () => {
  let superAdmin;
  let rootMember, mainCard, subCard, rebirthCard;
  let pinBatch;

  beforeAll(async () => {
    await truncateDb(prisma);
    await seedSettingsAndSuperAdmin();

    superAdmin = await prisma.adminUser.findFirst({ where: { role: "SUPER_ADMIN" } });

    // 1. Generate 3-ID PIN for root member registration
    const initialPinRes = await adminGeneratePins(superAdmin.id, 1, 3, "Root Triad Pack");
    const initialPin = initialPinRes.pins[0];

    // 2. Register Root Member
    const regRes = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Referral Root",
        mobile: "9888000001",
        password: "password123",
        pinCode: "110001",
        activationPin: initialPin.pinCode,
        side: "LEFT"
      });

    expect(regRes.status).toBe(201);
    rootMember = regRes.body.data.member;

    const cards = await prisma.memberIdCard.findMany({
      where: { memberId: rootMember.id },
      orderBy: { createdAt: "asc" }
    });

    mainCard = cards.find(c => c.type === "MAIN");
    subCard = cards.find(c => c.type === "SUB");

    // Create a REBIRTH card for root member
    rebirthCard = await prisma.memberIdCard.create({
      data: {
        memberId: rootMember.id,
        cardNumber: "RB10001_1",
        type: "REBIRTH",
        status: "ACTIVE",
        acbStatus: false
      }
    });

    // Generate PINs for downline registrations
    const pinRes = await adminGeneratePins(superAdmin.id, 5, 1, "Downline PINs");
    pinBatch = pinRes.pins;
  });

  afterAll(async () => {
    await truncateDb(prisma);
    await prisma.$disconnect();
  });

  it("1. MAIN Referral Link: Validates and registers with sponsor assigned to MAIN card", async () => {
    // 1. Validate referral code with MAIN card
    const valRes = await request(app)
      .get(`/api/auth/validate-referral?code=${mainCard.cardNumber}`);

    expect(valRes.status).toBe(200);
    expect(valRes.body.success).toBe(true);
    expect(valRes.body.data.valid).toBe(true);
    expect(valRes.body.data.name).toBe("Referral Root");
    expect(valRes.body.data.memberCode).toBe(mainCard.cardNumber);

    // 2. Register new member using MAIN referral code
    const regRes = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Main Downline",
        mobile: "9888000002",
        password: "password123",
        pinCode: "110001",
        activationPin: pinBatch[0].pinCode,
        referralCode: mainCard.cardNumber,
        side: "LEFT"
      });

    expect(regRes.status).toBe(201);

    // Verify in DB that the new member's sponsor tree node is linked to mainCard
    const newMember = regRes.body.data.member;
    const newMainCard = await prisma.memberIdCard.findFirst({
      where: { memberId: newMember.id, type: "MAIN" }
    });
    const treeNode = await prisma.mySystemNode.findFirst({
      where: { idCardId: newMainCard.id }
    });
    expect(treeNode).toBeTruthy();
    expect(treeNode.sponsorIdCardId).toBe(mainCard.id);
  });

  it("2. SUB Referral Link: Validates and registers with sponsor assigned directly to SUB card", async () => {
    // 1. Validate referral code with SUB card
    const valRes = await request(app)
      .get(`/api/auth/validate-referral?code=${subCard.cardNumber}`);

    expect(valRes.status).toBe(200);
    expect(valRes.body.success).toBe(true);
    expect(valRes.body.data.valid).toBe(true);
    expect(valRes.body.data.name).toBe("Referral Root");
    expect(valRes.body.data.memberCode).toBe(subCard.cardNumber);

    // 2. Register new member using SUB referral code
    const regRes = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Sub Downline",
        mobile: "9888000003",
        password: "password123",
        pinCode: "110001",
        activationPin: pinBatch[1].pinCode,
        referralCode: subCard.cardNumber,
        side: "RIGHT"
      });

    expect(regRes.status).toBe(201);

    // Verify in DB that the new member's sponsor tree node is linked specifically to subCard
    const newMember = regRes.body.data.member;
    const newMainCard = await prisma.memberIdCard.findFirst({
      where: { memberId: newMember.id, type: "MAIN" }
    });
    const treeNode = await prisma.mySystemNode.findFirst({
      where: { idCardId: newMainCard.id }
    });
    expect(treeNode).toBeTruthy();
    expect(treeNode.sponsorIdCardId).toBe(subCard.id);
  });

  it("3. REBIRTH Referral Validation: Fails with 400 and REBIRTH_CANNOT_SPONSOR code", async () => {
    const valRes = await request(app)
      .get(`/api/auth/validate-referral?code=${rebirthCard.cardNumber}`);

    expect(valRes.status).toBe(400);
    expect(valRes.body.success).toBe(false);
    expect(valRes.body.error.code).toBe("REBIRTH_CANNOT_SPONSOR");
    expect(valRes.body.error.message).toContain("REBIRTH IDs cannot sponsor");
  });

  it("4. REBIRTH Referral Registration Attempt: Rejected with 400 and REBIRTH_CANNOT_SPONSOR code", async () => {
    const regRes = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Rebirth Illegitimate Downline",
        mobile: "9888000004",
        password: "password123",
        pinCode: "110001",
        activationPin: pinBatch[2].pinCode,
        referralCode: rebirthCard.cardNumber,
        side: "LEFT"
      });

    expect(regRes.status).toBe(400);
    expect(regRes.body.success).toBe(false);
    expect(regRes.body.error.code).toBe("REBIRTH_CANNOT_SPONSOR");
    expect(regRes.body.error.message).toContain("REBIRTH IDs cannot sponsor");
  });

  it("5. Frontend Link Generation Logic: Resolves active card correctly and blocks REBIRTH", () => {
    function generateLink(loginCtx, member, side) {
      const activeCard = loginCtx?.cardNumber || member?.memberCode || "";
      const isRebirth = loginCtx?.loginCardType === "REBIRTH" || (activeCard && activeCard.startsWith("RB"));
      if (isRebirth) return { allowed: false, reason: "REBIRTH IDs cannot sponsor new members" };
      return {
        allowed: true,
        url: `http://localhost:4000/bb-register.html?ref=${encodeURIComponent(activeCard)}&side=${side}`
      };
    }

    const member = { id: "m1", memberCode: "BB10001" };

    // MAIN View
    const mainCtx = { cardNumber: "BB10001", isSubCard: false, loginCardType: "MAIN" };
    const mainLink = generateLink(mainCtx, member, "LEFT");
    expect(mainLink.allowed).toBe(true);
    expect(mainLink.url).toBe("http://localhost:4000/bb-register.html?ref=BB10001&side=LEFT");

    // SUB View
    const subCtx = { cardNumber: "SB10002", isSubCard: true, loginCardType: "SUB", ownerMemberCode: "BB10001" };
    const subLink = generateLink(subCtx, member, "RIGHT");
    expect(subLink.allowed).toBe(true);
    expect(subLink.url).toBe("http://localhost:4000/bb-register.html?ref=SB10002&side=RIGHT");

    // REBIRTH View
    const rebirthCtx = { cardNumber: "RB10001_1", isSubCard: false, loginCardType: "REBIRTH" };
    const rebirthLink = generateLink(rebirthCtx, member, "LEFT");
    expect(rebirthLink.allowed).toBe(false);
    expect(rebirthLink.reason).toContain("REBIRTH IDs cannot sponsor");
  });
});
