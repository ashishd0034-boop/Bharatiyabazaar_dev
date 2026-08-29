const request = require("supertest");
const app = require("../../src/server");
const prisma = require("../../src/lib/prisma");
const { truncateDb } = require("../helpers/cleanDb");
const { seedSettingsAndSuperAdmin } = require("../../src/lib/seedSettings");
const { run7DaySweep } = require("../../src/jobs/scheduler");

describe("Scenario: 7-Day Commission Maturity Pipeline", () => {
  let superAdmin;
  let memberWithAcb, cardWithAcb;
  let memberNoAcb, cardNoAcb;

  beforeAll(async () => {
    await truncateDb(prisma);
    await seedSettingsAndSuperAdmin();

    superAdmin = await prisma.adminUser.findFirst({ where: { role: "SUPER_ADMIN" } });

    // 1. Create Member 1 (with ACB = true)
    memberWithAcb = await prisma.member.create({
      data: {
        name: "Matured Member ACB",
        mobile: "9888100001",
        memberCode: "BB10001",
        passwordHash: "dummyHash",
        mainWallet: { create: { balancePaise: 0 } },
        idCards: {
          create: {
            cardNumber: "BB10001",
            type: "MAIN",
            acbStatus: true // ACB satisfied
          }
        }
      },
      include: { idCards: true, mainWallet: true }
    });
    cardWithAcb = memberWithAcb.idCards[0];

    // 2. Create Member 2 (without ACB = false)
    memberNoAcb = await prisma.member.create({
      data: {
        name: "Immature Member No ACB",
        mobile: "9888100002",
        memberCode: "BB10002",
        passwordHash: "dummyHash",
        mainWallet: { create: { balancePaise: 0 } },
        idCards: {
          create: {
            cardNumber: "BB10002",
            type: "MAIN",
            acbStatus: false // ACB not satisfied
          }
        }
      },
      include: { idCards: true, mainWallet: true }
    });
    cardNoAcb = memberNoAcb.idCards[0];
  });

  afterAll(async () => {
    await truncateDb(prisma);
    await prisma.$disconnect();
  });

  it("1. Pre-Maturity: PENDING_7_DAY commission (< 7 days old) remains pending and wallet balance unchanged", async () => {
    // Create commission with recent timestamp (e.g. 2 days ago)
    const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const comm = await prisma.commissionEntry.create({
      data: {
        idCardId: cardWithAcb.id,
        stream: "MY_SYSTEM",
        level: 1,
        amountPaise: 30000,
        status: "PENDING_7_DAY",
        createdAt: recentDate
      }
    });

    const processed = await run7DaySweep();
    expect(processed).toBe(0);

    // Verify status is still PENDING_7_DAY
    const updatedComm = await prisma.commissionEntry.findUnique({ where: { id: comm.id } });
    expect(updatedComm.status).toBe("PENDING_7_DAY");

    // Verify wallet is still 0
    const wallet = await prisma.wallet.findUnique({ where: { memberId: memberWithAcb.id } });
    expect(wallet.balancePaise).toBe(0);
  });

  it("2. Post-Maturity with ACB: Commission older than 7 days flips to WITHDRAWABLE and credits wallet", async () => {
    // Update commission createdAt to 8 days ago (overdue maturity)
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const comm = await prisma.commissionEntry.findFirst({
      where: { idCardId: cardWithAcb.id, status: "PENDING_7_DAY" }
    });

    await prisma.commissionEntry.update({
      where: { id: comm.id },
      data: { createdAt: eightDaysAgo }
    });

    const processed = await run7DaySweep();
    expect(processed).toBe(1);

    // Verify commission flipped to WITHDRAWABLE
    const updatedComm = await prisma.commissionEntry.findUnique({ where: { id: comm.id } });
    expect(updatedComm.status).toBe("WITHDRAWABLE");

    // Verify member wallet received exact credit (₹300 / 30,000 paise)
    const wallet = await prisma.wallet.findUnique({ where: { memberId: memberWithAcb.id } });
    expect(wallet.balancePaise).toBe(30000);

    // Verify ledger entry created
    const ledger = await prisma.ledgerEntry.findFirst({
      where: { walletId: wallet.id, referenceId: comm.id }
    });
    expect(ledger).toBeTruthy();
    expect(ledger.amountPaise).toBe(30000);
    expect(ledger.type).toBe("CREDIT");
  });

  it("3. Idempotency: Running the sweep again does NOT double-credit", async () => {
    const processed = await run7DaySweep();
    expect(processed).toBe(0);

    const wallet = await prisma.wallet.findUnique({ where: { memberId: memberWithAcb.id } });
    expect(wallet.balancePaise).toBe(30000); // Still exactly 30000
  });

  it("4. Post-Maturity without ACB: Commission older than 7 days flips to LOCKED_ACB", async () => {
    // Create an 8-day-old commission for member without ACB
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const comm = await prisma.commissionEntry.create({
      data: {
        idCardId: cardNoAcb.id,
        stream: "MY_SYSTEM",
        level: 1,
        amountPaise: 30000,
        status: "PENDING_7_DAY",
        createdAt: eightDaysAgo
      }
    });

    const processed = await run7DaySweep();
    expect(processed).toBe(1);

    // Verify status flipped to LOCKED_ACB (not WITHDRAWABLE)
    const updatedComm = await prisma.commissionEntry.findUnique({ where: { id: comm.id } });
    expect(updatedComm.status).toBe("LOCKED_ACB");

    // Verify wallet balance remains 0
    const wallet = await prisma.wallet.findUnique({ where: { memberId: memberNoAcb.id } });
    expect(wallet.balancePaise).toBe(0);
  });

  it("5. Financial Reconciliation: System-wide ledger remains 100% balanced", async () => {
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
