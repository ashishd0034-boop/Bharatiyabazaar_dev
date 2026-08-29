const { truncateDb } = require("../helpers/cleanDb");
const prisma = require("../../src/lib/prisma");
const tdsService = require("../../src/services/tdsService");
const withdrawalService = require("../../src/services/withdrawalService");
const walletService = require("../../src/services/walletService");
const adminService = require("../../src/services/adminService");
const { seedSettingsAndSuperAdmin } = require("../../src/lib/seedSettings");

describe("Unit: TDS Calculations & Lifecycle (194H, 194R, 194C)", () => {
  const unique = Date.now().toString().slice(-6);

  async function cleanDb() {
    await truncateDb(prisma);
  }

  beforeEach(async () => {
    await cleanDb();
  });

  afterAll(async () => {
    await cleanDb();
    await prisma.$disconnect();
  });

  // ==========================================
  // Section 194H: Cash Commissions (Marginal)
  // ==========================================
  describe("Section 194H Pure Calculation & Marginal Rules", () => {
    it("should calculate 0 TDS when withdrawal is strictly under ₹20,000 FY threshold", async () => {
      const member = await prisma.member.create({
        data: { name: `194H Under ${unique}`, mobile: `8701${unique}`, status: "ACTIVE", panVerified: true }
      });

      await prisma.$transaction(async (tx) => {
        // Request ₹15,000 (1,500,000 paise) with 0 prior withdrawals
        const calc = await tdsService.calculate194HTds(tx, member.id, 1500000);
        expect(calc.taxablePaise).toBe(0);
        expect(calc.tdsPaise).toBe(0);
        expect(calc.rate).toBe(0.03);
      });
    });

    it("should calculate marginal TDS on excess only when crossing ₹20,000 threshold", async () => {
      const memberPan = await prisma.member.create({
        data: { name: `194H Cross PAN ${unique}`, mobile: `8702${unique}`, status: "ACTIVE", panVerified: true }
      });
      const memberNoPan = await prisma.member.create({
        data: { name: `194H Cross NoPAN ${unique}`, mobile: `8703${unique}`, status: "ACTIVE", panVerified: false, kycStatus: "PENDING" }
      });

      await prisma.$transaction(async (tx) => {
        // ₹25,000 (2,500,000 paise) gross with 0 prior
        // Excess above 20k = ₹5,000 (500,000 paise)
        const calcPan = await tdsService.calculate194HTds(tx, memberPan.id, 2500000);
        expect(calcPan.taxablePaise).toBe(500000);
        expect(calcPan.tdsPaise).toBe(15000); // 3% of 500k = 15k paise (₹150)

        const calcNoPan = await tdsService.calculate194HTds(tx, memberNoPan.id, 2500000);
        expect(calcNoPan.taxablePaise).toBe(500000);
        expect(calcNoPan.tdsPaise).toBe(100000); // 20% of 500k = 100k paise (₹1,000)
      });
    });

    it("should calculate TDS on full amount once member is already above ₹20,000 threshold", async () => {
      const member = await prisma.member.create({
        data: { name: `194H Above ${unique}`, mobile: `8704${unique}`, status: "ACTIVE", panVerified: true }
      });
      const card = await prisma.memberIdCard.create({
        data: { memberId: member.id, cardNumber: `BB8704_${unique}`, type: "MAIN" }
      });

      // Record prior completed withdrawal of ₹25,000
      await prisma.withdrawal.create({
        data: {
          memberId: member.id,
          idCardId: card.id,
          method: "BANK",
          grossPaise: 2500000,
          tdsPaise: 15000,
          adminChargePaise: 248500,
          netPaise: 2236500,
          status: "COMPLETED",
          completedAt: new Date()
        }
      });

      await prisma.$transaction(async (tx) => {
        // Subsequent withdrawal of ₹10,000 (1,000,000 paise)
        const calc = await tdsService.calculate194HTds(tx, member.id, 1000000);
        expect(calc.taxablePaise).toBe(1000000); // 100% taxable
        expect(calc.tdsPaise).toBe(30000); // 3% of 1,000,000 = 30,000 paise (₹300)
      });
    });
  });

  // ==========================================
  // Section 194R: Product Vouchers (Full Aggregate)
  // ==========================================
  describe("Section 194R Pure Calculation & Aggregate Rules", () => {
    it("should return 0 liability when total redeemed vouchers are under ₹20,000", async () => {
      const member = await prisma.member.create({
        data: { name: `194R Under ${unique}`, mobile: `8705${unique}`, status: "ACTIVE" }
      });

      await prisma.$transaction(async (tx) => {
        // Redeem voucher of ₹15,000 (1,500,000 paise)
        const calc = await tdsService.calculate194R(tx, member.id, 1500000);
        expect(calc.thresholdExceeded).toBe(false);
        expect(calc.liabilityPaise).toBe(0);
      });
    });

    it("should calculate 10% on FULL aggregate when crossing ₹20,000 threshold", async () => {
      const member = await prisma.member.create({
        data: { name: `194R Cross ${unique}`, mobile: `8706${unique}`, status: "ACTIVE" }
      });

      // Prior redeemed voucher of ₹15,000 (1,500,000 paise)
      await prisma.voucher.create({
        data: {
          memberId: member.id,
          sourceType: "AUTOPOOL_LEVEL_5",
          faceValuePaise: 1500000,
          status: "REDEEMED",
          expiresAt: new Date(Date.now() + 365 * 86400000),
          redeemedAt: new Date()
        }
      });

      await prisma.$transaction(async (tx) => {
        // New voucher of ₹10,000 (1,000,000 paise) -> Total aggregate = ₹25,000
        const calc = await tdsService.calculate194R(tx, member.id, 1000000);
        expect(calc.thresholdExceeded).toBe(true);
        expect(calc.totalVoucherPaise).toBe(2500000);
        // 10% of full aggregate (2,500,000) = 250,000 paise (₹2,500)
        expect(calc.liabilityPaise).toBe(250000);
      });
    });

    it("should compute incremental liability on subsequent voucher redemptions", async () => {
      const member = await prisma.member.create({
        data: { name: `194R Inactive ${unique}`, mobile: `8707${unique}`, status: "ACTIVE" }
      });

      // Existing 194R liability of ₹2,500 recorded in ledger
      await prisma.tdsLedger.create({
        data: {
          memberId: member.id,
          section: "SECTION_194R",
          amountPaise: 250000,
          status: "PENDING"
        }
      });

      // Prior redeemed vouchers totalling ₹25,000
      await prisma.voucher.create({
        data: {
          memberId: member.id,
          sourceType: "AUTOPOOL_LEVEL_5",
          faceValuePaise: 2500000,
          status: "REDEEMED",
          expiresAt: new Date(Date.now() + 365 * 86400000),
          redeemedAt: new Date()
        }
      });

      await prisma.$transaction(async (tx) => {
        // New voucher of ₹5,000 (500,000 paise) -> Total aggregate = ₹30,000
        // Target liability = 10% of 30k = ₹3,000. Incremental = 3,000 - 2,500 = ₹500 (50,000 paise)
        const calc = await tdsService.calculate194R(tx, member.id, 500000);
        expect(calc.liabilityPaise).toBe(50000);
      });
    });
  });

  // ==========================================
  // Section 194C: Vendor Settlements
  // ==========================================
  describe("Section 194C Vendor Settlement TDS", () => {
    it("should tax single payout > ₹30,000 in full", async () => {
      const vMember = await prisma.member.create({
        data: { name: `V M 194C ${unique}`, mobile: `8708${unique}`, status: "ACTIVE" }
      });
      const vendor = await prisma.vendor.create({
        data: {
          memberId: vMember.id,
          businessName: "Vendor 194C Single",
          category: "GENERAL",
          marginRatePct: 10.0,
          status: "ACTIVE"
        }
      });

      await prisma.$transaction(async (tx) => {
        // Single payout of ₹35,000 (3,500,000 paise) with individual PAN (1%)
        const calc = await tdsService.calculate194C(tx, vendor.id, 3500000, "INDIVIDUAL", true);
        expect(calc.thresholdExceeded).toBe(true);
        expect(calc.taxablePaise).toBe(3500000);
        expect(calc.tdsPaise).toBe(35000); // 1% of 35k = ₹350 (35,000 paise)

        // Same for COMPANY entity (2%)
        const calcComp = await tdsService.calculate194C(tx, vendor.id, 3500000, "COMPANY", true);
        expect(calcComp.tdsPaise).toBe(70000); // 2% of 35k = ₹700 (70,000 paise)
      });
    });

    it("should calculate marginal TDS on excess when FY aggregate crosses ₹1,00,000", async () => {
      const vMember = await prisma.member.create({
        data: { name: `V M 194C 2 ${unique}`, mobile: `8709${unique}`, status: "ACTIVE" }
      });
      const vendor = await prisma.vendor.create({
        data: {
          memberId: vMember.id,
          businessName: "Vendor 194C Aggregate",
          category: "GENERAL",
          marginRatePct: 10.0,
          status: "ACTIVE"
        }
      });

      // Prior completed settlement of ₹85,000 (8,500,000 paise)
      await prisma.vendorSettlement.create({
        data: {
          vendorId: vendor.id,
          grossSalesPaise: 8500000,
          marginPaise: 850000,
          postMarginPaise: 7650000,
          adminChargePaise: 765000,
          payoutBeforeTdsPaise: 8500000,
          tdsPaise: 0,
          netPayablePaise: 8500000,
          status: "SETTLED",
          periodStart: new Date(Date.now() - 7 * 86400000),
          periodEnd: new Date(),
          settledAt: new Date()
        }
      });

      await prisma.$transaction(async (tx) => {
        // New settlement payout of ₹25,000 (2,500,000 paise, <= 30k single threshold) -> Aggregate = ₹110,000
        // Excess above 100k = ₹10,000 (1,000,000 paise)
        const calc = await tdsService.calculate194C(tx, vendor.id, 2500000, "INDIVIDUAL", true);
        expect(calc.thresholdExceeded).toBe(true);
        expect(calc.taxablePaise).toBe(1000000);
        expect(calc.tdsPaise).toBe(10000); // 1% of 10,000 = ₹100 (10,000 paise)
      });
    });
  });

  // ==========================================
  // Hold/Reverse Lifecycle & Step 0 Recovery
  // ==========================================
  describe("TDS Lifecycle & Step 0 194R Recovery", () => {
    it("should hold TDS as PENDING on withdrawal request, flip to REVERSED on rejection", async () => {
      const member = await prisma.member.create({
        data: { name: `Lifecycle M ${unique}`, mobile: `8710${unique}`, status: "ACTIVE", panVerified: true }
      });
      const card = await prisma.memberIdCard.create({
        data: { memberId: member.id, cardNumber: `LC_${unique}`, type: "MAIN", acbStatus: true }
      });
      await prisma.wallet.create({ data: { memberId: member.id, balancePaise: 0 } });
      await prisma.$transaction(async (tx) => {
        await walletService.credit(tx, member.id, 3000000, "TOPUP", null, "Test topup");
      });

      // Request withdrawal of ₹25,000 (TDS = ₹150 / 15,000 paise)
      const withdrawal = await withdrawalService.requestWithdrawal(member.id, card.id, "BANK", 2500000);
      expect(withdrawal.tdsPaise).toBe(15000);

      const tdsEntry = await prisma.tdsLedger.findFirst({
        where: { memberId: member.id, referenceId: withdrawal.id }
      });
      expect(tdsEntry.status).toBe("PENDING");

      // Reject withdrawal
      await withdrawalService.rejectWithdrawal(withdrawal.id, "Invalid IFSC", "admin-1");

      const tdsEntryAfter = await prisma.tdsLedger.findFirst({
        where: { id: tdsEntry.id }
      });
      expect(tdsEntryAfter.status).toBe("REVERSED");
    });

    it("should recover 194R liability at Step 0 of next cash withdrawal", async () => {
      const member = await prisma.member.create({
        data: { name: `Step0 M ${unique}`, mobile: `8711${unique}`, status: "ACTIVE", panVerified: true }
      });

      // Pending 194R liability of ₹500 (50,000 paise)
      await prisma.tdsLedger.create({
        data: {
          memberId: member.id,
          section: "SECTION_194R",
          amountPaise: 50000,
          status: "PENDING"
        }
      });

      const preview = await withdrawalService.previewWithdrawal(member.id, "BANK", 1000000);
      expect(preview.recovered194RPaise).toBe(50000);
      expect(preview.taxableBasePaise).toBe(950000); // 1,000,000 - 50,000
    });
  });
});
