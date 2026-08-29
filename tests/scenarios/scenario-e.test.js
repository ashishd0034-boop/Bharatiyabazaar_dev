const { truncateDb } = require("../helpers/cleanDb");
const prisma = require("../../src/lib/prisma");
const { processMemberPurchase } = require("../../src/services/vendorService");
const { calculateCommissionSplits, SYSTEM_COUNTER_ID } = require("../../src/services/setuKoshService");

describe("Scenario E: Setu Kosh Engine", () => {
  let sponsor;
  let sponsorIdCard;
  let member;
  let memberIdCard;
  let vendor;

  async function cleanDb() {
    await truncateDb(prisma);
  }

  async function setupBase() {
    // 1. Create Sponsor
    sponsor = await prisma.member.create({
      data: {
        name: "Sponsor E",
        mobile: `88888888${Date.now().toString().slice(-2)}1`,
        kycStatus: "VERIFIED"
      }
    });

    sponsorIdCard = await prisma.memberIdCard.create({
      data: {
        memberId: sponsor.id,
        cardNumber: `SPO_${Date.now().toString().slice(-4)}`,
        type: "MAIN"
      }
    });
    
    // Set sponsor as root of MySystem for this test
    const sponsorSystemNode = await prisma.mySystemNode.create({
      data: {
        idCardId: sponsorIdCard.id,
        parentNodeId: null, // Root
        placementType: "DIRECT"
      }
    });

    // 2. Create Purchasing Member
    member = await prisma.member.create({
      data: {
        name: "Purchasing Member E",
        mobile: `88888888${Date.now().toString().slice(-2)}2`,
        kycStatus: "VERIFIED"
      }
    });

    memberIdCard = await prisma.memberIdCard.create({
      data: {
        memberId: member.id,
        cardNumber: `PUR_${Date.now().toString().slice(-4)}`,
        type: "MAIN"
      }
    });
    
    // Place under sponsor in MySystem
    await prisma.mySystemNode.create({
      data: {
        idCardId: memberIdCard.id,
        parentNodeId: sponsorSystemNode.id,
        side: "LEFT",
        placementType: "DIRECT"
      }
    });

    // 3. Create a verified Vendor with 10% margin
    vendor = await prisma.vendor.create({
      data: {
        memberId: member.id,
        businessName: "Vendor E Store",
        category: "GROCERY",
        marginRatePct: 10.0,
        status: "VERIFIED",
        securityDepositPaise: 500000
      }
    });
  }

  beforeEach(async () => {
    await cleanDb();
    await setupBase();
  });

  afterAll(async () => {
    await cleanDb();
    await prisma.$disconnect();
  });

  it("should accumulate purchases and carry forward overflow", async () => {
    // Member buys Rs. 400 at 10% margin vendor
    await processMemberPurchase(member.id, vendor.id, 40000);
    
    let counter = await prisma.setuKoshCounter.findUnique({ where: { memberId: member.id } });
    expect(counter.counterPaise).toBe(40000);
    expect(counter.accumulatedMarginPaise).toBe(4000); // 10% of 40000
    expect(counter.idsCreated).toBe(0);

    // Member buys another Rs. 400 at 10% margin vendor
    await processMemberPurchase(member.id, vendor.id, 40000);
    
    counter = await prisma.setuKoshCounter.findUnique({ where: { memberId: member.id } });
    expect(counter.counterPaise).toBe(80000);
    expect(counter.accumulatedMarginPaise).toBe(8000);
    expect(counter.idsCreated).toBe(0);

    // Member buys Rs. 400 at 20% margin vendor (create new vendor first)
    const vendor20 = await prisma.vendor.create({
      data: {
        memberId: sponsor.id,
        businessName: "Vendor E 20",
        category: "ELECTRONICS",
        marginRatePct: 20.0,
        status: "VERIFIED"
      }
    });

    await processMemberPurchase(member.id, vendor20.id, 40000);

    // Counter reached 120,000. It should have generated 1 ID and kept 20,000.
    counter = await prisma.setuKoshCounter.findUnique({ where: { memberId: member.id } });
    
    expect(counter.counterPaise).toBe(20000); // 120000 - 100000
    expect(counter.idsCreated).toBe(1);
    
    // Unified Margin Accumulation: 16,000 margin paise used for 1 ID -> leftover = 0
    expect(counter.accumulatedMarginPaise).toBe(0);

    // Check SetuKoshNode created
    const nodes = await prisma.setuKoshNode.findMany();
    expect(nodes.length).toBe(1);
    expect(nodes[0].globalPosition).toBe(1);
    expect(nodes[0].memberId).toBe(member.id);
  });

  it("should create correct binary tree placement for subsequent Setu Kosh IDs", async () => {
    // Generate 3 IDs total: First Rs. 1000, then Rs. 2000
    await processMemberPurchase(member.id, vendor.id, 100000); // ID 1 (Pos 1)
    await processMemberPurchase(member.id, vendor.id, 200000); // ID 2 & 3 (Pos 2 & 3)
    
    const nodes = await prisma.setuKoshNode.findMany({ orderBy: { globalPosition: 'asc' }});
    expect(nodes.length).toBe(3);
    
    // Position 2: Child of 1, LEFT
    expect(nodes[1].globalPosition).toBe(2);
    expect(nodes[1].parentNodeId).toBe(nodes[0].id);
    expect(nodes[1].side).toBe("LEFT");
    expect(nodes[1].depthLevel).toBe(1);

    // Position 3: Child of 1, RIGHT
    expect(nodes[2].globalPosition).toBe(3);
    expect(nodes[2].parentNodeId).toBe(nodes[0].id);
    expect(nodes[2].side).toBe("RIGHT");
    expect(nodes[2].depthLevel).toBe(1);
  });

  it("should calculate correct commissions and apply half-rates for L4 and L7", () => {
    // Pure math verification on calculateCommissionSplits
    const splits10k = calculateCommissionSplits(10000, 100000);
    expect(splits10k.levelAmounts).toBeDefined();
    
    // Base rate for 10000 paise margin = floor(10000 / 14) = 714 paise.
    // Half rate for L4 & L7 = floor(10000 / 28) = 357 paise.
    const expectedBaseRate = Math.floor(10000 / 14); // 714
    const expectedHalfRate = Math.floor(10000 / 28); // 357

    for (let i = 1; i <= 10; i++) {
      const amount = splits10k.levelAmounts[i];
      if (i === 4 || i === 7) {
        expect(amount).toBe(expectedHalfRate);
      } else {
        expect(amount).toBe(expectedBaseRate);
      }
    }
  });

  it("should record 0.25% vendor referral bonus for the MY SYSTEM sponsor", async () => {
    // M2 (Purchasing Member E) buys Rs. 10,000
    // Sponsor should get 0.25% of 1,000,000 = 2,500 paise
    await processMemberPurchase(member.id, vendor.id, 1000000);

    const commissions = await prisma.commissionEntry.findMany({
      where: { stream: "VENDOR_REFERRAL_BONUS", idCardId: sponsorIdCard.id }
    });

    expect(commissions.length).toBe(1);
    expect(commissions[0].amountPaise).toBe(2500);
    expect(["PENDING_SETTLEMENT", "PIN_GATE_INACTIVE"]).toContain(commissions[0].status);

    const bonusLogs = await prisma.vendorReferralBonus.findMany({
      where: { memberId: sponsor.id }
    });
    expect(bonusLogs.length).toBe(1);
    expect(bonusLogs[0].bonusPaise).toBe(2500);
  });
});
