const { truncateDb } = require("../helpers/cleanDb");
const prisma = require("../../src/lib/prisma");
const withdrawalService = require("../../src/services/withdrawalService");
const adminService = require("../../src/services/adminService");
const { seedSettingsAndSuperAdmin } = require("../../src/lib/seedSettings");

describe("Unit: Withdrawal Calculations, Invariants & Auth Context", () => {
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
  // Steps 0-3 Order & Exact Math Invariant
  // ==========================================
  describe("Step 0-3 Calculation Order & Gross Decomposition Invariant", () => {
    it("should satisfy invariant: Gross = Recovered194R + TDS + Admin + Net across diverse amounts", async () => {
      const member = await prisma.member.create({
        data: { name: `Inv Member ${unique}`, mobile: `8601${unique}`, status: "ACTIVE", panVerified: true }
      });
      const card = await prisma.memberIdCard.create({
        data: { memberId: member.id, cardNumber: `W_${unique}`, type: "MAIN", acbStatus: true }
      });

      // Pending 194R liability = ₹200 (20,000 paise)
      await prisma.tdsLedger.create({
        data: {
          memberId: member.id,
          section: "SECTION_194R",
          amountPaise: 20000,
          status: "PENDING"
        }
      });

      // Prior completed withdrawals of ₹18,000 (1,800,000 paise)
      await prisma.withdrawal.create({
        data: {
          memberId: member.id,
          idCardId: card.id,
          method: "BANK",
          grossPaise: 1800000,
          tdsPaise: 0,
          adminChargePaise: 180000,
          netPaise: 1620000,
          status: "COMPLETED",
          completedAt: new Date()
        }
      });

      // Request ₹10,000 (1,000,000 paise)
      // Step 0: Recover 194R = 20,000 paise -> Taxable base = 980,000 paise
      // Step 1: Prior (1.8L) + 980k = 2.78L -> Excess above 20k = 780,000 paise
      //         TDS (3% of 780k) = 23,400 paise
      // Step 2: Post-TDS = 980,000 - 23,400 = 956,600 paise
      //         Admin (10% on Post-TDS) = 95,660 paise
      // Step 3: Net Payable = 956,600 - 95,660 = 860,940 paise
      const preview = await withdrawalService.previewWithdrawal(member.id, "BANK", 1000000);

      expect(preview.recovered194RPaise).toBe(20000);
      expect(preview.estimatedTdsPaise).toBe(23400);
      expect(preview.estimatedAdminChargePaise).toBe(95660);
      expect(preview.netPayablePaise).toBe(860940);

      // Verify Mathematical Invariant
      const sum = preview.recovered194RPaise + preview.estimatedTdsPaise + preview.estimatedAdminChargePaise + preview.netPayablePaise;
      expect(sum).toBe(1000000);
    });
  });

  // ==========================================
  // Admin Charge Rates on Post-TDS Amount
  // ==========================================
  describe("Admin Charge Percentages by Payout Method", () => {
    it("should charge 10% on BANK and 5% on WALLET or VOUCHER_CONVERSION", async () => {
      const member = await prisma.member.create({
        data: { name: `Admin Rates ${unique}`, mobile: `8602${unique}`, status: "ACTIVE", panVerified: true }
      });

      // 1. BANK -> 10%
      const bankPrev = await withdrawalService.previewWithdrawal(member.id, "BANK", 100000);
      expect(bankPrev.adminChargeRatePct).toBe(10);
      expect(bankPrev.estimatedAdminChargePaise).toBe(10000); // 10% of 100k

      // 2. MEMBER_WALLET -> 5%
      const walletPrev = await withdrawalService.previewWithdrawal(member.id, "MEMBER_WALLET", 100000);
      expect(walletPrev.adminChargeRatePct).toBe(5);
      expect(walletPrev.estimatedAdminChargePaise).toBe(5000); // 5% of 100k

      // 3. VOUCHER_CONVERSION -> 5%
      const voucherPrev = await withdrawalService.previewWithdrawal(member.id, "VOUCHER_CONVERSION", 100000);
      expect(voucherPrev.adminChargeRatePct).toBe(5);
      expect(voucherPrev.estimatedAdminChargePaise).toBe(5000); // 5% of 100k
    });
  });

  // ==========================================
  // Minimum Limit & SUB / REBIRTH Enforcement
  // ==========================================
  describe("Validation Limits & Identity Contexts", () => {
    it("should reject withdrawals below ₹100 (10,000 paise)", async () => {
      const member = await prisma.member.create({
        data: { name: `Min Limit ${unique}`, mobile: `8603${unique}`, status: "ACTIVE" }
      });
      const card = await prisma.memberIdCard.create({
        data: { memberId: member.id, cardNumber: `MIN_${unique}`, type: "MAIN", acbStatus: true }
      });

      await expect(
        withdrawalService.requestWithdrawal(member.id, card.id, "BANK", 9999)
      ).rejects.toThrow("Minimum withdrawal amount is Rs. 100");
    });

    it("should block SUB and REBIRTH card contexts from requesting withdrawals", async () => {
      const member = await prisma.member.create({
        data: { name: `Sub Context ${unique}`, mobile: `8604${unique}`, status: "ACTIVE" }
      });
      const subCard = await prisma.memberIdCard.create({
        data: { memberId: member.id, cardNumber: `SUB_${unique}`, type: "SUB" }
      });
      const rebirthCard = await prisma.memberIdCard.create({
        data: { memberId: member.id, cardNumber: `RB_${unique}`, type: "REBIRTH" }
      });

      await expect(
        withdrawalService.requestWithdrawal(member.id, subCard.id, "BANK", 20000)
      ).rejects.toThrow("Withdrawals can only be initiated from MAIN ID card");

      await expect(
        withdrawalService.requestWithdrawal(member.id, rebirthCard.id, "BANK", 20000)
      ).rejects.toThrow("Withdrawals can only be initiated from MAIN ID card");
    });
  });
});
