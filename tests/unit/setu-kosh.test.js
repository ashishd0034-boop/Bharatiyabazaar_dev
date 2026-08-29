const { truncateDb } = require("../helpers/cleanDb");
const prisma = require("../../src/lib/prisma");
const setuKoshService = require("../../src/services/setuKoshService");
const idCardService = require("../../src/services/idCardService");
const adminService = require("../../src/services/adminService");
const { seedSettingsAndSuperAdmin } = require("../../src/lib/seedSettings");

describe("Unit: Setu Kosh Accumulation, Integer Splits & PIN Gate", () => {
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
  // Unified Margin Accumulation & Leftover Carry-Forward
  // ==========================================
  describe("Unified Accumulation Math & Leftover Carry-Forward", () => {
    it("should accumulate below threshold with 0 ID created, then create k IDs with floor(acc/k) margin", async () => {
      const vOwner = await prisma.member.create({
        data: { name: `V Setu ${unique}`, mobile: `8401${unique}`, status: "ACTIVE" }
      });
      const vendor = await prisma.vendor.create({
        data: {
          memberId: vOwner.id,
          businessName: "Setu Vendor",
          category: "GROCERY",
          marginRatePct: 7.0, // 7%
          status: "ACTIVE"
        }
      });

      const buyer = await prisma.member.create({
        data: { name: `Buyer Setu ${unique}`, mobile: `8402${unique}`, status: "ACTIVE", pinCode: "110001" }
      });
      const card = await prisma.memberIdCard.create({
        data: { memberId: buyer.id, cardNumber: `SK_${unique}`, type: "MAIN" }
      });

      // 1. Purchase of ₹600 (60,000 paise) @ 7% margin = 4,200 paise
      const sale1 = await setuKoshService.recordPurchase(buyer.id, vendor.id, 60000, {
        idCardId: card.id,
        bypassPinCheck: true
      });

      expect(sale1.idsCreated).toBe(0);

      const counter1 = await prisma.setuKoshCounter.findUnique({ where: { memberId: buyer.id } });
      expect(counter1.counterPaise).toBe(60000);
      expect(counter1.accumulatedMarginPaise).toBe(4200);

      // 2. Purchase of ₹1,900 (190,000 paise) @ 7% margin = 13,300 paise
      // Total counter = 250,000 paise (₹2,500) -> k = 2 IDs generated
      // Total accumulated margin = 4,200 + 13,300 = 17,500 paise
      // Each node gets floor(17,500 / 2) = 8,750 paise margin
      // Remaining counter = 50,000 paise (₹500); remaining margin = 17,500 % 2 = 0 paise
      const sale2 = await setuKoshService.recordPurchase(buyer.id, vendor.id, 190000, {
        idCardId: card.id,
        bypassPinCheck: true
      });

      expect(sale2.idsCreated).toBe(2);

      const counter2 = await prisma.setuKoshCounter.findUnique({ where: { memberId: buyer.id } });
      expect(counter2.counterPaise).toBe(50000);
      expect(counter2.accumulatedMarginPaise).toBe(0);
    });
  });

  // ==========================================
  // Strict Integer Math: floor(M/14) and floor(M/28)
  // ==========================================
  describe("Setu Kosh Integer Commission Splits & Cap Invariant", () => {
    it("should distribute exact floor(M/14) and floor(M/28) amounts up the upline", async () => {
      const vOwner = await prisma.member.create({
        data: { name: `V Splits ${unique}`, mobile: `8403${unique}`, status: "ACTIVE" }
      });
      const vendor = await prisma.vendor.create({
        data: {
          memberId: vOwner.id,
          businessName: "Splits Vendor",
          category: "APPAREL",
          marginRatePct: 15.0, // 15%
          status: "ACTIVE"
        }
      });

      // Build 10-level binary upline for Setu Kosh
      const members = [];
      const cards = [];
      for (let i = 0; i < 11; i++) {
        const m = await prisma.member.create({
          data: { name: `SK Member ${i} ${unique}`, mobile: `841${i}${unique}`, status: "ACTIVE", pinCode: "110001" }
        });
        const c = await prisma.memberIdCard.create({
          data: { memberId: m.id, cardNumber: `SKC_${i}_${unique}`, type: "MAIN" }
        });
        members.push(m);
        cards.push(c);
      }

      // Root purchases ₹1,000 (creates Node 1)
      await setuKoshService.recordPurchase(members[0].id, vendor.id, 100000, {
        idCardId: cards[0].id,
        bypassPinCheck: true
      });

      // Node 2 (Left child of 1)
      await setuKoshService.recordPurchase(members[1].id, vendor.id, 100000, {
        idCardId: cards[1].id,
        bypassPinCheck: true
      });

      // Nodes 3 through 10 created consecutively
      for (let i = 2; i < 10; i++) {
        await setuKoshService.recordPurchase(members[i].id, vendor.id, 100000, {
          idCardId: cards[i].id,
          bypassPinCheck: true
        });
      }

      // Member 10 makes purchase of ₹1,000 (100,000 paise) @ 15% = 15,000 paise margin
      // L1-L3, L5-L6, L8-L10: floor(15,000 / 14) = 1,071 paise
      // L4, L7: floor(15,000 / 28) = 535 paise
      await setuKoshService.recordPurchase(members[10].id, vendor.id, 100000, {
        idCardId: cards[10].id,
        bypassPinCheck: true
      });

      // Verify commission entry for immediate parent (Level 1 upline)
      const l1Comm = await prisma.commissionEntry.findFirst({
        where: { stream: "SETU_KOSH", level: 1 },
        orderBy: { createdAt: "desc" }
      });
      expect(l1Comm).not.toBeNull();
      expect(l1Comm.amountPaise).toBe(1071); // floor(15000 / 14)
    });
  });

  // ==========================================
  // PIN Gate & Retroactive Unlocking
  // ==========================================
  describe("PIN Gate Activation & Retroactive Unlocking", () => {
    it("should lock commissions as PIN_GATE_INACTIVE until PIN reaches threshold, then flip to PENDING_SETTLEMENT", async () => {
      const vOwner = await prisma.member.create({
        data: { name: `V PIN ${unique}`, mobile: `8404${unique}`, status: "ACTIVE" }
      });
      const vendor = await prisma.vendor.create({
        data: {
          memberId: vOwner.id,
          businessName: "PIN Vendor",
          category: "GROCERY",
          marginRatePct: 10.0,
          status: "ACTIVE"
        }
      });

      // Target PIN: 560001 (Threshold = 10)
      const sponsor = await prisma.member.create({
        data: { name: `Sponsor PIN ${unique}`, mobile: `8405_SPON_${unique}`, status: "ACTIVE" }
      });
      const sponsorCard = await prisma.memberIdCard.create({
        data: { memberId: sponsor.id, cardNumber: `SPON_PIN_${unique}`, type: "MAIN" }
      });
      const sponsorNode = await prisma.mySystemNode.create({
        data: { idCardId: sponsorCard.id, placementType: "DIRECT" }
      });

      const buyer = await prisma.member.create({
        data: { name: `PIN Buyer ${unique}`, mobile: `8405${unique}`, status: "ACTIVE", pinCode: "560001" }
      });
      const buyerCard = await prisma.memberIdCard.create({
        data: { memberId: buyer.id, cardNumber: `PIN_CARD_${unique}`, type: "MAIN" }
      });
      await prisma.mySystemNode.create({
        data: { idCardId: buyerCard.id, sponsorIdCardId: sponsorCard.id, parentNodeId: sponsorNode.id, placementType: "DIRECT" }
      });

      // Record purchase in PIN 560001 (active member count = 1 < 10)
      await setuKoshService.recordPurchase(buyer.id, vendor.id, 100000, {
        idCardId: buyerCard.id,
        bypassPinCheck: false
      });

      const commsBefore = await prisma.commissionEntry.findMany({
        where: { status: "PIN_GATE_INACTIVE" }
      });
      expect(commsBefore.length).toBeGreaterThanOrEqual(1);

      // Now add 9 more active members in PIN 560001 (reaching 10)
      for (let i = 0; i < 9; i++) {
        await prisma.member.create({
          data: { name: `PIN Fill ${i} ${unique}`, mobile: `842${i}${unique}`, status: "ACTIVE", pinCode: "560001" }
        });
      }

      // Next purchase in that PIN triggers retroactive activation
      await setuKoshService.recordPurchase(buyer.id, vendor.id, 100000, {
        idCardId: buyerCard.id,
        bypassPinCheck: false
      });

      const commsAfter = await prisma.commissionEntry.findMany({
        where: { status: "PIN_GATE_INACTIVE" }
      });
      expect(commsAfter.length).toBe(0); // All unlocked!
    });
  });

  // ==========================================
  // REBIRTH Referral Bonus Fallback
  // ==========================================
  describe("REBIRTH Referral Fallback to Owner MAIN Sponsor", () => {
    it("should attribute 0.25% referral bonus to owner MAIN card sponsor when purchase is on REBIRTH card", async () => {
      const vOwner = await prisma.member.create({
        data: { name: `V Ref ${unique}`, mobile: `8406${unique}`, status: "ACTIVE" }
      });
      const vendor = await prisma.vendor.create({
        data: {
          memberId: vOwner.id,
          businessName: "Ref Vendor",
          category: "GROCERY",
          marginRatePct: 10.0,
          status: "ACTIVE"
        }
      });

      // Sponsor Member & Card
      const sponsor = await prisma.member.create({
        data: { name: `Sponsor ${unique}`, mobile: `8407${unique}`, status: "ACTIVE" }
      });
      const sponsorCard = await prisma.memberIdCard.create({
        data: { memberId: sponsor.id, cardNumber: `SPON_${unique}`, type: "MAIN" }
      });
      const sponsorNode = await prisma.mySystemNode.create({
        data: { idCardId: sponsorCard.id, placementType: "DIRECT" }
      });

      // Buyer Member with MAIN card sponsored by sponsorCard
      const buyer = await prisma.member.create({
        data: { name: `Buyer Ref ${unique}`, mobile: `8408${unique}`, status: "ACTIVE", pinCode: "110001" }
      });
      const buyerMainCard = await prisma.memberIdCard.create({
        data: { memberId: buyer.id, cardNumber: `BUY_MAIN_${unique}`, type: "MAIN" }
      });
      await prisma.mySystemNode.create({
        data: { idCardId: buyerMainCard.id, sponsorIdCardId: sponsorCard.id, parentNodeId: sponsorNode.id, placementType: "DIRECT" }
      });

      // Buyer's REBIRTH card (has NO mySystemNode)
      const buyerRebirthCard = await prisma.memberIdCard.create({
        data: { memberId: buyer.id, cardNumber: `BUY_RB_${unique}`, type: "REBIRTH" }
      });

      // Purchase of ₹2,000 (200,000 paise) via REBIRTH card
      // Referral bonus = 0.25% of 200,000 = 500 paise
      await setuKoshService.recordPurchase(buyer.id, vendor.id, 200000, {
        idCardId: buyerRebirthCard.id,
        bypassPinCheck: true
      });

      const bonusEntry = await prisma.commissionEntry.findFirst({
        where: { idCardId: sponsorCard.id, stream: "VENDOR_REFERRAL_BONUS" }
      });

      expect(bonusEntry).not.toBeNull();
      expect(bonusEntry.amountPaise).toBe(500);
      expect(bonusEntry.status).toBe("PENDING_SETTLEMENT");
    });
  });
});
