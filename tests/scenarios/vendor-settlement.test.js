const { truncateDb } = require("../helpers/cleanDb");
const prisma = require("../../src/lib/prisma");
const settlementService = require("../../src/services/settlementService");
const vendorService = require("../../src/services/vendorService");
const setuKoshService = require("../../src/services/setuKoshService");
const tdsService = require("../../src/services/tdsService");

describe("Wave 4: Vendor Settlement Engine Full Validation", () => {
  const unique = Date.now().toString().slice(-6);

  async function cleanDb() {
    await truncateDb(prisma);
  }

  beforeAll(async () => {
    await cleanDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ==========================================
  // T1: Reconciled Spec Formula Example
  // ==========================================
  describe("T1: Reconciled Spec Formula Example", () => {
    it("should calculate exact integer breakdown: Gross 13,750 @ 7% margin, 9% admin, 1% 194C TDS -> Net 1,152,027 paise (Rs. 11,520.27)", async () => {
      const vOwner = await prisma.member.create({
        data: {
          name: `Vendor Owner T1 ${unique}`,
          mobile: `9801${unique}`,
          pinCode: "110001",
          status: "ACTIVE",
          panVerified: true
        }
      });

      const vendor = await prisma.vendor.create({
        data: {
          memberId: vOwner.id,
          businessName: "T1 Superstore",
          category: "GROCERY",
          marginRatePct: 7.0,
          status: "ACTIVE",
          payoutMethod: "BANK"
        }
      });

      // Prior settlement of > 1L to ensure 1% 194C applies to entire payout
      const now = new Date();
      await prisma.vendorSettlement.create({
        data: {
          vendorId: vendor.id,
          grossSalesPaise: 15000000,
          payoutBeforeTdsPaise: 12000000,
          marginPaise: 1050000,
          postMarginPaise: 13950000,
          adminChargePaise: 1255500,
          tdsPaise: 120000,
          netPayablePaise: 11880000,
          status: "COMPLETED",
          periodStart: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
          periodEnd: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
          settledAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        }
      });

      // Sales for current settlement: Rs. 13,750 = 1,375,000 paise
      const sales = [
        { amountPaise: 1375000, marginPaise: 96250 }
      ];

      const breakdown = await settlementService.calculateSettlementBreakdown(prisma, sales, vendor, {
        isEarly: false,
        periodEnd: now,
        adminRatePctOverride: 9 // 9% admin charge per spec reconciled example
      });

      expect(breakdown.grossSalesPaise).toBe(1375000);
      expect(breakdown.marginPaise).toBe(96250);
      expect(breakdown.postMarginPaise).toBe(1278750);
      expect(breakdown.baseAdminChargePaise).toBe(115087);
      expect(breakdown.netAdminChargePaise).toBe(115087);
      expect(breakdown.payoutBeforeTdsPaise).toBe(1163663);
      expect(breakdown.tdsPaise).toBe(11636); // 1% on 1,163,663
      expect(breakdown.netPayablePaise).toBe(1152027); // Exactly Rs. 11,520.27
    });
  });

  // ==========================================
  // T2: Volume Discount on Admin Charge ONLY
  // ==========================================
  describe("T2: Volume Discount on Admin Charge", () => {
    it("should discount admin charge by 10% for Rs. 60,000 monthly sales while keeping margin untouched", async () => {
      const vOwner = await prisma.member.create({
        data: {
          name: `Vendor Owner T2 ${unique}`,
          mobile: `9802${unique}`,
          status: "ACTIVE",
          panVerified: true
        }
      });

      const vendor = await prisma.vendor.create({
        data: {
          memberId: vOwner.id,
          businessName: "T2 Electronics",
          category: "ELECTRONICS",
          marginRatePct: 10.0,
          status: "ACTIVE",
          payoutMethod: "BANK"
        }
      });

      const now = new Date();
      // Create sales in current calendar month totaling Rs. 60,000 (6,000,000 paise) -> 10% tier
      await prisma.vendorSale.create({
        data: {
          vendorId: vendor.id,
          memberId: vOwner.id,
          amountPaise: 6000000,
          marginPaise: 600000,
          status: "COMPLETED",
          createdAt: now
        }
      });

      const currentSales = [{ amountPaise: 6000000, marginPaise: 600000 }];

      const breakdown = await settlementService.calculateSettlementBreakdown(prisma, currentSales, vendor, {
        isEarly: false,
        periodEnd: now,
        adminRatePctOverride: 10
      });

      expect(breakdown.grossSalesPaise).toBe(6000000);
      expect(breakdown.marginPaise).toBe(600000); // 10% margin untouched
      expect(breakdown.postMarginPaise).toBe(5400000);
      expect(breakdown.baseAdminChargePaise).toBe(540000); // 10% on 5,400,000
      expect(breakdown.volumeDiscountPct).toBe(10); // 10% tier
      expect(breakdown.volumeDiscountPaise).toBe(54000); // 10% of 540,000
      expect(breakdown.netAdminChargePaise).toBe(486000); // 540,000 - 54,000
    });
  });

  // ==========================================
  // T3: Early Settlement
  // ==========================================
  describe("T3: Early Settlement", () => {
    it("should deduct flat Rs. 250 fee, mark SettlementRun EARLY, and release NO member commissions", async () => {
      const vOwner = await prisma.member.create({
        data: {
          name: `Vendor Owner T3 ${unique}`,
          mobile: `9803${unique}`,
          status: "ACTIVE",
          panVerified: true
        }
      });

      const vendor = await prisma.vendor.create({
        data: {
          memberId: vOwner.id,
          businessName: "T3 Fast Payouts",
          category: "GROCERY",
          marginRatePct: 7.0,
          status: "ACTIVE",
          payoutMethod: "WALLET"
        }
      });

      // Create an unsettled sale
      await prisma.vendorSale.create({
        data: {
          vendorId: vendor.id,
          memberId: vOwner.id,
          amountPaise: 200000, // Rs. 2,000
          marginPaise: 14000,
          status: "COMPLETED"
        }
      });

      // Create a dummy PENDING_SETTLEMENT member commission
      const dummyCard = await prisma.memberIdCard.create({
        data: { memberId: vOwner.id, cardNumber: `BB83${unique}`, type: "MAIN" }
      });

      const pendingComm = await prisma.commissionEntry.create({
        data: {
          idCardId: dummyCard.id,
          stream: "SETU_KOSH",
          level: 1,
          amountPaise: 500,
          status: "PENDING_SETTLEMENT"
        }
      });

      // Execute Early Settlement
      const settlement = await settlementService.processEarlySettlement(vendor.id, {
        adminRatePctOverride: 5
      });

      expect(settlement.earlyFeePaise).toBe(25000); // Rs. 250 fee deducted
      expect(settlement.status).toBe("COMPLETED");

      const run = await prisma.settlementRun.findUnique({
        where: { id: settlement.settlementRunId }
      });
      expect(run.runType).toBe("EARLY");

      // Verify that member commission was NOT released (remains PENDING_SETTLEMENT)
      const commAfter = await prisma.commissionEntry.findUnique({
        where: { id: pendingComm.id }
      });
      expect(commAfter.status).toBe("PENDING_SETTLEMENT");
    });
  });

  // ==========================================
  // T4: 194C Marginal Aggregate Crossing
  // ==========================================
  describe("T4: 194C Marginal Aggregate Crossing", () => {
    it("should apply 1% TDS only to excess when FY aggregate crosses Rs. 1,00,000 mid-settlement", async () => {
      const vOwner = await prisma.member.create({
        data: {
          name: `Vendor Owner T4 ${unique}`,
          mobile: `9804${unique}`,
          status: "ACTIVE",
          panVerified: true
        }
      });

      const vendor = await prisma.vendor.create({
        data: {
          memberId: vOwner.id,
          businessName: "T4 Threshold Store",
          category: "SERVICES",
          marginRatePct: 0,
          status: "ACTIVE",
          payoutMethod: "BANK"
        }
      });

      const now = new Date();
      // Prior FY settlement of Rs. 90,000 (9,000,000 paise < 10,000,000 threshold)
      await prisma.vendorSettlement.create({
        data: {
          vendorId: vendor.id,
          grossSalesPaise: 9000000,
          payoutBeforeTdsPaise: 9000000,
          marginPaise: 0,
          postMarginPaise: 9000000,
          adminChargePaise: 0,
          tdsPaise: 0,
          netPayablePaise: 9000000,
          status: "COMPLETED",
          periodStart: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
          periodEnd: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
          settledAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        }
      });

      // Current payout: Rs. 20,000 (2,000,000 paise). Total aggregate becomes Rs. 1,10,000 (> 1L threshold).
      // Excess above 1L is Rs. 10,000 (1,000,000 paise).
      // 1% TDS on 1,000,000 = 10,000 paise.
      const currentSales = [{ amountPaise: 2000000, marginPaise: 0 }];

      const breakdown = await settlementService.calculateSettlementBreakdown(prisma, currentSales, vendor, {
        isEarly: false,
        periodEnd: now,
        adminRatePctOverride: 0
      });

      expect(breakdown.payoutBeforeTdsPaise).toBe(2000000);
      expect(breakdown.tdsPaise).toBe(10000); // 1% on 1,000,000 excess
      expect(breakdown.netPayablePaise).toBe(1990000);
    });
  });

  // ==========================================
  // T5: Referral Bonus Lifetime
  // ==========================================
  describe("T5: Referral Bonus Lifetime", () => {
    it("should award 0.25% referral bonus across multiple settlement periods to the permanently bound referrer", async () => {
      const refMember = await prisma.member.create({
        data: {
          name: `Referrer ${unique}`,
          mobile: `9805${unique}`,
          status: "ACTIVE"
        }
      });

      const refCard = await prisma.memberIdCard.create({
        data: { memberId: refMember.id, cardNumber: `BB85${unique}`, type: "MAIN" }
      });

      await prisma.mySystemNode.create({
        data: { idCardId: refCard.id, placementType: "ROOT" }
      });

      const vOwner = await prisma.member.create({
        data: { name: `Referred Vendor Owner ${unique}`, mobile: `9806${unique}`, status: "ACTIVE" }
      });

      const vendor = await vendorService.registerVendor({
        memberId: vOwner.id,
        businessName: "Lifetime Referral Store",
        category: "GROCERY",
        marginRatePct: 7.0,
        referredByMemberId: refMember.id
      });

      const buyer = await prisma.member.create({
        data: { name: `Buyer T5 ${unique}`, mobile: `9807${unique}`, status: "ACTIVE", pinCode: "110001" }
      });

      const buyerCard = await prisma.memberIdCard.create({
        data: { memberId: buyer.id, cardNumber: `BB87${unique}`, type: "MAIN" }
      });

      await prisma.mySystemNode.create({
        data: { idCardId: buyerCard.id, sponsorIdCardId: refCard.id, placementType: "SPONSOR" }
      });

      // Period 1 Sale: Rs. 1,000 (100,000 paise) -> 250 bonus
      await setuKoshService.recordPurchase(buyer.id, vendor.id, 100000, { idCardId: buyerCard.id, bypassPinCheck: true });

      // Period 2 Sale: Rs. 2,000 (200,000 paise) -> 500 bonus
      await setuKoshService.recordPurchase(buyer.id, vendor.id, 200000, { idCardId: buyerCard.id, bypassPinCheck: true });

      const bonuses = await prisma.commissionEntry.findMany({
        where: { idCardId: refCard.id, stream: "VENDOR_REFERRAL_BONUS" }
      });

      expect(bonuses).toHaveLength(2);
      expect(bonuses[0].amountPaise).toBe(250);
      expect(bonuses[1].amountPaise).toBe(500);
      expect(bonuses[0].status).toBe("PENDING_SETTLEMENT");
    });
  });

  // ==========================================
  // T6: Inactivity Lifecycle
  // ==========================================
  describe("T6: Inactivity Lifecycle", () => {
    it("should transition vendors at 31d (INACTIVE), 91d (FROZEN), and 181d (CLOSED with stream redirection)", async () => {
      const now = new Date();

      // Vendor 1: 35 days inactive -> INACTIVE
      const v1 = await prisma.vendor.create({
        data: {
          memberId: (await prisma.member.create({ data: { name: `V1 ${unique}`, mobile: `9811${unique}`, status: "ACTIVE" } })).id,
          businessName: "Vendor 31d",
          category: "GENERAL",
          marginRatePct: 10,
          status: "ACTIVE",
          lastSaleAt: new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000)
        }
      });

      // Vendor 2: 95 days inactive -> FROZEN
      const v2 = await prisma.vendor.create({
        data: {
          memberId: (await prisma.member.create({ data: { name: `V2 ${unique}`, mobile: `9812${unique}`, status: "ACTIVE" } })).id,
          businessName: "Vendor 91d",
          category: "GENERAL",
          marginRatePct: 10,
          status: "ACTIVE",
          lastSaleAt: new Date(now.getTime() - 95 * 24 * 60 * 60 * 1000)
        }
      });

      // Vendor 3: 185 days inactive -> CLOSED
      const v3 = await prisma.vendor.create({
        data: {
          memberId: (await prisma.member.create({ data: { name: `V3 ${unique}`, mobile: `9813${unique}`, status: "ACTIVE" } })).id,
          businessName: "Vendor 181d",
          category: "GENERAL",
          marginRatePct: 10,
          status: "ACTIVE",
          lastSaleAt: new Date(now.getTime() - 185 * 24 * 60 * 60 * 1000)
        }
      });

      // Pending bonus under V3
      const bonus = await prisma.vendorReferralBonus.create({
        data: {
          memberId: v3.memberId,
          referredVendorId: v3.id,
          bonusPaise: 1000,
          status: "PENDING"
        }
      });

      // Run daily sweep
      await settlementService.sweepVendorInactivity(now);

      const v1After = await prisma.vendor.findUnique({ where: { id: v1.id } });
      const v2After = await prisma.vendor.findUnique({ where: { id: v2.id } });
      const v3After = await prisma.vendor.findUnique({ where: { id: v3.id } });

      expect(v1After.status).toBe("INACTIVE");
      expect(v2After.status).toBe("FROZEN");
      expect(v2After.isDepositFrozen).toBe(true);
      expect(v3After.status).toBe("CLOSED");

      // Verify stream redirection to COMPANY_WALLET
      const bonusAfter = await prisma.vendorReferralBonus.findUnique({ where: { id: bonus.id } });
      expect(bonusAfter.memberId).toBe("COMPANY_WALLET");
    });
  });

  // ==========================================
  // T7: Fraud Penalties
  // ==========================================
  describe("T7: Fraud Penalties & Recovery Order", () => {
    it("should apply 10x penalty for FRAUD, cover member commissions from deposit first, and record AuditLog", async () => {
      const vOwner = await prisma.member.create({
        data: { name: `Fraud Vendor ${unique}`, mobile: `9814${unique}`, status: "ACTIVE" }
      });

      const vendor = await prisma.vendor.create({
        data: {
          memberId: vOwner.id,
          businessName: "Fraudulent Store",
          category: "GENERAL",
          marginRatePct: 10,
          status: "ACTIVE",
          securityDepositPaise: 500000 // Rs. 5,000
        }
      });

      // Pending member commission of Rs. 1,000 (100,000 paise)
      const mCard = await prisma.memberIdCard.create({
        data: { memberId: vOwner.id, cardNumber: `BB89${unique}`, type: "MAIN" }
      });

      await prisma.commissionEntry.create({
        data: {
          idCardId: mCard.id,
          stream: "SETU_KOSH",
          level: 1,
          amountPaise: 100000,
          status: "PENDING_SETTLEMENT"
        }
      });

      // Apply FRAUD penalty on transaction value Rs. 300 (30,000 paise) -> 10x = 300,000 paise
      const res = await settlementService.penalizeVendor(vendor.id, "FRAUD", 30000, "ADMIN_TEST");

      expect(res.penaltyPaise).toBe(300000); // 10x
      expect(res.memberCommissionsCovered).toBe(100000); // Rs. 1,000 covered
      expect(res.penaltyDeducted).toBe(300000); // Remaining 400k deposit covers 300k penalty
      expect(res.remainingDepositPaise).toBe(100000); // 500k - 100k - 300k = 100k
      expect(res.vendor.status).toBe("CLOSED");

      // AuditLog entry
      const audit = await prisma.auditLog.findFirst({
        where: { entityId: vendor.id, action: "VENDOR_PENALTY_FRAUD" }
      });
      expect(audit).not.toBeNull();
    });
  });

  // ==========================================
  // T8: Settlement Idempotency
  // ==========================================
  describe("T8: Settlement Idempotency", () => {
    it("should prevent duplicate settlement execution on the same runDate", async () => {
      const now = new Date();
      now.setHours(0, 0, 0, 0);

      // Run 1
      const res1 = await settlementService.processWeeklySettlement(now);
      expect(res1.alreadyRan).toBeUndefined();

      // Run 2 on same normalized runDate
      const res2 = await settlementService.processWeeklySettlement(now);
      expect(res2.alreadyRan).toBe(true);
    });
  });

  // ==========================================
  // C1: Rebirth Card Referral Bonus Fallback
  // ==========================================
  describe("C1: Rebirth Card Referral Bonus Fallback", () => {
    it("should credit Setu Kosh referral bonus to owner's MAIN card sponsor when purchase is made via REBIRTH card", async () => {
      // 1. Sponsor Member
      const sponsor = await prisma.member.create({
        data: { name: `Main Sponsor ${unique}`, mobile: `9821${unique}`, status: "ACTIVE" }
      });
      const sponsorCard = await prisma.memberIdCard.create({
        data: { memberId: sponsor.id, cardNumber: `BB21${unique}`, type: "MAIN" }
      });
      await prisma.mySystemNode.create({
        data: { idCardId: sponsorCard.id, placementType: "ROOT" }
      });

      // 2. Buyer Member with MAIN card and REBIRTH card
      const buyer = await prisma.member.create({
        data: { name: `Rebirth Buyer ${unique}`, mobile: `9822${unique}`, status: "ACTIVE", pinCode: "110001" }
      });
      const buyerMainCard = await prisma.memberIdCard.create({
        data: { memberId: buyer.id, cardNumber: `BB22${unique}`, type: "MAIN" }
      });
      await prisma.mySystemNode.create({
        data: { idCardId: buyerMainCard.id, sponsorIdCardId: sponsorCard.id, placementType: "SPONSOR" }
      });

      // REBIRTH Card (No MY SYSTEM node)
      const buyerRebirthCard = await prisma.memberIdCard.create({
        data: { memberId: buyer.id, cardNumber: `RB22${unique}`, type: "REBIRTH" }
      });

      // Vendor
      const vOwner = await prisma.member.create({ data: { name: `V C1 ${unique}`, mobile: `9823${unique}`, status: "ACTIVE" } });
      const vendor = await prisma.vendor.create({
        data: { memberId: vOwner.id, businessName: "C1 Store", category: "GROCERY", marginRatePct: 7, status: "ACTIVE" }
      });

      // Purchase made under REBIRTH card: Rs. 1,000 (100,000 paise)
      await setuKoshService.recordPurchase(buyer.id, vendor.id, 100000, {
        idCardId: buyerRebirthCard.id,
        bypassPinCheck: true
      });

      // Verify referral bonus landed on Sponsor's MAIN card
      const refBonus = await prisma.commissionEntry.findFirst({
        where: { idCardId: sponsorCard.id, stream: "VENDOR_REFERRAL_BONUS" }
      });

      expect(refBonus).not.toBeNull();
      expect(refBonus.amountPaise).toBe(250); // 0.25% of 100,000
    });
  });
});
