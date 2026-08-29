const request = require("supertest");
const app = require("../../src/server");
const prisma = require("../../src/lib/prisma");
const { truncateDb } = require("../helpers/cleanDb");
const { seedSettingsAndSuperAdmin } = require("../../src/lib/seedSettings");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

describe("Scenario: Admin PIN Generation Bootstrap (SUPER_ADMIN)", () => {
  const unique = Date.now().toString().slice(-6);
  let superAdmin, regularAdmin, member;
  let superAdminToken, regularAdminToken, memberToken;

  beforeAll(async () => {
    await truncateDb(prisma);
    await seedSettingsAndSuperAdmin();

    const passwordHash = await bcrypt.hash("AdminPass123!", 10);

    // 1. Super Admin
    superAdmin = await prisma.adminUser.findFirst({ where: { role: "SUPER_ADMIN" } });
    if (!superAdmin) {
      superAdmin = await prisma.adminUser.create({
        data: {
          email: "super_test@bb.test",
          name: "Super Tester",
          passwordHash,
          role: "SUPER_ADMIN"
        }
      });
    }

    superAdminToken = jwt.sign(
      { id: superAdmin.id, email: superAdmin.email, role: "SUPER_ADMIN", type: "ADMIN" },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    // 2. Regular Admin
    regularAdmin = await prisma.adminUser.create({
      data: {
        email: `regular_${unique}@bb.test`,
        name: "Regular Admin",
        passwordHash,
        role: "ADMIN"
      }
    });

    regularAdminToken = jwt.sign(
      { id: regularAdmin.id, email: regularAdmin.email, role: "ADMIN", type: "ADMIN" },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    // 3. Member
    member = await prisma.member.create({
      data: {
        memberCode: `BB${unique}`,
        name: "Test Member",
        mobile: `9777${unique}`,
        passwordHash,
        kycStatus: "VERIFIED",
        mainWallet: { create: { balancePaise: 0 } }
      }
    });

    const card = await prisma.memberIdCard.create({
      data: {
        memberId: member.id,
        cardNumber: `BB${unique}`,
        type: "MAIN",
        acbStatus: true
      }
    });

    memberToken = jwt.sign(
      { id: member.id, loginCardId: card.id, type: "MEMBER" },
      JWT_SECRET,
      { expiresIn: "1h" }
    );
  });

  afterAll(async () => {
    await truncateDb(prisma);
    await prisma.$disconnect();
  });

  it("1. RBAC: Should reject member tokens with 401 and regular ADMIN tokens with 403", async () => {
    // 1a. Member token (not an admin)
    const memberRes = await request(app)
      .post("/api/admin/pins/generate")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ count: 1, quantity: 1, reason: "Unauthorized attempt" });

    expect(memberRes.status).toBe(401);

    // 1b. Regular Admin token (only SUPER_ADMIN allowed)
    const adminRes = await request(app)
      .post("/api/admin/pins/generate")
      .set("Authorization", `Bearer ${regularAdminToken}`)
      .send({ count: 1, quantity: 1, reason: "Regular admin attempt" });

    expect(adminRes.status).toBe(403);
  });

  it("2. Validation: Should reject invalid counts, quantities (1-10 range), or missing reason", async () => {
    // 2a. Missing reason
    const resNoReason = await request(app)
      .post("/api/admin/pins/generate")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ count: 1, quantity: 1 });
    expect(resNoReason.status).toBe(400);

    // 2b. Quantity > 10
    const resOverQty = await request(app)
      .post("/api/admin/pins/generate")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ count: 1, quantity: 15, reason: "Too high quantity" });
    expect(resOverQty.status).toBe(400);

    // 2c. Quantity < 1
    const resZeroQty = await request(app)
      .post("/api/admin/pins/generate")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ count: 1, quantity: 0, reason: "Zero quantity" });
    expect(resZeroQty.status).toBe(400);

    // 2d. Batch count > 20
    const resOverCount = await request(app)
      .post("/api/admin/pins/generate")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ count: 50, quantity: 1, reason: "Too many in batch" });
    expect(resOverCount.status).toBe(400);
  });

  let generatedPinCode1ID;
  let generatedPinCode3ID;

  it("3. Generation: SUPER_ADMIN should successfully generate PINs across quantity range (1-10)", async () => {
    // 3a. Single 1-ID PIN (₹600)
    const res1 = await request(app)
      .post("/api/admin/pins/generate")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({
        count: 1,
        quantity: 1,
        reason: "Root sponsor bootstrap generation"
      });

    expect(res1.status).toBe(201);
    expect(res1.body.success).toBe(true);
    expect(res1.body.data.pins.length).toBe(1);
    expect(res1.body.data.pins[0].pricePaise).toBe(60000);
    expect(res1.body.data.pins[0].status).toBe("AVAILABLE");
    expect(res1.body.data.pins[0].issuanceType).toBe("ADMIN_ISSUED");

    generatedPinCode1ID = res1.body.data.pins[0].pinCode;

    // Verify DB state: purchasedByMemberId must be null (no wallet debit)
    const pin1InDb = await prisma.activationPin.findUnique({
      where: { pinCode: generatedPinCode1ID }
    });
    expect(pin1InDb.purchasedByMemberId).toBeNull();
    expect(pin1InDb.quantity).toBe(1);

    // 3b. Batch of 2 PINs with 3-ID capacity each (₹1,800)
    const res3 = await request(app)
      .post("/api/admin/pins/generate")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({
        count: 2,
        quantity: 3,
        reason: "3-ID pack bootstrap generation"
      });

    expect(res3.status).toBe(201);
    expect(res3.body.data.pins.length).toBe(2);
    expect(res3.body.data.pins[0].pricePaise).toBe(180000);
    expect(res3.body.data.pins[0].quantity).toBe(3);

    generatedPinCode3ID = res3.body.data.pins[0].pinCode;
  });

  it("4. AuditLog: Should synchronously record ADMIN_PIN_GENERATED audit log with metadata", async () => {
    const logs = await prisma.auditLog.findMany({
      where: {
        action: "ADMIN_PIN_GENERATED",
        actorType: "ADMIN"
      },
      orderBy: { createdAt: "desc" }
    });

    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(logs[0].actorId).toBe(superAdmin.id);
    expect(logs[0].metadata.reason).toBe("3-ID pack bootstrap generation");
    expect(logs[0].metadata.quantityPerPin).toBe(3);
    expect(logs[0].metadata.count).toBe(2);
  });

  let registeredMemberId;

  it("5. Redemption: Fresh member should successfully register using admin-generated PIN", async () => {
    const freshMobile = `9111${unique}`;
    const regRes = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Admin PIN Redeemed User",
        mobile: freshMobile,
        password: "Password123!",
        pinCode: "110001",
        activationPin: generatedPinCode1ID,
        sponsorCardNumber: member.memberCode,
        side: "RIGHT"
      });

    expect(regRes.status).toBe(201);
    expect(regRes.body.success).toBe(true);
    expect(regRes.body.data.member).toBeDefined();

    registeredMemberId = regRes.body.data.member.id;

    // Verify card is created
    const cards = await prisma.memberIdCard.findMany({
      where: { memberId: registeredMemberId }
    });
    expect(cards.length).toBe(1);
    expect(cards[0].type).toBe("MAIN");

    // Verify PIN is now marked REDEEMED with redeemer ID
    const pinAfterRedeem = await prisma.activationPin.findUnique({
      where: { pinCode: generatedPinCode1ID }
    });
    expect(pinAfterRedeem.status).toBe("REDEEMED");
    expect(pinAfterRedeem.redeemedByMemberId).toBe(registeredMemberId);
    expect(pinAfterRedeem.redeemedAt).not.toBeNull();
  });

  it("6. Double Redemption: Reusing already redeemed admin PIN must be rejected", async () => {
    const regResFail = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Fraudulent Reuser",
        mobile: `9222${unique}`,
        password: "Password123!",
        pinCode: "110001",
        activationPin: generatedPinCode1ID,
        sponsorCardNumber: member.memberCode,
        side: "LEFT"
      });

    expect(regResFail.status).toBe(400);
    expect(regResFail.body.success).toBe(false);
    expect(regResFail.body.error.code).toBe("PIN_ALREADY_REDEEMED");
  });
});
