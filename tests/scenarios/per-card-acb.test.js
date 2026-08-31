const request = require("supertest");
const app = require("../../src/server");
const prisma = require("../../src/lib/prisma");
const { truncateDb } = require("../helpers/cleanDb");
const { seedSettingsAndSuperAdmin } = require("../../src/lib/seedSettings");
const { adminGeneratePins } = require("../../src/services/pinService");
const { run7DaySweep, runAcbSweep } = require("../../src/jobs/scheduler");
const commissionService = require("../../src/core/services/commission.service");
const acbService = require("../../src/core/services/acb.service");

describe("Scenario: Per-Card ACB Enforcement (MAIN + SUB Only, No Inheritance, REBIRTH Exempt)", () => {
  let superAdmin;
  let memberWithCards, mainCard, subCard, rebirthCard;
  let mainToken, subToken;

  beforeAll(async () => {
    await truncateDb(prisma);
    await seedSettingsAndSuperAdmin();

    superAdmin = await prisma.adminUser.findFirst({ where: { role: "SUPER_ADMIN" } });

    // 1. Generate 3-ID PIN
    const pinRes = await adminGeneratePins(superAdmin.id, 1, 3, "Triad Pack for ACB Test");
    const pin = pinRes.pins[0];

    // 2. Register Member with 3 IDs (BB10001 MAIN, SB10002 SUB, SB10003 SUB)
    const regRes = await request(app)
      .post("/api/auth/register")
      .send({
        name: "ACB Pioneer",
        mobile: "9888771234",
        password: "password123",
        pinCode: "110001",
        activationPin: pin.pinCode,
        side: "LEFT"
      });

    expect(regRes.status).toBe(201);
    const member = regRes.body.data.member;

    const cards = await prisma.memberIdCard.findMany({
      where: { memberId: member.id },
      orderBy: { createdAt: "asc" }
    });

    mainCard = cards.find(c => c.type === "MAIN");
    subCard = cards.find(c => c.type === "SUB");

    // Manually create a REBIRTH card for this member
    rebirthCard = await prisma.memberIdCard.create({
      data: {
        memberId: member.id,
        cardNumber: "RB10001_1",
        type: "REBIRTH",
        status: "ACTIVE",
        acbStatus: false
      }
    });

    // Explicitly set MAIN card ACB to TRUE (to test that SUB does NOT inherit it)
    await prisma.memberIdCard.update({
      where: { id: mainCard.id },
      data: { acbStatus: true, acbUnlockedAt: new Date() }
    });

    // Ensure SUB card ACB is FALSE
    await prisma.memberIdCard.update({
      where: { id: subCard.id },
      data: { acbStatus: false, acbUnlockedAt: null }
    });

    // Login tokens
    const mainLogin = await request(app)
      .post("/api/auth/login")
      .send({ mobile: mainCard.cardNumber, password: "password123" });
    expect(mainLogin.status).toBe(200);
    mainToken = mainLogin.body.data.token;

    const subLogin = await request(app)
      .post("/api/auth/login")
      .send({ mobile: subCard.cardNumber, password: "password123" });
    expect(subLogin.status).toBe(200);
    subToken = subLogin.body.data.token;
  });

  afterAll(async () => {
    await truncateDb(prisma);
    await prisma.$disconnect();
  });

  let subCommId;

  it("1. MAIN ACB does NOT unlock SUB card commission: AutoPool L1 on SUB becomes LOCKED_ACB, NOT withdrawable", async () => {
    // Record AutoPool Level 1 commission on SUB card (which has acbStatus = false)
    await commissionService.calculateAndCreateCommissions(prisma, subCard.id, 1, "AUTOPOOL", 30000);

    const comm = await prisma.commissionEntry.findFirst({
      where: { idCardId: subCard.id, stream: "AUTOPOOL", level: 1, amountPaise: 30000 }
    });

    expect(comm).toBeTruthy();
    subCommId = comm.id;
    // Invariant: Because subCard.acbStatus is false, status MUST be LOCKED_ACB (NO inheritance from MAIN)
    expect(comm.status).toBe("LOCKED_ACB");
    expect(comm.amountPaise).toBe(30000);

    // Verify SUB wallet display balance is 0 withdrawable
    const subWalletRes = await request(app)
      .get("/api/wallet/balance")
      .set("Authorization", `Bearer ${subToken}`);

    expect(subWalletRes.status).toBe(200);
    expect(subWalletRes.body.data.displayBalancePaise).toBe(0);
    expect(subWalletRes.body.data.displayOnHoldPaise).toBe(30000);
  });

  it("2. Time-Travel 7 Days: 7-day maturity sweep keeps SUB commission as LOCKED_ACB", async () => {
    // Age the SUB commission by 8 days
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await prisma.commissionEntry.update({
      where: { id: subCommId },
      data: { createdAt: eightDaysAgo }
    });

    // Run sweeps
    await run7DaySweep();
    await runAcbSweep();

    // Verify SUB commission is STILL LOCKED_ACB
    const comm = await prisma.commissionEntry.findUnique({
      where: { id: subCommId }
    });
    expect(comm.status).toBe("LOCKED_ACB");

    // Wallet balance remains uncredited for this locked commission
    const subWalletRes = await request(app)
      .get("/api/wallet/balance")
      .set("Authorization", `Bearer ${subToken}`);
    expect(subWalletRes.body.data.displayBalancePaise).toBe(0);
  });

  it("3. SUB achieves OWN ACB qualification: Unlocks ACB and flips LOCKED_ACB commission to WITHDRAWABLE", async () => {
    // Generate PINs and place 1 LEFT + 1 RIGHT direct referral sponsored by SUB card
    const pinBatch = await adminGeneratePins(superAdmin.id, 2, 1, "Directs for SUB card");

    // Left Referral
    const leftRes = await request(app)
      .post("/api/auth/register")
      .send({
        name: "SUB Left Referral",
        mobile: "9888999901",
        password: "password123",
        pinCode: "110001",
        activationPin: pinBatch.pins[0].pinCode,
        referralCode: subCard.cardNumber,
        side: "LEFT"
      });
    expect(leftRes.status).toBe(201);

    // Right Referral
    const rightRes = await request(app)
      .post("/api/auth/register")
      .send({
        name: "SUB Right Referral",
        mobile: "9888999902",
        password: "password123",
        pinCode: "110001",
        activationPin: pinBatch.pins[1].pinCode,
        referralCode: subCard.cardNumber,
        side: "RIGHT"
      });
    expect(rightRes.status).toBe(201);

    // Verify SUB card acbStatus is now TRUE
    const updatedSubCard = await prisma.memberIdCard.findUnique({
      where: { id: subCard.id }
    });
    expect(updatedSubCard.acbStatus).toBe(true);
    expect(updatedSubCard.acbUnlockedAt).toBeTruthy();

    // Verify previously LOCKED_ACB commission automatically flipped to WITHDRAWABLE
    const unlockedComm = await prisma.commissionEntry.findUnique({
      where: { id: subCommId }
    });
    expect(unlockedComm.status).toBe("WITHDRAWABLE");

    // Verify SUB card wallet view now shows withdrawable balance (₹300 / 30,000 paise from unlocked AutoPool L1)
    const subWalletRes = await request(app)
      .get("/api/wallet/balance")
      .set("Authorization", `Bearer ${subToken}`);
    expect(subWalletRes.status).toBe(200);
    expect(subWalletRes.body.data.displayBalancePaise).toBe(30000);
  });

  it("4. REBIRTH Card ACB Exemption: Earns commission with 7-day hold, sweep unlocks to WITHDRAWABLE without ACB", async () => {
    // Record MY_SYSTEM commission on REBIRTH card with 7-day hold
    await commissionService.calculateAndCreateCommissions(prisma, rebirthCard.id, 1, "MY_SYSTEM", 30000);

    const comm = await prisma.commissionEntry.findFirst({
      where: { idCardId: rebirthCard.id, stream: "MY_SYSTEM", level: 1 }
    });
    expect(comm).toBeTruthy();
    expect(comm.status).toBe("PENDING_7_DAY");

    // Age commission to 8 days ago
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await prisma.commissionEntry.update({
      where: { id: comm.id },
      data: { createdAt: eightDaysAgo }
    });

    // Run 7-day maturity sweep
    const processed = await run7DaySweep();
    expect(processed).toBeGreaterThanOrEqual(1);

    // REBIRTH card commission must become WITHDRAWABLE (ACB exempt)
    const maturedComm = await prisma.commissionEntry.findUnique({
      where: { id: comm.id }
    });
    expect(maturedComm.status).toBe("WITHDRAWABLE");
  });

  it("5. Dashboard API Contract: Returns cardType, acbStatus, and enriched commission metadata", async () => {
    const commissionsRes = await request(app)
      .get("/api/wallet/commissions")
      .set("Authorization", `Bearer ${mainToken}`);

    expect(commissionsRes.status).toBe(200);
    expect(Array.isArray(commissionsRes.body.data)).toBe(true);

    const comms = commissionsRes.body.data;
    const rebirthComm = comms.find(c => c.idCardId === rebirthCard.id);
    expect(rebirthComm).toBeTruthy();
    expect(rebirthComm.cardType).toBe("REBIRTH");

    const subComm = comms.find(c => c.idCardId === subCard.id);
    expect(subComm).toBeTruthy();
    expect(subComm.cardType).toBe("SUB");
    expect(subComm.cardAcbStatus).toBe(true);
  });

  it("6. Financial Reconciliation: Ledger variance is zero (Δ = 0)", async () => {
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
