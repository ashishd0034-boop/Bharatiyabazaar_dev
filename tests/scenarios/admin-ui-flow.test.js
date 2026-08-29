const { truncateDb } = require("../helpers/cleanDb");
const request = require("supertest");
const app = require("../../src/server");
const prisma = require("../../src/lib/prisma");
const { seedSettingsAndSuperAdmin } = require("../../src/lib/seedSettings");
const { processMemberPurchase } = require("../../src/services/vendorService");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "default_jwt_secret";

describe("Task 10B: Admin UI Integration & RBAC Flow Validation", () => {
  const unique = Date.now().toString().slice(-6);

  let superAdmin, regularAdmin;
  let superAdminToken, regularAdminToken;
  let memberToken, vendorToken;
  let testMember, testVendor;

  async function cleanDb() {
    await truncateDb(prisma);
  }

  beforeAll(async () => {
    await cleanDb();
    await seedSettingsAndSuperAdmin();

    // 1. Create SUPER_ADMIN
    const pwHash = await bcrypt.hash("SuperSecret123", 10);
    superAdmin = await prisma.adminUser.create({
      data: {
        name: `Super Admin ${unique}`,
        email: `superadmin_${unique}@bharatiyabazaar.com`,
        passwordHash: pwHash,
        role: "SUPER_ADMIN",
        status: "ACTIVE"
      }
    });

    // 2. Create regular ADMIN
    regularAdmin = await prisma.adminUser.create({
      data: {
        name: `Ops Admin ${unique}`,
        email: `admin_${unique}@bharatiyabazaar.com`,
        passwordHash: pwHash,
        role: "ADMIN",
        status: "ACTIVE"
      }
    });

    const walletService = require("../../src/services/walletService");

    // 3. Create Member & Vendor for cross-auth & operational testing
    testMember = await prisma.member.create({
      data: {
        name: `Member ${unique}`,
        mobile: `9444${unique}`,
        memberCode: `M444${unique}`,
        kycStatus: "VERIFIED",
        panNumber: "ABCDE1234F",
        mainWallet: {
          create: { balancePaise: 0 }
        }
      },
      include: { mainWallet: true }
    });

    await prisma.$transaction(async (tx) => {
      await walletService.credit(tx, testMember.id, 50000, "MEMBER_WALLET", null, "Initial member balance");
    });

    const idCard = await prisma.memberIdCard.create({
      data: {
        memberId: testMember.id,
        cardNumber: `CARD_${unique}`,
        type: "MAIN"
      }
    });

    await prisma.mySystemNode.create({
      data: {
        idCardId: idCard.id,
        placementType: "DIRECT"
      }
    });

    testVendor = await prisma.vendor.create({
      data: {
        memberId: testMember.id,
        businessName: `Test Mart ${unique}`,
        category: "ELECTRONICS",
        marginRatePct: 10.0, // Initial 10%
        status: "ACTIVE"
      }
    });

    // Generate tokens
    memberToken = jwt.sign(
      { id: testMember.id, loginCardId: idCard.id, type: "MEMBER" },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    vendorToken = jwt.sign(
      { id: testMember.id, vendorId: testVendor.id, type: "VENDOR" },
      JWT_SECRET,
      { expiresIn: "1d" }
    );
  });

  afterAll(async () => {
    await cleanDb();
    await prisma.$disconnect();
  });

  it("1. should authenticate admin users and issue role-bearing tokens", async () => {
    // 1A: Login as SUPER_ADMIN
    const resSuper = await request(app)
      .post("/api/admin/login")
      .send({
        email: superAdmin.email,
        password: "SuperSecret123"
      });

    expect(resSuper.status).toBe(200);
    expect(resSuper.body.success).toBe(true);
    expect(resSuper.body.data.token).toBeDefined();
    expect(resSuper.body.data.admin.role).toBe("SUPER_ADMIN");
    superAdminToken = resSuper.body.data.token;

    // 1B: Login as regular ADMIN
    const resAdmin = await request(app)
      .post("/api/admin/login")
      .send({
        email: regularAdmin.email,
        password: "SuperSecret123"
      });

    expect(resAdmin.status).toBe(200);
    expect(resAdmin.body.success).toBe(true);
    expect(resAdmin.body.data.token).toBeDefined();
    expect(resAdmin.body.data.admin.role).toBe("ADMIN");
    regularAdminToken = resAdmin.body.data.token;
  });

  it("2. should enforce cross-auth rejection between member/vendor tokens and admin routes", async () => {
    // 2A: Member token on /api/admin/dashboard-stats -> 401 Unauthorized
    const resMember = await request(app)
      .get("/api/admin/dashboard-stats")
      .set("Authorization", `Bearer ${memberToken}`);

    expect(resMember.status).toBe(401);
    expect(resMember.body.success).toBe(false);

    // 2B: Vendor token on /api/admin/dashboard-stats -> 401 Unauthorized
    const resVendor = await request(app)
      .get("/api/admin/dashboard-stats")
      .set("Authorization", `Bearer ${vendorToken}`);

    expect(resVendor.status).toBe(401);
    expect(resVendor.body.success).toBe(false);

    // 2C: Admin token on /api/admin/dashboard-stats -> 200 OK
    const resAdminOk = await request(app)
      .get("/api/admin/dashboard-stats")
      .set("Authorization", `Bearer ${regularAdminToken}`);

    expect(resAdminOk.status).toBe(200);
    expect(resAdminOk.body.success).toBe(true);
    expect(resAdminOk.body.data.totalMembers).toBeGreaterThanOrEqual(1);
  });

  it("3. should allow SUPER_ADMIN to update TDS settings with AuditLog and reject ADMIN with 403", async () => {
    // 3A: ADMIN attempts to update TDS_194H_RATE_VERIFIED -> 403 Forbidden
    const resForbidden = await request(app)
      .put("/api/admin/settings/TDS_194H_RATE_VERIFIED")
      .set("Authorization", `Bearer ${regularAdminToken}`)
      .send({ value: "4.0" });

    expect(resForbidden.status).toBe(403);
    expect(resForbidden.body.success).toBe(false);

    // 3B: SUPER_ADMIN updates TDS_194H_RATE_VERIFIED -> 200 OK
    const resAllowed = await request(app)
      .put("/api/admin/settings/TDS_194H_RATE_VERIFIED")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ value: "4.0", description: "Updated tax rate" });

    expect(resAllowed.status).toBe(200);
    expect(resAllowed.body.success).toBe(true);
    expect(resAllowed.body.data.value).toBe("4.0");

    // 3C: Verify immutable AuditLog was written
    const auditLogs = await prisma.auditLog.findMany({
      where: { action: "SETTINGS_UPDATED", entityType: "PlatformSetting" }
    });
    expect(auditLogs.length).toBeGreaterThanOrEqual(1);
    expect(auditLogs[0].actorId).toBe(superAdmin.id);
  });

  it("4. should apply category margin change with applyToExisting=true and reflect on existing vendor next sale", async () => {
    // 4A: ADMIN updates ELECTRONICS margin to 12.5% with applyToExisting: true
    const resMargin = await request(app)
      .put("/api/admin/categories/ELECTRONICS/margin")
      .set("Authorization", `Bearer ${regularAdminToken}`)
      .send({
        marginRatePct: 12.5,
        applyToExisting: true
      });

    expect(resMargin.status).toBe(200);
    expect(resMargin.body.success).toBe(true);
    expect(resMargin.body.data.updatedVendorsCount).toBeGreaterThanOrEqual(1);

    // 4B: Verify existing vendor record marginRatePct updated in DB
    const updatedVendor = await prisma.vendor.findUnique({
      where: { id: testVendor.id }
    });
    expect(updatedVendor.marginRatePct).toBe(12.5);

    // 4C: Record sale and verify 12.5% margin is deducted
    const saleResult = await processMemberPurchase(testMember.id, testVendor.id, 100000); // Rs. 1,000
    expect(saleResult.vendorSale.marginPaise).toBe(12500); // 12.5% of 100,000 = 12,500 paise
  });

  it("5. should verify financial reconciliation report with variance === 0 and queue reporting", async () => {
    // 5A: Financial Wallet vs Ledger reconciliation (SUPER_ADMIN only)
    const resForbidden = await request(app)
      .get("/api/admin/reports/reconciliation")
      .set("Authorization", `Bearer ${regularAdminToken}`);
    expect(resForbidden.status).toBe(403);

    const resRecon = await request(app)
      .get("/api/admin/reports/reconciliation")
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect(resRecon.status).toBe(200);
    expect(resRecon.body.success).toBe(true);
    expect(resRecon.body.data.variancePaise).toBe(0);
    expect(resRecon.body.data.isReconciled).toBe(true);

    // 5B: Create a REQUESTED withdrawal and verify it appears in withdrawals queue report
    const withdrawal = await prisma.withdrawal.create({
      data: {
        memberId: testMember.id,
        idCardId: (await prisma.memberIdCard.findFirst({ where: { memberId: testMember.id } })).id,
        method: "BANK",
        grossPaise: 50000,
        tdsPaise: 1500,
        adminChargePaise: 5000,
        netPaise: 43500,
        status: "REQUESTED"
      }
    });

    const resQueue = await request(app)
      .get("/api/admin/reports/withdrawals")
      .set("Authorization", `Bearer ${regularAdminToken}`);

    expect(resQueue.status).toBe(200);
    expect(resQueue.body.success).toBe(true);
    const found = resQueue.body.data.find(w => w.id === withdrawal.id);
    expect(found).toBeDefined();
    expect(found.status).toBe("REQUESTED");

    // 5C: Operational approve withdrawal by ADMIN
    const resApprove = await request(app)
      .post(`/api/admin/withdrawals/${withdrawal.id}/approve`)
      .set("Authorization", `Bearer ${regularAdminToken}`);

    expect(resApprove.status).toBe(200);
    expect(resApprove.body.success).toBe(true);
    expect(resApprove.body.data.status).toBe("COMPLETED");

    // 5D: TDS Statutory summary report
    const resTds = await request(app)
      .get("/api/admin/reports/tds-summary")
      .set("Authorization", `Bearer ${regularAdminToken}`);

    expect(resTds.status).toBe(200);
    expect(resTds.body.success).toBe(true);
    expect(resTds.body.data["194H"]).toBeDefined();
  });

  it("6. should allow SUPER_ADMIN to manage admin users and reject regular ADMIN", async () => {
    // 6A: Regular ADMIN attempts to list admin users -> 403 Forbidden
    const resListForbidden = await request(app)
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${regularAdminToken}`);

    expect(resListForbidden.status).toBe(403);

    // 6B: SUPER_ADMIN creates a new Admin User
    const resCreate = await request(app)
      .post("/api/admin/users")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({
        name: "Finance Officer",
        email: `finance_${unique}@bharatiyabazaar.com`,
        password: "FinancePassword123",
        role: "ADMIN"
      });

    expect(resCreate.status).toBe(201);
    expect(resCreate.body.success).toBe(true);
    expect(resCreate.body.data.role).toBe("ADMIN");

    // 6C: SUPER_ADMIN promotes user to SUPER_ADMIN
    const resPromote = await request(app)
      .put(`/api/admin/users/${resCreate.body.data.id}/role`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ role: "SUPER_ADMIN" });

    expect(resPromote.status).toBe(200);
    expect(resPromote.body.success).toBe(true);
    expect(resPromote.body.data.role).toBe("SUPER_ADMIN");
  });
});
