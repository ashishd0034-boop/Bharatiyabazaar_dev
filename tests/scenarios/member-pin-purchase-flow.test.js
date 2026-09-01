const request = require("supertest");
const app = require("../../src/server");
const prisma = require("../../src/lib/prisma");
const { truncateDb } = require("../helpers/cleanDb");
const { seedSettingsAndSuperAdmin } = require("../../src/lib/seedSettings");
const { adminGeneratePins } = require("../../src/services/pinService");
const walletService = require("../../src/core/services/wallet.service");
const jwt = require("jsonwebtoken");

describe("Member PIN Purchase & Admin PIN Mapping Contract", () => {
  let superAdmin;
  let adminToken;
  let member;
  let mainCard;
  let memberToken;

  beforeAll(async () => {
    await truncateDb(prisma);
    await seedSettingsAndSuperAdmin();

    superAdmin = await prisma.adminUser.findFirst({ where: { role: "SUPER_ADMIN" } });
    adminToken = jwt.sign(
      { id: superAdmin.id, role: superAdmin.role, type: "ADMIN" },
      process.env.JWT_SECRET || "default_jwt_secret_for_test",
      { expiresIn: "1h" }
    );

    // Generate initial Admin PIN to register member BB10001
    const pinRes = await adminGeneratePins(superAdmin.id, 1, 1, "Initial Member Registration PIN");
    const regPin = pinRes.pins[0].pinCode;

    // Register Member
    const regRes = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Bhura Member",
        mobile: "9876500001",
        password: "password123",
        activationPin: regPin,
        side: "LEFT"
      });
    expect(regRes.status).toBe(201);
    member = regRes.body.data.member;
    memberToken = regRes.body.data.token;

    mainCard = await prisma.memberIdCard.findFirst({
      where: { memberId: member.id, type: "MAIN" }
    });

    // Credit member wallet with ₹1400 (140,000 paise)
    await prisma.$transaction(async (tx) => {
      await walletService.credit(
        tx,
        member.id,
        140000,
        "MANUAL_CREDIT",
        "TEST_SEED_1400",
        "Initial seed balance for testing PIN purchase"
      );
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("1. Member wallet starts with ₹1400 balance", async () => {
    const balRes = await request(app)
      .get("/api/wallet/balance")
      .set("Authorization", `Bearer ${memberToken}`);

    expect(balRes.status).toBe(200);
    expect(balRes.body.success).toBe(true);
    expect(balRes.body.data.balancePaise).toBe(140000);
  });

  test("2. Member purchases 1-ID PIN for ₹600 → returns AVAILABLE PIN and debits wallet to ₹800", async () => {
    const buyRes = await request(app)
      .post("/api/pins/purchase")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ quantity: 1 });

    expect(buyRes.status).toBe(201);
    expect(buyRes.body.success).toBe(true);
    expect(buyRes.body.data).toBeDefined();
    expect(buyRes.body.data.pinCode).toMatch(/^PIN-[A-F0-9]{8}$/);
    expect(buyRes.body.data.quantity).toBe(1);
    expect(buyRes.body.data.pricePaise).toBe(60000);
    expect(buyRes.body.data.status).toBe("AVAILABLE");
    expect(buyRes.body.data.source).toBe("MEMBER_PURCHASED");

    // Check member wallet balance is exactly ₹800 (80,000 paise)
    const balRes = await request(app)
      .get("/api/wallet/balance")
      .set("Authorization", `Bearer ${memberToken}`);

    expect(balRes.status).toBe(200);
    expect(balRes.body.data.balancePaise).toBe(80000);
  });

  test("3. GET /api/pins/my-pins returns newly purchased PIN with AVAILABLE status", async () => {
    const pinsRes = await request(app)
      .get("/api/pins/my-pins")
      .set("Authorization", `Bearer ${memberToken}`);

    expect(pinsRes.status).toBe(200);
    expect(pinsRes.body.success).toBe(true);
    expect(Array.isArray(pinsRes.body.data)).toBe(true);
    expect(pinsRes.body.data.length).toBe(1);

    const purchasedPin = pinsRes.body.data[0];
    expect(purchasedPin.status).toBe("AVAILABLE");
    expect(purchasedPin.quantity).toBe(1);
    expect(purchasedPin.pricePaise).toBe(60000);
    expect(purchasedPin.source).toBe("MEMBER_PURCHASED");
    expect(purchasedPin.purchasedByMember.memberCode).toBe(member.memberCode);
  });

  test("4. GET /api/admin/pins lists both ADMIN_ISSUED and MEMBER_PURCHASED PINs with attribution", async () => {
    const adminPinsRes = await request(app)
      .get("/api/admin/pins")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(adminPinsRes.status).toBe(200);
    expect(adminPinsRes.body.success).toBe(true);
    expect(adminPinsRes.body.data.length).toBeGreaterThanOrEqual(2);

    const memberPurchasedPin = adminPinsRes.body.data.find(p => p.source === "MEMBER_PURCHASED");
    expect(memberPurchasedPin).toBeDefined();
    expect(memberPurchasedPin.purchasedByMember.memberCode).toBe(member.memberCode);
    expect(memberPurchasedPin.status).toBe("AVAILABLE");

    const adminIssuedPin = adminPinsRes.body.data.find(p => p.source === "ADMIN_ISSUED");
    expect(adminIssuedPin).toBeDefined();
    expect(adminIssuedPin.purchasedByMemberId).toBeNull();
  });

  test("5. GET /api/admin/pins with source filter isolates MEMBER_PURCHASED and ADMIN_ISSUED", async () => {
    const memberOnlyRes = await request(app)
      .get("/api/admin/pins?source=MEMBER_PURCHASED")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(memberOnlyRes.status).toBe(200);
    expect(memberOnlyRes.body.data.every(p => p.source === "MEMBER_PURCHASED")).toBe(true);

    const adminOnlyRes = await request(app)
      .get("/api/admin/pins?source=ADMIN_ISSUED")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(adminOnlyRes.status).toBe(200);
    expect(adminOnlyRes.body.data.every(p => p.source === "ADMIN_ISSUED")).toBe(true);
  });

  test("6. Audit log records PIN_PURCHASED action attributed to the member", async () => {
    const auditLogs = await prisma.auditLog.findMany({
      where: { action: "PIN_PURCHASED" }
    });

    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0].actorType).toBe("MEMBER");
    expect(auditLogs[0].actorId).toBe(member.id);
  });

  test("7. Accounting Invariant: Company Reserve credited ₹600 and Reconciliation report variance = 0", async () => {
    // Check company reserve wallet
    const companyWallet = await prisma.wallet.findFirst({
      where: { memberId: "COMPANY_WALLET" },
      include: { ledgerEntries: true }
    });

    expect(companyWallet).toBeDefined();
    const pinSaleEntry = companyWallet.ledgerEntries.find(e => e.source === "PIN_SALE");
    expect(pinSaleEntry).toBeDefined();
    expect(pinSaleEntry.amountPaise).toBe(60000);
    expect(pinSaleEntry.type).toBe("CREDIT");

    // Check admin reconciliation report
    const recRes = await request(app)
      .get("/api/admin/reports/reconciliation")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(recRes.status).toBe(200);
    expect(recRes.body.success).toBe(true);
    expect(recRes.body.data.variancePaise).toBe(0);
    expect(recRes.body.data.isReconciled).toBe(true);
    expect(recRes.body.data.totalDivergentWallets).toBe(0);
  });

  test("8. Insufficient funds rejection contract", async () => {
    // Member now has ₹800. Trying to buy 2 IDs (₹1200) must be rejected.
    const failRes = await request(app)
      .post("/api/pins/purchase")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ quantity: 2 });

    expect(failRes.status).toBe(400);
    expect(failRes.body.success).toBe(false);
    expect(failRes.body.error.code).toBe("INSUFFICIENT_FUNDS");

    // Balance remains unchanged at ₹800
    const balRes = await request(app)
      .get("/api/wallet/balance")
      .set("Authorization", `Bearer ${memberToken}`);

    expect(balRes.body.data.balancePaise).toBe(80000);
  });
});
