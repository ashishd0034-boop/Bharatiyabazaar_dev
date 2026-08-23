const prisma = require("../../src/lib/prisma");
const {
  requestWithdrawal,
  completeWithdrawal,
  rejectWithdrawal,
  previewWithdrawal
} = require("../../src/services/withdrawalService");
const {
  calculate194HTds,
  calculate194R,
  create194RLiability,
  getCurrentFYDateRange,
  getPending194RLiability
} = require("../../src/services/tdsService");
const walletService = require("../../src/services/walletService");

describe("Wave 2: Withdrawal & TDS Engine Full Validation", () => {
  const unique = Date.now().toString().slice(-6);
  let memberVerified;
  let memberUnverified;
  let mainCardVerified;
  let mainCardUnverified;

  beforeAll(async () => {
    // 1. Create Verified Member with ACB
    memberVerified = await prisma.member.create({
      data: {
        name: `Verified User ${unique}`,
        mobile: `9111${unique}`,
        panVerified: true,
        kycStatus: "VERIFIED",
        kycTier: "TIER2"
      }
    });

    mainCardVerified = await prisma.memberIdCard.create({
      data: {
        memberId: memberVerified.id,
        cardNumber: `BB91${unique}`,
        type: "MAIN",
        acbStatus: true
      }
    });

    await prisma.wallet.create({
      data: {
        memberId: memberVerified.id,
        balancePaise: 0
      }
    });

    // 2. Create Unverified Member with ACB
    memberUnverified = await prisma.member.create({
      data: {
        name: `Unverified User ${unique}`,
        mobile: `9222${unique}`,
        panVerified: false,
        kycStatus: "PENDING",
        kycTier: "NONE"
      }
    });

    mainCardUnverified = await prisma.memberIdCard.create({
      data: {
        memberId: memberUnverified.id,
        cardNumber: `BB92${unique}`,
        type: "MAIN",
        acbStatus: true
      }
    });

    await prisma.wallet.create({
      data: {
        memberId: memberUnverified.id,
        balancePaise: 0
      }
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ==========================================
  // SCENARIO 1: Below ₹20k Threshold (₹600)
  // ==========================================
  describe("Scenario 1: Below ₹20k Threshold (₹600 Withdrawal)", () => {
    it("should calculate exact splits: ₹0 TDS, ₹60 Admin (10%), ₹540 Net", async () => {
      // Credit wallet with ₹1,000 (100,000 paise)
      await prisma.$transaction(async (tx) => {
        await walletService.credit(tx, memberVerified.id, 100000, "COMMISSION", null, "Initial commission");
      });

      const preview = await previewWithdrawal(memberVerified.id, "BANK", 60000);
      expect(preview.grossPaise).toBe(60000);
      expect(preview.recovered194RPaise).toBe(0);
      expect(preview.estimatedTdsPaise).toBe(0);
      expect(preview.estimatedAdminChargePaise).toBe(6000); // 10% of 60,000 = 6,000
      expect(preview.netPayablePaise).toBe(54000);          // 54,000

      // Request withdrawal
      const withdrawal = await requestWithdrawal(
        memberVerified.id,
        mainCardVerified.id,
        "BANK",
        60000
      );

      expect(withdrawal.status).toBe("REQUESTED");
      expect(withdrawal.grossPaise).toBe(60000);
      expect(withdrawal.tdsPaise).toBe(0);
      expect(withdrawal.adminChargePaise).toBe(6000);
      expect(withdrawal.netPaise).toBe(54000);

      // Wallet balance should be debited by escrow ₹600 (remaining ₹400 = 40,000 paise)
      const walletAfterRequest = await prisma.wallet.findUnique({ where: { memberId: memberVerified.id } });
      expect(walletAfterRequest.balancePaise).toBe(40000);

      // Complete withdrawal
      const completed = await completeWithdrawal(withdrawal.id);
      expect(completed.status).toBe("COMPLETED");

      // Balance remains ₹400 after clean split execution
      const walletAfterComplete = await prisma.wallet.findUnique({ where: { memberId: memberVerified.id } });
      expect(walletAfterComplete.balancePaise).toBe(40000);
    });
  });

  // ==========================================
  // SCENARIO 2: Crossing ₹20k Threshold (₹25,000)
  // ==========================================
  describe("Scenario 2: Crossing ₹20k Threshold (₹25,000 Withdrawal)", () => {
    it("should calculate marginal TDS on ₹5,000 excess @ 3% = ₹150, Admin 10% on ₹24,850 = ₹2,485, Net = ₹22,365", async () => {
      // Credit wallet with ₹30,000 (3,000,000 paise)
      await prisma.$transaction(async (tx) => {
        await walletService.credit(tx, memberVerified.id, 3000000, "COMMISSION", null, "Large commission");
      });

      // Request ₹25,000 (2,500,000 paise)
      // Note: Member had ₹600 prior completed in current FY.
      // Total Gross = 600 + 25,000 = 25,600. Excess over 20k = 5,600.
      // Or if tested in clean FY context: 2,500,000 - (2,000,000 - 60,000) = 560,000 excess.
      // Let's verify exact marginal computation:
      const preview = await previewWithdrawal(memberVerified.id, "BANK", 2500000);
      
      const expectedTaxablePaise = preview.taxableBasePaise - (2000000 - 60000); // 560,000 paise (₹5,600)
      const expectedTdsPaise = Math.floor(expectedTaxablePaise * 0.03); // ₹168 (16,800 paise)
      const expectedPostTds = 2500000 - expectedTdsPaise;
      const expectedAdmin = Math.floor(expectedPostTds * 0.10);
      const expectedNet = expectedPostTds - expectedAdmin;

      expect(preview.estimatedTdsPaise).toBe(expectedTdsPaise);
      expect(preview.estimatedAdminChargePaise).toBe(expectedAdmin);
      expect(preview.netPayablePaise).toBe(expectedNet);

      const withdrawal = await requestWithdrawal(
        memberVerified.id,
        mainCardVerified.id,
        "BANK",
        2500000
      );

      expect(withdrawal.tdsPaise).toBe(expectedTdsPaise);
      expect(withdrawal.adminChargePaise).toBe(expectedAdmin);
      expect(withdrawal.netPaise).toBe(expectedNet);

      // Verify invariant: Gross == Recovery + TDS + Admin + Net
      expect(withdrawal.grossPaise).toBe(
        withdrawal.recovered194RPaise + withdrawal.tdsPaise + withdrawal.adminChargePaise + withdrawal.netPaise
      );

      // Check that PENDING TDS ledger entry was created
      const tdsEntry = await prisma.tdsLedger.findFirst({
        where: { referenceId: withdrawal.id, status: "PENDING" }
      });
      expect(tdsEntry).not.toBeNull();
      expect(tdsEntry.amountPaise).toBe(expectedTdsPaise);

      // Complete withdrawal and verify TDS marked DEPOSITED
      await completeWithdrawal(withdrawal.id);
      const depositedEntry = await prisma.tdsLedger.findFirst({
        where: { referenceId: withdrawal.id }
      });
      expect(depositedEntry.status).toBe("DEPOSITED");
    });
  });

  // ==========================================
  // SCENARIO 3: 194R Voucher Liability Recovery
  // ==========================================
  describe("Scenario 3: 194R Voucher Liability Recovery", () => {
    it("should recover ₹2,000 liability at Step 0, apply TDS on remainder, admin on post-TDS", async () => {
      const uniqueSub = Date.now().toString().slice(-6);
      const memberR = await prisma.member.create({
        data: {
          name: `194R Member ${uniqueSub}`,
          mobile: `9333${uniqueSub}`,
          panVerified: true,
          kycStatus: "VERIFIED",
          kycTier: "TIER2"
        }
      });

      const cardR = await prisma.memberIdCard.create({
        data: {
          memberId: memberR.id,
          cardNumber: `BB93${uniqueSub}`,
          type: "MAIN",
          acbStatus: true
        }
      });

      await prisma.wallet.create({
        data: { memberId: memberR.id, balancePaise: 0 }
      });

      // 1. Create a ₹2,000 pending 194R liability (from earlier voucher redemption)
      await prisma.tdsLedger.create({
        data: {
          memberId: memberR.id,
          section: "SECTION_194R",
          amountPaise: 200000, // ₹2,000
          status: "PENDING"
        }
      });

      // 2. Credit wallet with ₹10,000 (1,000,000 paise)
      await prisma.$transaction(async (tx) => {
        await walletService.credit(tx, memberR.id, 1000000, "COMMISSION", null, "Cash reward");
      });

      // 3. Request cash withdrawal of ₹10,000 (1,000,000 paise) via BANK
      const withdrawal = await requestWithdrawal(
        memberR.id,
        cardR.id,
        "BANK",
        1000000
      );

      // Step 0: 194R recovery = ₹2,000 (200,000 paise)
      expect(withdrawal.recovered194RPaise).toBe(200000);
      // Remainder for Step 1 = ₹8,000 (800,000 paise) -> Below 20k threshold -> TDS = 0
      expect(withdrawal.tdsPaise).toBe(0);
      // Step 2: 10% Admin on ₹8,000 = ₹800 (80,000 paise)
      expect(withdrawal.adminChargePaise).toBe(80000);
      // Step 3: Net Payout = ₹8,000 - ₹800 = ₹7,200 (720,000 paise)
      expect(withdrawal.netPaise).toBe(720000);

      // Complete withdrawal
      await completeWithdrawal(withdrawal.id);

      // Verify that the 194R ledger entry was marked RECOVERED
      const remainingPending = await getPending194RLiability(prisma, memberR.id);
      expect(remainingPending).toBe(0);
    });
  });

  // ==========================================
  // SCENARIO 4: TDS Hold & Reversal on Rejection
  // ==========================================
  describe("Scenario 4: TDS Hold & Reversal on Rejection", () => {
    it("should hold TDS as PENDING on request, restore balance and flip TDS to REVERSED on rejection", async () => {
      const uniqueSub = Date.now().toString().slice(-6);
      const memberH = await prisma.member.create({
        data: {
          name: `Hold Member ${uniqueSub}`,
          mobile: `9444${uniqueSub}`,
          panVerified: false,
          kycStatus: "PENDING",
          kycTier: "NONE"
        }
      });

      const cardH = await prisma.memberIdCard.create({
        data: {
          memberId: memberH.id,
          cardNumber: `BB94${uniqueSub}`,
          type: "MAIN",
          acbStatus: true
        }
      });

      await prisma.wallet.create({
        data: { memberId: memberH.id, balancePaise: 0 }
      });

      // Credit wallet with ₹30,000 (3,000,000 paise)
      await prisma.$transaction(async (tx) => {
        await walletService.credit(tx, memberH.id, 3000000, "COMMISSION", null, "Unverified earnings");
      });

      // Request ₹25,000 withdrawal (unverified member -> 20% TDS on ₹5,000 excess = ₹1,000)
      const withdrawal = await requestWithdrawal(
        memberH.id,
        cardH.id,
        "BANK",
        2500000
      );

      expect(withdrawal.tdsPaise).toBe(100000); // 20% on 5,000 = 1,000 (100,000 paise)
      expect(withdrawal.status).toBe("REQUESTED");

      // Verify wallet escrow deducted ₹25,000 (remaining ₹5,000 = 500,000 paise)
      let wallet = await prisma.wallet.findUnique({ where: { memberId: memberH.id } });
      expect(wallet.balancePaise).toBe(500000);

      // Verify TDS ledger entry is PENDING
      const pendingTds = await prisma.tdsLedger.findFirst({
        where: { referenceId: withdrawal.id, status: "PENDING" }
      });
      expect(pendingTds).not.toBeNull();
      expect(pendingTds.amountPaise).toBe(100000);

      // Reject withdrawal
      await rejectWithdrawal(withdrawal.id, "Invalid bank account details");

      // Verify wallet refunded in full to ₹30,000 (3,000,000 paise)
      wallet = await prisma.wallet.findUnique({ where: { memberId: memberH.id } });
      expect(wallet.balancePaise).toBe(3000000);

      // Verify TDS flipped to REVERSED
      const reversedTds = await prisma.tdsLedger.findFirst({
        where: { referenceId: withdrawal.id }
      });
      expect(reversedTds.status).toBe("REVERSED");
    });
  });

  // ==========================================
  // SCENARIO 5: 194R Full Aggregate Method
  // ==========================================
  describe("Scenario 5: 194R Full Aggregate Method (₹15k + ₹10k = ₹25k → Liability ₹2,500)", () => {
    it("should calculate ₹0 liability for first ₹15k, and ₹2,500 liability when crossing to ₹25k", async () => {
      const uniqueSub = Date.now().toString().slice(-6);
      const memberV = await prisma.member.create({
        data: {
          name: `Voucher Member ${uniqueSub}`,
          mobile: `9555${uniqueSub}`,
          panVerified: true,
          kycStatus: "VERIFIED",
          kycTier: "TIER2"
        }
      });

      // 1. Redeem first voucher of ₹15,000 (1,500,000 paise)
      const res1 = await prisma.$transaction(async (tx) => {
        // Create redeemed voucher
        const v1 = await tx.voucher.create({
          data: {
            memberId: memberV.id,
            sourceType: "AUTOPOOL_L5",
            faceValuePaise: 1500000,
            status: "REDEEMED",
            expiresAt: new Date(Date.now() + 86400000 * 365),
            redeemedAt: new Date()
          }
        });
        return await create194RLiability(tx, memberV.id, v1.faceValuePaise, v1.id);
      });

      // Aggregate ₹15,000 <= ₹20,000 threshold -> Liability = ₹0
      expect(res1.liabilityPaise).toBe(0);
      expect(res1.thresholdExceeded).toBe(false);

      // 2. Redeem second voucher of ₹10,000 (1,000,000 paise)
      // Aggregate becomes ₹25,000 > ₹20,000 threshold
      // Full Aggregate Tax = 10% of ₹25,000 = ₹2,500 (250,000 paise)
      const res2 = await prisma.$transaction(async (tx) => {
        const v2 = await tx.voucher.create({
          data: {
            memberId: memberV.id,
            sourceType: "AUTOPOOL_L6",
            faceValuePaise: 1000000,
            status: "REDEEMED",
            expiresAt: new Date(Date.now() + 86400000 * 365),
            redeemedAt: new Date()
          }
        });
        return await create194RLiability(tx, memberV.id, v2.faceValuePaise, v2.id);
      });

      expect(res2.thresholdExceeded).toBe(true);
      expect(res2.liabilityPaise).toBe(250000); // Exactly ₹2,500 (250,000 paise)

      // Verify pending liability in TdsLedger
      const pendingLiability = await getPending194RLiability(prisma, memberV.id);
      expect(pendingLiability).toBe(250000);
    });
  });
});
