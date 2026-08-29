const { truncateDb } = require("../helpers/cleanDb");
const prisma = require("../../src/lib/prisma");
const { createMember } = require("../../src/services/memberService");
const { purchaseIds } = require("../../src/services/idCardService");
const { checkAndProcessRebirths } = require("../../src/services/rebirthService");
const { requestWithdrawal, processWithdrawal } = require("../../src/services/withdrawalService");
const { updateSetting } = require("../../src/services/adminService");
const walletService = require("../../src/services/walletService");

describe("Integration: Cross-Phase Interactions", () => {
  let superAdmin;

  beforeAll(async () => {
    await cleanDb();
    
    superAdmin = await prisma.adminUser.create({
      data: {
        email: "superadmin_cross@bb.test",
        name: "Super Admin",
        passwordHash: "hashed",
        role: "SUPER_ADMIN"
      }
    });
  });

  afterAll(async () => {
    await cleanDb();
    await prisma.$disconnect();
  });

  async function cleanDb() {
    await truncateDb(prisma);
  }

  it("Phase 4 + Phase 5: Rebirth ID commission can be withdrawn", async () => {
    const member = await createMember({
      name: "Rebirth Member",
      mobile: "9999999999",
      panNumber: "PANCARD001",
      kycStatus: "VERIFIED"
    });

    // Directly create a Rebirth ID since purchasing one manually isn't allowed
    const mainIdCard = await prisma.memberIdCard.create({
      data: {
        memberId: member.id,
        cardNumber: "M10001",
        type: "MAIN",
        acbStatus: true
      }
    });

    const rebirthIdCard = await prisma.memberIdCard.create({
      data: {
        memberId: member.id,
        cardNumber: "R10001",
        type: "REBIRTH"
      }
    });

    // Give some wallet balance to the member from Rebirth earnings
    await prisma.$transaction(async (tx) => {
      await walletService.credit(tx, member.id, 100000, "REBIRTH", null, "Rebirth earnings");
    });

    // Request withdrawal (Phase 5)
    const withdrawal = await requestWithdrawal(member.id, mainIdCard.id, "BANK", 50000); // withdraw 500 Rs
    expect(withdrawal.status).toBe("REQUESTED");

    const processed = await processWithdrawal(withdrawal.id, "APPROVE", superAdmin.id);
    expect(processed.status).toBe("COMPLETED");
    expect(processed.netPaise).toBeLessThan(50000); // Due to TDS/admin charge
  });

  it("Phase 8 + Phase 5: Dynamic TDS modification impacts next withdrawal", async () => {
    // 1. Check current math
    const member2 = await createMember({
      name: "Member Two",
      mobile: "8888888888",
      panNumber: "PANTWOTEST",
      kycStatus: "VERIFIED"
    });

    await prisma.$transaction(async (tx) => {
      await walletService.credit(tx, member2.id, 2100000, "COMMISSION", null, "Initial commission");
    });

    // 2. Admin raises TDS rate to 10%
    await updateSetting("TDS_194H_RATE", "10", superAdmin.id, "Testing dynamic TDS");

    const m2IdCard = await prisma.memberIdCard.create({
      data: {
        memberId: member2.id,
        cardNumber: "M10002",
        type: "MAIN",
        acbStatus: true
      }
    });

    // 3. Member requests withdrawal
    const withdrawal = await requestWithdrawal(member2.id, m2IdCard.id, "BANK", 2100000); // 21000 Rs
    const processed = await processWithdrawal(withdrawal.id, "APPROVE", superAdmin.id);
    
    // 21,000 Rs withdrawal. Threshold is 20,000 Rs. Taxable is 1000 Rs (100,000 paise).
    // TDS (10%) = 10,000 paise (100 Rs).
    // Post-TDS = 2,090,000. Admin (5%) = 104,500 paise (1045 Rs).
    // Net should be 2,100,000 - 10,000 - 209,000 = 1,881,000 Paise
    expect(processed.tdsPaise).toBe(10000); 
    expect(processed.adminChargePaise).toBe(209000); 
    expect(processed.netPaise).toBe(1881000); 
  });
});
