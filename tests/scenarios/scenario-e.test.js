const prisma = require("../../src/lib/prisma");
const { processMemberPurchase } = require("../../src/services/vendorService");
const walletService = require("../../src/services/walletService");

describe("Scenario E: Setu Kosh Engine", () => {
  let sponsor;
  let sponsorIdCard;
  let member;
  let memberIdCard;
  let vendor;

  beforeAll(async () => {
    await cleanDb();
    
    // 1. Create Sponsor
    sponsor = await prisma.member.create({
      data: {
        name: "Sponsor E",
        mobile: "8888888881",
        kycStatus: "VERIFIED"
      }
    });

    sponsorIdCard = await prisma.memberIdCard.create({
      data: {
        memberId: sponsor.id,
        cardNumber: "SPO5555",
        type: "MAIN"
      }
    });
    
    // Set sponsor as root of MySystem for this test
    const sponsorSystemNode = await prisma.mySystemNode.create({
      data: {
        idCardId: sponsorIdCard.id,
        parentNodeId: null, // Root
      }
    });

    // 2. Create Purchasing Member
    member = await prisma.member.create({
      data: {
        name: "Purchasing Member E",
        mobile: "8888888882",
        kycStatus: "VERIFIED"
      }
    });

    memberIdCard = await prisma.memberIdCard.create({
      data: {
        memberId: member.id,
        cardNumber: "PUR5555",
        type: "MAIN"
      }
    });
    
    // Place under sponsor in MySystem
    await prisma.mySystemNode.create({
      data: {
        idCardId: memberIdCard.id,
        parentNodeId: sponsorSystemNode.id,
        side: "LEFT"
      }
    });

    // 3. Create a verified Vendor with 10% margin
    vendor = await prisma.vendor.create({
      data: {
        memberId: member.id, // technically a vendor must be a member, let's reuse member or create new
        businessName: "Vendor E Store",
        category: "GROCERY",
        marginRatePct: 10.0,
        status: "VERIFIED",
        securityDepositPaise: 500000
      }
    });
  });

  afterAll(async () => {
    await cleanDb();
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await new Promise(r => setTimeout(r, 100)); // prevent connection exhaustion
  });

  async function cleanDb() {
    await prisma.ledgerEntry.deleteMany({});
    await prisma.commissionEntry.deleteMany({});
    await prisma.vendorReferralBonus.deleteMany({});
    await prisma.setuKoshNode.deleteMany({});
    await prisma.mySystemNode.deleteMany({});
    await prisma.autoPoolNode.deleteMany({});
    await prisma.vendorSale.deleteMany({});
    await prisma.wallet.deleteMany({});
    await prisma.memberIdCard.deleteMany({});
    await prisma.setuKoshCounter.deleteMany({});
    await prisma.vendor.deleteMany({});
    await prisma.member.deleteMany({});
    await prisma.systemCounter.deleteMany({ where: { id: "SETUKOSH_POSITION" }});
  }

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
        memberId: sponsor.id, // different member
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
    
    // Math for accumulated margin:
    // Before tip: 8000
    // Added: 40000 * 20% = 8000
    // Total before deduction: 16000
    // Total counter before deduction: 120000
    // Weighted margin: floor(16000 * 100 / 120000) = floor(13.33) = 13%
    // Deducted margin: floor(100000 * 13 / 100) = 13000
    // Remaining margin: 16000 - 13000 = 3000
    expect(counter.accumulatedMarginPaise).toBe(3000);

    // Check SetuKoshNode created
    const nodes = await prisma.setuKoshNode.findMany();
    expect(nodes.length).toBe(1);
    expect(nodes[0].globalPosition).toBe(1);
    expect(nodes[0].memberId).toBe(member.id);
  });

  it("should create correct binary tree placement for subsequent Setu Kosh IDs", async () => {
    // Generate 2 more IDs to test placement
    // Currently counter is 20,000. Need 180,000 more to create 2 IDs.
    // Let's buy Rs. 1,800 at 10% margin.
    await processMemberPurchase(member.id, vendor.id, 180000);
    
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

  it("should calculate correct commissions and apply half-rates for L4 and L7", async () => {
    // Let's create a deep line of Setu Kosh Nodes directly in the DB to test upline distribution
    // We already have positions 1, 2, 3.
    // Let's clear the tree and build a 10-level straight line to make it easy to test
    await prisma.commissionEntry.deleteMany({ where: { stream: "SETU_KOSH" }});
    await prisma.setuKoshNode.deleteMany({});
    await prisma.systemCounter.deleteMany({ where: { id: "SETUKOSH_POSITION" }});

    // Create 11 members to hold 11 positions
    const testMembers = [];
    for (let i = 1; i <= 11; i++) {
      const m = await prisma.member.create({
        data: { name: `M${i}`, mobile: `88800000${i.toString().padStart(2, '0')}`, kycStatus: "VERIFIED" }
      });
      const idc = await prisma.memberIdCard.create({
        data: { memberId: m.id, cardNumber: `C${i}`, type: "MAIN" }
      });
      testMembers.push({ member: m, idCard: idc });
    }

    // Process purchases specifically so they form a perfect line?
    // Breadth-first generation means it fills level by level. 
    // To test L10, we'd need 1023 nodes!
    // Instead, let's manually create 10 ancestor nodes in a straight line, just for this unit test.
    let parentNodeId = null;
    let nodes = [];
    for (let i = 1; i <= 10; i++) {
      const node = await prisma.setuKoshNode.create({
        data: {
          memberId: testMembers[i-1].member.id,
          globalPosition: i, // Faking global positions just to build the tree
          parentNodeId,
          depthLevel: i - 1,
          side: "LEFT"
        }
      });
      parentNodeId = node.id;
      nodes.push(node);
    }

    // Now process a purchase for M11 that triggers exactly 1 ID placement.
    // We will bypass the `vendorService` to directly call `setuKoshService.distributeCommissions`
    // with a mock new node that is child of the 10th node.
    const { distributeCommissions } = require("../../src/services/setuKoshService");
    
    const newNode = await prisma.setuKoshNode.create({
      data: {
        memberId: testMembers[10].member.id,
        globalPosition: 11,
        parentNodeId: nodes[9].id,
        depthLevel: 10,
        side: "LEFT"
      }
    });

    // 10% margin
    await distributeCommissions(prisma, newNode, 10);

    // Verify commissions
    const commissions = await prisma.commissionEntry.findMany({
      where: { stream: "SETU_KOSH" },
      orderBy: { level: 'asc' }
    });

    // We should have 10 commissions
    expect(commissions.length).toBe(10);
    
    // Base rate for 10% margin = 10% of 100000 = 10000 paise.
    // 10000 * 0.071428 = 714.28 -> 714 paise.
    const expectedBaseRate = 714;
    const expectedHalfRate = Math.floor(expectedBaseRate / 2); // 357 paise

    for (let i = 0; i < 10; i++) {
      const comm = commissions[i];
      const currentLevel = i + 1; // 1-indexed
      expect(comm.level).toBe(currentLevel);
      expect(comm.status).toBe("PENDING_SETTLEMENT");
      
      if (currentLevel === 4 || currentLevel === 7) {
        expect(comm.amountPaise).toBe(expectedHalfRate);
      } else {
        expect(comm.amountPaise).toBe(expectedBaseRate);
      }
    }

    // Cleanup the test members using strict dependency order
    await prisma.commissionEntry.deleteMany({ where: { idCardId: { in: testMembers.map(m => m.idCard.id) } }});
    await prisma.setuKoshNode.deleteMany({});
    await prisma.memberIdCard.deleteMany({ where: { memberId: { in: testMembers.map(m => m.member.id) } }});
    await prisma.member.deleteMany({ where: { id: { in: testMembers.map(m => m.member.id) } }});
    await prisma.systemCounter.deleteMany({ where: { id: "SETUKOSH_POSITION" }});
  });

  it("should record 0.25% vendor referral bonus for the MY SYSTEM sponsor", async () => {
    // Isolate test by clearing previous referral bonuses
    await prisma.commissionEntry.deleteMany({ where: { stream: "VENDOR_REFERRAL_BONUS" }});
    await prisma.vendorReferralBonus.deleteMany({});
    // M2 (Purchasing Member E) buys Rs. 10,000
    // Sponsor should get 0.25% of 1,000,000 = 2,500 paise
    await processMemberPurchase(member.id, vendor.id, 1000000);

    const commissions = await prisma.commissionEntry.findMany({
      where: { stream: "VENDOR_REFERRAL_BONUS", idCardId: sponsorIdCard.id }
    });

    expect(commissions.length).toBe(1);
    expect(commissions[0].amountPaise).toBe(2500);
    expect(commissions[0].status).toBe("PENDING_SETTLEMENT");

    const bonusLogs = await prisma.vendorReferralBonus.findMany({
      where: { memberId: sponsor.id, referredVendorId: vendor.id }
    });
    
    expect(bonusLogs.length).toBe(1);
    expect(bonusLogs[0].bonusPaise).toBe(2500);
    expect(bonusLogs[0].status).toBe("PENDING");
  });
});
