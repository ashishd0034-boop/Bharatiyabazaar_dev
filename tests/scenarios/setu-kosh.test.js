const { truncateDb } = require("../helpers/cleanDb");
const prisma = require("../../src/lib/prisma");
const setuKoshService = require("../../src/services/setuKoshService");
const vendorService = require("../../src/services/vendorService");
const idCardService = require("../../src/services/idCardService");

describe("Wave 3: Setu Kosh Engine Full Validation", () => {
  const unique = Date.now().toString().slice(-6);
  let sponsorMember;
  let buyerMember;
  let sponsorMainCard;
  let buyerMainCard;
  let vendor;

  beforeAll(async () => {
    // 1. Clean Database
    await truncateDb(prisma);

    // 2. Create Sponsor Member
    sponsorMember = await prisma.member.create({
      data: {
        name: `Sponsor ${unique}`,
        mobile: `9881${unique}`,
        pinCode: "110001",
        status: "ACTIVE"
      }
    });

    sponsorMainCard = await prisma.memberIdCard.create({
      data: {
        memberId: sponsorMember.id,
        cardNumber: `BB81${unique}`,
        type: "MAIN",
        acbStatus: true
      }
    });

    await prisma.mySystemNode.create({
      data: {
        idCardId: sponsorMainCard.id,
        placementType: "ROOT"
      }
    });

    // 3. Create Buyer Member sponsored by Sponsor
    buyerMember = await prisma.member.create({
      data: {
        name: `Buyer ${unique}`,
        mobile: `9882${unique}`,
        pinCode: "110001",
        status: "ACTIVE"
      }
    });

    buyerMainCard = await prisma.memberIdCard.create({
      data: {
        memberId: buyerMember.id,
        cardNumber: `BB82${unique}`,
        type: "MAIN",
        acbStatus: true
      }
    });

    await prisma.mySystemNode.create({
      data: {
        idCardId: buyerMainCard.id,
        sponsorIdCardId: sponsorMainCard.id,
        placementType: "SPONSOR"
      }
    });

    // 4. Create Active Vendor with 7% margin
    const vendorOwner = await prisma.member.create({
      data: {
        name: `Vendor Owner ${unique}`,
        mobile: `9883${unique}`,
        pinCode: "110001",
        status: "ACTIVE"
      }
    });

    vendor = await prisma.vendor.create({
      data: {
        memberId: vendorOwner.id,
        businessName: "Bharat Grocery Store",
        category: "GROCERY",
        marginRatePct: 7.0,
        pinCode: "110001",
        status: "ACTIVE"
      }
    });

    // 5. Seed Ancestor Nodes in Setu Kosh Tree for L1-L10 upline testing
    // We create ancestor members and their Setu Kosh nodes
    for (let i = 1; i <= 5; i++) {
      const ancMember = await prisma.member.create({
        data: {
          name: `Ancestor ${i} ${unique}`,
          mobile: `9884${i}${unique.slice(0, 4)}`,
          pinCode: "110001",
          status: "ACTIVE"
        }
      });

      const ancCard = await prisma.memberIdCard.create({
        data: {
          memberId: ancMember.id,
          cardNumber: `BB84${i}${unique.slice(0, 3)}`,
          type: "MAIN",
          acbStatus: true
        }
      });

      // Generate Setu Kosh nodes to populate positions 1 to 5
      await setuKoshService.generateSetuKoshNode(prisma, ancMember.id, 0, true);
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ==========================================
  // T1: Standard ₹1,000 purchase @ 7% margin
  // ==========================================
  describe("T1: Standard ₹1,000 purchase @ 7% margin", () => {
    it("should calculate exact splits: L1-L3=500, L4=250, L5-L6=500, L7=250, L8-L10=500, bonus=250, total=4,750 <= 7,000", () => {
      const marginPaise = 7000; // 7% of 100,000
      const purchasePaise = 100000;

      const splits = setuKoshService.calculateCommissionSplits(marginPaise, purchasePaise);

      expect(splits.levelAmounts[1]).toBe(500);
      expect(splits.levelAmounts[2]).toBe(500);
      expect(splits.levelAmounts[3]).toBe(500);
      expect(splits.levelAmounts[4]).toBe(250); // Half rate
      expect(splits.levelAmounts[5]).toBe(500);
      expect(splits.levelAmounts[6]).toBe(500);
      expect(splits.levelAmounts[7]).toBe(250); // Half rate
      expect(splits.levelAmounts[8]).toBe(500);
      expect(splits.levelAmounts[9]).toBe(500);
      expect(splits.levelAmounts[10]).toBe(500);
      expect(splits.referralBonusPaise).toBe(250); // 0.25% of 100,000
      expect(splits.totalPayoutPaise).toBe(4750);
      expect(splits.totalPayoutPaise).toBeLessThanOrEqual(marginPaise);
    });

    it("should process ₹1,000 purchase and generate 1 node with PENDING_SETTLEMENT commissions", async () => {
      const result = await setuKoshService.recordPurchase(
        buyerMember.id,
        vendor.id,
        100000,
        { bypassPinCheck: true }
      );

      expect(result.idsCreated).toBe(1);
      expect(result.nodes).toHaveLength(1);
      expect(result.currentCounterPaise).toBe(0);

      // Verify Setu Kosh commission entry status
      const setuComms = await prisma.commissionEntry.findMany({
        where: { stream: "SETU_KOSH" }
      });
      expect(setuComms.length).toBeGreaterThan(0);
      expect(setuComms[0].status).toBe("PENDING_SETTLEMENT");

      // Verify referral bonus entry to sponsor
      const refBonus = await prisma.commissionEntry.findFirst({
        where: { idCardId: sponsorMainCard.id, stream: "VENDOR_REFERRAL_BONUS" }
      });
      expect(refBonus).not.toBeNull();
      expect(refBonus.amountPaise).toBe(250);
      expect(refBonus.status).toBe("PENDING_SETTLEMENT");
    });
  });

  // ==========================================
  // T2: Counter Overflow & Remainder Carry-Forward
  // ==========================================
  describe("T2: Counter Overflow & Remainder Carry-Forward", () => {
    it("should carry forward remainder: pre-remainder 50,000 + purchase 100,000 -> 1 new ID, remainder 50,000", async () => {
      const uniqueSub = Date.now().toString().slice(-6);
      const memberO = await prisma.member.create({
        data: {
          name: `Overflow User ${uniqueSub}`,
          mobile: `9885${uniqueSub}`,
          pinCode: "110001",
          status: "ACTIVE"
        }
      });

      // Set initial pre-remainder of 50,000 paise (and 3,500 margin)
      await prisma.setuKoshCounter.create({
        data: {
          memberId: memberO.id,
          counterPaise: 50000,
          accumulatedMarginPaise: 3500,
          idsCreated: 0
        }
      });

      // Purchase of ₹1,000 (100,000 paise)
      const res = await setuKoshService.recordPurchase(
        memberO.id,
        vendor.id,
        100000,
        { bypassPinCheck: true }
      );

      // Total became 150,000 paise -> 1 ID created, remainder 50,000 paise
      expect(res.idsCreated).toBe(1);
      expect(res.currentCounterPaise).toBe(50000);

      // Counter in DB reflects 50,000 remainder
      const counter = await prisma.setuKoshCounter.findUnique({
        where: { memberId: memberO.id }
      });
      expect(counter.counterPaise).toBe(50000);
      expect(counter.idsCreated).toBe(1);
    });
  });

  // ==========================================
  // T3: Multi-Card Accumulation
  // ==========================================
  describe("T3: Multi-Card Accumulation", () => {
    it("should aggregate purchases made under MAIN, SUB, and REBIRTH contexts into the single member counter", async () => {
      const uniqueSub = Date.now().toString().slice(-6);
      const memberM = await prisma.member.create({
        data: {
          name: `Multi-Card User ${uniqueSub}`,
          mobile: `9886${uniqueSub}`,
          pinCode: "110001",
          status: "ACTIVE"
        }
      });

      const mainCard = await prisma.memberIdCard.create({
        data: { memberId: memberM.id, cardNumber: `BB86${uniqueSub}`, type: "MAIN" }
      });

      const subCard = await prisma.memberIdCard.create({
        data: { memberId: memberM.id, cardNumber: `SB86${uniqueSub}`, type: "SUB" }
      });

      const rebirthCard = await prisma.memberIdCard.create({
        data: { memberId: memberM.id, cardNumber: `RB86${uniqueSub}`, type: "REBIRTH" }
      });

      // 1. Purchase via MAIN card: ₹300 (30,000 paise)
      await setuKoshService.recordPurchase(memberM.id, vendor.id, 30000, { idCardId: mainCard.id, bypassPinCheck: true });

      // 2. Purchase via SUB card: ₹400 (40,000 paise)
      await setuKoshService.recordPurchase(memberM.id, vendor.id, 40000, { idCardId: subCard.id, bypassPinCheck: true });

      // 3. Purchase via REBIRTH card: ₹500 (50,000 paise)
      const res = await setuKoshService.recordPurchase(memberM.id, vendor.id, 50000, { idCardId: rebirthCard.id, bypassPinCheck: true });

      // Total spent = 30k + 40k + 50k = 120,000 paise -> 1 ID created, remainder 20,000 paise
      expect(res.idsCreated).toBe(1);
      expect(res.currentCounterPaise).toBe(20000);

      const counter = await prisma.setuKoshCounter.findUnique({ where: { memberId: memberM.id } });
      expect(counter.counterPaise).toBe(20000);
      expect(counter.idsCreated).toBe(1);
    });
  });

  // ==========================================
  // T4: PIN Gate
  // ==========================================
  describe("T4: PIN Code Activation Gate", () => {
    it("should mark commissions PIN_GATE_INACTIVE when below threshold and PENDING_SETTLEMENT when reaching threshold", async () => {
      const pin = "999888";
      const uniqueSub = Date.now().toString().slice(-6);

      // Create buyer with a fresh PIN code (1 member only < default threshold 10)
      const buyerPin = await prisma.member.create({
        data: {
          name: `PIN Buyer ${uniqueSub}`,
          mobile: `9887${uniqueSub}`,
          pinCode: pin,
          status: "ACTIVE"
        }
      });

      const cardPin = await prisma.memberIdCard.create({
        data: { memberId: buyerPin.id, cardNumber: `BB87${uniqueSub}`, type: "MAIN" }
      });

      // 1. Purchase when PIN has only 1 member -> PIN_GATE_INACTIVE
      const res1 = await setuKoshService.recordPurchase(buyerPin.id, vendor.id, 100000, { idCardId: cardPin.id });
      expect(res1.isPinActive).toBe(false);

      const inactiveComms = await prisma.commissionEntry.findMany({
        where: { status: "PIN_GATE_INACTIVE" }
      });
      expect(inactiveComms.length).toBeGreaterThan(0);

      // 2. Populate PIN code with 10 members to cross threshold
      for (let j = 1; j <= 10; j++) {
        await prisma.member.create({
          data: {
            name: `Neighbor ${j} ${uniqueSub}`,
            mobile: `9888${j}${uniqueSub.slice(0, 4)}`,
            pinCode: pin,
            status: "ACTIVE"
          }
        });
      }

      // 3. Purchase when PIN is active -> PENDING_SETTLEMENT
      const res2 = await setuKoshService.recordPurchase(buyerPin.id, vendor.id, 100000, { idCardId: cardPin.id });
      expect(res2.isPinActive).toBe(true);

      // Verify that previously inactive commissions in this PIN code were activated
      const remainingInactive = await prisma.commissionEntry.count({
        where: { status: "PIN_GATE_INACTIVE" }
      });
      expect(remainingInactive).toBe(0);
    });
  });

  // ==========================================
  // T5: Cap Enforcement
  // ==========================================
  describe("T5: Payout Cap Enforcement", () => {
    it("should clamp level commissions if total formula payout would exceed vendor margin", () => {
      // Construct artificial case: Low margin of 100 paise with high referral bonus
      const marginPaise = 100;
      const purchasePaise = 100000; // Bonus would be 250 paise (exceeds 100 paise margin)

      const splits = setuKoshService.calculateCommissionSplits(marginPaise, purchasePaise);

      expect(splits.totalPayoutPaise).toBeLessThanOrEqual(marginPaise);
    });
  });

  // ==========================================
  // T6: Idempotency
  // ==========================================
  describe("T6: Idempotency Protection", () => {
    it("should return alreadyProcessed and prevent duplicate node/commission creation on same saleId", async () => {
      const idempotencyKey = `sale_idempotent_${unique}`;

      // 1. First attempt
      const firstRun = await setuKoshService.recordPurchase(buyerMember.id, vendor.id, 100000, {
        idempotencyKey,
        bypassPinCheck: true
      });
      expect(firstRun.idsCreated).toBe(1);

      const nodesCountBefore = await prisma.setuKoshNode.count();

      // 2. Second attempt with exact same idempotencyKey
      const secondRun = await setuKoshService.recordPurchase(buyerMember.id, vendor.id, 100000, {
        idempotencyKey,
        bypassPinCheck: true
      });

      expect(secondRun.alreadyProcessed).toBe(true);

      const nodesCountAfter = await prisma.setuKoshNode.count();
      expect(nodesCountAfter).toBe(nodesCountBefore);
    });
  });
});
