const { truncateDb } = require("../helpers/cleanDb");
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
    await prisma.wallet.create({ data: { memberId: vendorMember.id, balancePaise: 0 } });

    vendor = await prisma.vendor.create({
      data: {
        memberId: vendorMember.id,
        businessName: "Test Store",
        category: "GROCERY",
        marginRatePct: 7.0, // 7% margin
        payoutMethod: "WALLET",
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
      await prisma.wallet.create({ data: { memberId: member.id, balancePaise: 0 } });
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

    // Create a referral bonus (should be swept)
    await prisma.commissionEntry.create({
      data: {
        idCardId: testMembers[1].idCard.id,
        stream: "VENDOR_REFERRAL_BONUS",
        level: 1,
        amountPaise: 3437, // 0.25% of 13750
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
    await truncateDb(prisma);
  }

  it("should process the settlement accurately and update wallets", async () => {
    const testMonday = new Date("2026-08-10T00:00:00.000Z");
    const result = await processWeeklySettlement(testMonday);
    
    // Total vendor settlements in this run = 1
    expect(result.totalEntries).toBe(1);

    // Verify Vendor Settlement Math
    const settlement = await prisma.vendorSettlement.findFirst({
      where: { vendorId: vendor.id }
    });

    expect(settlement).toBeDefined();
    expect(settlement.grossSalesPaise).toBe(1375000); // 13,750
    expect(settlement.marginPaise).toBe(96250); // 7% of 13,750 = 962.5
    expect(settlement.postMarginPaise).toBe(1278750); // 13750 - 962.5 = 12787.5
    
    // Admin charge on WALLET payout = 5% on post margin = 12787.5 * 5% = 639.375 -> 63937 paise
    // Volume discount = Tier 1 (0%) -> final admin charge = 63937 paise
    expect(settlement.adminChargePaise).toBe(63937);
    
    // Payout before TDS = 12787.5 - 639.375 = 12148.125 -> 1214813 paise
    // TDS under 194C = 0 (payout < ₹30k single and < ₹1L aggregate threshold)
    expect(settlement.tdsPaise).toBe(0);

    // Net payable = 12148.125 - 0 = 12148.125 -> 1214813 paise
    expect(settlement.netPayablePaise).toBe(1214813);

    // Verify Vendor Wallet is credited
    const vendorWallet = await prisma.wallet.findUnique({ where: { memberId: vendorMember.id }});
    expect(vendorWallet.balancePaise).toBe(1214813);

    // Verify Setu Kosh commission swept
    const commission = await prisma.commissionEntry.findFirst({ where: { idCardId: testMembers[2].idCard.id }});
    expect(commission.status).toBe("WITHDRAWABLE");
    const member2Wallet = await prisma.wallet.findUnique({ where: { memberId: testMembers[2].member.id }});
    expect(member2Wallet.balancePaise).toBe(2500);

    // Verify Referral bonus swept
    const bonus = await prisma.commissionEntry.findFirst({ where: { idCardId: testMembers[1].idCard.id, stream: "VENDOR_REFERRAL_BONUS" }});
    expect(bonus.status).toBe("WITHDRAWABLE");
    const member1Wallet = await prisma.wallet.findUnique({ where: { memberId: testMembers[1].member.id }});
    expect(member1Wallet.balancePaise).toBe(3437);
  });

  it("should fail gracefully and not process twice on the same runDate (Idempotency)", async () => {
    const testMonday = new Date("2026-08-10T00:00:00.000Z");
    
    const reRunResult = await processWeeklySettlement(testMonday);
    expect(reRunResult.alreadyRan).toBe(true);

    // Ensure wallet wasn't credited twice
    const vendorWallet = await prisma.wallet.findUnique({ where: { memberId: vendorMember.id }});
    expect(vendorWallet.balancePaise).toBe(1214813); // Should still be exactly one payout
  });
});
