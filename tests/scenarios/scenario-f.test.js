const prisma = require("../../src/lib/prisma");
const { processWeeklySettlement } = require("../../src/services/settlementService");

describe("Scenario F: Vendor Settlement Engine", () => {
  let vendorMember, vendor, testMembers = [];

  beforeAll(async () => {
    // Setup test environment
    await cleanDb();

    // 1. Create a vendor
    vendorMember = await prisma.member.create({
      data: {
        name: "Vendor Owner",
        mobile: "8888888880",
        kycStatus: "VERIFIED",
        panNumber: "ABCDE1234F"
      }
    });

    vendor = await prisma.vendor.create({
      data: {
        memberId: vendorMember.id,
        businessName: "Test Store",
        category: "GROCERY",
        marginRatePct: 7.0, // 7% margin
        status: "VERIFIED"
      }
    });

    // 2. Create some purchasing members
    for (let i = 1; i <= 3; i++) {
      const member = await prisma.member.create({
        data: {
          name: `Purchaser ${i}`,
          mobile: `888888888${i}`,
          kycStatus: "VERIFIED"
        }
      });
      const idCard = await prisma.memberIdCard.create({
        data: {
          memberId: member.id,
          cardNumber: `F1000${i}`,
          type: "MAIN"
        }
      });
      testMembers.push({ member, idCard });
    }

    // Set a period for sales (previous week)
    const runDate = new Date(); // assume current time
    // Shift to a fixed Monday for testing
    // E.g. 2026-08-10 is a Monday
    const testMonday = new Date("2026-08-10T00:00:00.000Z");
    
    const periodEnd = new Date(testMonday);
    periodEnd.setMilliseconds(-1);
    
    // Create sales
    // Rs 13,750 gross sales total
    // We'll create one sale of Rs 13,750
    await prisma.vendorSale.create({
      data: {
        vendorId: vendor.id,
        memberId: testMembers[0].member.id,
        amountPaise: 1375000, // 13,750 * 100
        createdAt: new Date(testMonday.getTime() - 24 * 60 * 60 * 1000) // Sunday
      }
    });

    // Create a refunded sale (should be ignored)
    await prisma.vendorSale.create({
      data: {
        vendorId: vendor.id,
        memberId: testMembers[1].member.id,
        amountPaise: 500000, // 5,000 * 100
        status: "REFUNDED",
        createdAt: new Date(testMonday.getTime() - 48 * 60 * 60 * 1000) // Saturday
      }
    });

    // Create a PENDING_SETTLEMENT Setu Kosh commission
    await prisma.commissionEntry.create({
      data: {
        idCardId: testMembers[2].idCard.id,
        stream: "SETU_KOSH",
        level: 1,
        amountPaise: 2500, // Rs 25
        status: "PENDING_SETTLEMENT",
        createdAt: new Date(testMonday.getTime() - 24 * 60 * 60 * 1000)
      }
    });

    // Create a PENDING_SETTLEMENT Vendor Referral Bonus
    await prisma.vendorReferralBonus.create({
      data: {
        memberId: testMembers[1].member.id,
        referredVendorId: vendor.id,
        bonusPaise: 3437, // 0.25% of 13750
        status: "PENDING_SETTLEMENT",
        createdAt: new Date(testMonday.getTime() - 24 * 60 * 60 * 1000)
      }
    });

  });

  afterAll(async () => {
    await cleanDb();
    await prisma.$disconnect();
  });

  async function cleanDb() {
    await prisma.ledgerEntry.deleteMany({});
    await prisma.commissionEntry.deleteMany({});
    await prisma.vendorReferralBonus.deleteMany({});
    await prisma.vendorSettlement.deleteMany({});
    await prisma.vendorSale.deleteMany({});
    await prisma.wallet.deleteMany({});
    await prisma.memberIdCard.deleteMany({});
    await prisma.setuKoshCounter.deleteMany({});
    await prisma.vendor.deleteMany({});
    await prisma.member.deleteMany({});
    await prisma.settlementRun.deleteMany({});
  }

  it("should process the settlement accurately and update wallets", async () => {
    const testMonday = new Date("2026-08-10T00:00:00.000Z");
    const result = await processWeeklySettlement(testMonday);
    
    // Total entries: 1 vendor settlement + 1 commission + 1 referral bonus = 3
    expect(result.totalEntries).toBe(3);

    // Verify Vendor Settlement Math
    const settlement = await prisma.vendorSettlement.findFirst({
      where: { vendorId: vendor.id }
    });

    expect(settlement).toBeDefined();
    expect(settlement.grossSalesPaise).toBe(1375000); // 13,750
    expect(settlement.marginPaise).toBe(96250); // 7% of 13,750 = 962.5
    expect(settlement.postMarginPaise).toBe(1278750); // 13750 - 962.5 = 12787.5
    
    // Admin charge = 10% on post margin = 12787.5 * 10% = 1278.75
    // Volume discount = Tier 1 (0%) -> final admin charge = 1278.75
    expect(settlement.adminChargePaise).toBe(127875);
    
    // Payout before TDS = 12787.5 - 1278.75 = 11508.75
    // TDS = 1% on Gross (13,750) = 137.50
    expect(settlement.tdsPaise).toBe(13750);

    // Net payable = 11508.75 - 137.50 = 11371.25
    expect(settlement.netPayablePaise).toBe(1137125);

    // Verify Vendor Wallet is credited
    const vendorWallet = await prisma.wallet.findUnique({ where: { memberId: vendorMember.id }});
    expect(vendorWallet.balancePaise).toBe(1137125);

    // Verify Setu Kosh commission swept
    const commission = await prisma.commissionEntry.findFirst({ where: { idCardId: testMembers[2].idCard.id }});
    expect(commission.status).toBe("CONFIRMED");
    const member2Wallet = await prisma.wallet.findUnique({ where: { memberId: testMembers[2].member.id }});
    expect(member2Wallet.balancePaise).toBe(2500);

    // Verify Referral bonus swept
    const bonus = await prisma.vendorReferralBonus.findFirst({ where: { memberId: testMembers[1].member.id }});
    expect(bonus.status).toBe("CONFIRMED");
    const member1Wallet = await prisma.wallet.findUnique({ where: { memberId: testMembers[1].member.id }});
    expect(member1Wallet.balancePaise).toBe(3437);
  });

  it("should fail gracefully and not process twice on the same runDate (Idempotency)", async () => {
    const testMonday = new Date("2026-08-10T00:00:00.000Z");
    
    await expect(processWeeklySettlement(testMonday)).rejects.toThrow(
      "Settlement run for 2026-08-10T00:00:00.000Z is already in progress or completed."
    );

    // Ensure wallet wasn't credited twice
    const vendorWallet = await prisma.wallet.findUnique({ where: { memberId: vendorMember.id }});
    expect(vendorWallet.balancePaise).toBe(1137125); // Should still be exactly one payout
  });
});
