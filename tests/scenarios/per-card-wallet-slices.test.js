const request = require("supertest");
const app = require("../../src/server");
const prisma = require("../../src/lib/prisma");
const { truncateDb } = require("../helpers/cleanDb");
const { seedSettingsAndSuperAdmin } = require("../../src/lib/seedSettings");
const { adminGeneratePins } = require("../../src/services/pinService");
const walletService = require("../../src/services/walletService");

describe("Scenario: Per-Card Wallet & Earnings Slices", () => {
  let superAdmin;
  let rootMember, rootMainCard, rootSubCard2, rootSubCard3;
  let rootMainToken, rootSub2Token;

  beforeAll(async () => {
    await truncateDb(prisma);
    await seedSettingsAndSuperAdmin();

    superAdmin = await prisma.adminUser.findFirst({ where: { role: "SUPER_ADMIN" } });

    // 1. Generate 3-ID PIN for root registration
    const pinRes = await adminGeneratePins(superAdmin.id, 1, 3, "Root Pioneer Registration");
    const pin = pinRes.pins[0];

    // 2. Register 3-ID Root Member
    const regRes = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Root Pioneer",
        mobile: "9888111111",
        password: "password123",
        pinCode: "110001",
        activationPin: pin.pinCode,
        side: "LEFT"
      });

    expect(regRes.status).toBe(201);
    rootMember = regRes.body.data.member;

    const cards = await prisma.memberIdCard.findMany({
      where: { memberId: rootMember.id },
      orderBy: { createdAt: "asc" }
    });

    rootMainCard = cards.find(c => c.type === "MAIN");
    rootSubCard2 = cards.find(c => c.cardNumber.endsWith("2") || (c.type === "SUB" && c.id !== cards[2]?.id));
    rootSubCard3 = cards.filter(c => c.type === "SUB")[1];

    // 3. Login as MAIN (BB10001)
    const mainLoginRes = await request(app)
      .post("/api/auth/login")
      .send({ mobile: rootMainCard.cardNumber, password: "password123" });
    rootMainToken = mainLoginRes.body.data.token;

    // 4. Login as SUB card (SB10002)
    const sub2LoginRes = await request(app)
      .post("/api/auth/login")
      .send({ mobile: rootSubCard2.cardNumber, password: "password123" });
    rootSub2Token = sub2LoginRes.body.data.token;
  });

  afterAll(async () => {
    await truncateDb(prisma);
    await prisma.$disconnect();
  });

  it("1. Fresh Registration Slice: SUB card (SB10002) view shows ₹0 balance / ₹0 earnings, while MAIN shows ₹300 placement bonus", async () => {
    // SUB Card (SB10002) view
    const subRes = await request(app)
      .get("/api/wallet/balance")
      .set("Authorization", `Bearer ${rootSub2Token}`);

    expect(subRes.status).toBe(200);
    expect(subRes.body.data.loginContext.isSubCard).toBe(true);
    expect(subRes.body.data.displayBalancePaise).toBe(0);
    expect(subRes.body.data.displayTotalEarningsPaise).toBe(0);
    expect(subRes.body.data.displayOnHoldPaise).toBe(0);
    // Unified wallet balance is ₹300 (30,000 paise)
    expect(subRes.body.data.unifiedWalletBalancePaise).toBe(30000);

    // MAIN Card (BB10001) view
    const mainRes = await request(app)
      .get("/api/wallet/balance")
      .set("Authorization", `Bearer ${rootMainToken}`);

    expect(mainRes.status).toBe(200);
    expect(mainRes.body.data.loginContext.isSubCard).toBe(false);
    expect(mainRes.body.data.displayBalancePaise).toBe(30000); // ₹300 placement bonus
    expect(mainRes.body.data.displayTotalEarningsPaise).toBe(30000);
    expect(mainRes.body.data.displayOnHoldPaise).toBe(0);
    expect(mainRes.body.data.unifiedWalletBalancePaise).toBe(30000);
  });

  it("2. Downline Attribution: Commissions generated under SB10002 appear in SB10002's slice", async () => {
    // Generate 1-ID PINs and register 2 downlines under SB10002
    const pinBatch = await adminGeneratePins(superAdmin.id, 2, 1, "Downlines under SB10002");

    // Downline 1 (LEFT of SB10002)
    const d1Res = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Downline One",
        mobile: "9888222221",
        password: "password123",
        pinCode: "110001",
        activationPin: pinBatch.pins[0].pinCode,
        referralCode: rootSubCard2.cardNumber,
        side: "LEFT"
      });
    expect(d1Res.status).toBe(201);

    // Downline 2 (RIGHT of SB10002)
    const d2Res = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Downline Two",
        mobile: "9888222222",
        password: "password123",
        pinCode: "110001",
        activationPin: pinBatch.pins[1].pinCode,
        referralCode: rootSubCard2.cardNumber,
        side: "RIGHT"
      });
    expect(d2Res.status).toBe(201);

    // SB10002 now has 2 direct sponsored referrals (ACB unlocked) and completed Level 1 MySystem -> ₹300
    const subRes = await request(app)
      .get("/api/wallet/balance")
      .set("Authorization", `Bearer ${rootSub2Token}`);

    expect(subRes.status).toBe(200);
    expect(subRes.body.data.displayBalancePaise).toBe(30000); // ₹300
    expect(subRes.body.data.displayTotalEarningsPaise).toBe(30000); // ₹300
    expect(subRes.body.data.unifiedWalletBalancePaise).toBe(60000); // ₹300 (MAIN) + ₹300 (SB2) = ₹600

    // MAIN Card view reflects the combined total of all cards
    const mainRes = await request(app)
      .get("/api/wallet/balance")
      .set("Authorization", `Bearer ${rootMainToken}`);

    expect(mainRes.status).toBe(200);
    expect(mainRes.body.data.displayBalancePaise).toBe(60000); // ₹600
    expect(mainRes.body.data.displayTotalEarningsPaise).toBe(60000); // ₹600
    expect(mainRes.body.data.unifiedWalletBalancePaise).toBe(60000);
  });

  it("3. Slice Parity & Member-Level Credits: ADMIN_ADJUSTMENT excluded from SUB slices, parity holds", async () => {
    // Perform an ADMIN_ADJUSTMENT (e.g. ₹500 / 50,000 paise) to the member wallet
    await prisma.$transaction(async (tx) => {
      await walletService.adjustBalance(
        tx,
        rootMember.id,
        50000,
        "Administrative Goodwill Credit",
        "ADMIN_TOPUP_500"
      );
    });

    // SUB Card view: still shows ONLY its own card's withdrawable earnings (₹300), not the administrative topup
    const subRes = await request(app)
      .get("/api/wallet/balance")
      .set("Authorization", `Bearer ${rootSub2Token}`);

    expect(subRes.body.data.displayBalancePaise).toBe(30000); // ₹300
    expect(subRes.body.data.unifiedWalletBalancePaise).toBe(110000); // ₹600 + ₹500 = ₹1100

    // MAIN Card view: shows full unified wallet (₹1100)
    const mainRes = await request(app)
      .get("/api/wallet/balance")
      .set("Authorization", `Bearer ${rootMainToken}`);

    expect(mainRes.body.data.displayBalancePaise).toBe(110000);
    expect(mainRes.body.data.unifiedWalletBalancePaise).toBe(110000);

    // Sum of per-card slices + member-level credits === unified wallet balance
    const breakdown = mainRes.body.data.breakdown;
    const sumOfCardSlices = breakdown.reduce((sum, b) => sum + b.withdrawablePaise, 0);
    const memberLevelCredits = mainRes.body.data.memberLevelCreditsPaise;

    expect(sumOfCardSlices + memberLevelCredits).toBe(mainRes.body.data.unifiedWalletBalancePaise);
    expect(sumOfCardSlices).toBe(60000); // ₹300 (MAIN) + ₹300 (SB2)
    expect(memberLevelCredits).toBe(50000); // ₹500 admin credit
    expect(mainRes.body.data.unifiedWalletBalancePaise).toBe(110000); // ₹1100
  });

  it("4. Financial Reconciliation: System-wide ledger remains 100% balanced", async () => {
    const adminLoginRes = await request(app)
      .post("/api/admin/login")
      .send({
        email: "admin@bharatiyabazaar.com",
        password: process.env.SUPERADMIN_PASSWORD || "Admin@123456"
      });
    const adminToken = adminLoginRes.body.data.token;

    const reportRes = await request(app)
      .get("/api/admin/reports/reconciliation")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(reportRes.status).toBe(200);
    expect(reportRes.body.data.isReconciled).toBe(true);
    expect(reportRes.body.data.variancePaise).toBe(0);
    expect(reportRes.body.data.divergences.length).toBe(0);
  });
});
