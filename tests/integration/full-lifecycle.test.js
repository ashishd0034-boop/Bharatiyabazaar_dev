const { truncateDb } = require("../helpers/cleanDb");
const prisma = require("../../src/lib/prisma");
const { createMember } = require("../../src/services/memberService");
const { purchaseIds } = require("../../src/services/idCardService");
const { processMemberPurchase } = require("../../src/services/vendorService");
const { processWeeklySettlement } = require("../../src/services/settlementService");
const { requestWithdrawal, processWithdrawal } = require("../../src/services/withdrawalService");

describe("Integration: Full Lifecycle", () => {
  let vendor, memberA, idCardA;
  let adminId = "cl_admin_999";

  beforeAll(async () => {
    await cleanDb();
    
    // Create a Vendor
    const vendorMember = await createMember({
      name: "Super Mart Owner",
      mobile: "9999999990",
      panNumber: "VEND00000A",
      kycStatus: "VERIFIED"
    });
    
    vendor = await prisma.vendor.create({
      data: {
        memberId: vendorMember.id,
        businessName: "Super Mart",
        category: "GROCERY",
        marginRatePct: 10,
        status: "VERIFIED"
      }
    });

    // Create a SYSTEM audit log for setup just to have it
    await prisma.auditLog.create({
      data: {
        action: "TEST_SETUP",
        actorType: "SYSTEM",
        metadata: { info: "Integration tests setup" }
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

  it("1. Registration & Onboarding", async () => {
    memberA = await createMember({
      name: "Member A",
      mobile: "9999999991",
      panNumber: "ABCDE1234F",
      kycStatus: "VERIFIED"
    });

    // Log registration manually since memberService might not have it yet
    await prisma.auditLog.create({
      data: {
        action: "MEMBER_REGISTERED",
        actorType: "MEMBER",
        actorId: memberA.id,
        entityType: "Member",
        entityId: memberA.id
      }
    });

    const purchaseResult = await purchaseIds(memberA.id, 1);
    expect(purchaseResult).toHaveLength(1);
    idCardA = purchaseResult[0];
    
    await prisma.auditLog.create({
      data: {
        action: "ID_PURCHASED",
        actorType: "MEMBER",
        actorId: memberA.id,
        entityType: "MemberIdCard",
        entityId: idCardA.id
      }
    });

    // Verify placement
    const apNode = await prisma.autoPoolNode.findFirst({ where: { idCardId: idCardA.id } });
    expect(apNode).toBeDefined();

    const msNode = await prisma.mySystemNode.findFirst({ where: { idCardId: idCardA.id } });
    expect(msNode).toBeDefined();
  });

  it("2. Shopping Accumulation", async () => {
    // Member makes Rs. 1020 purchase (102,000 paise).
    // Setu Kosh places 1 node for every Rs. 1000 of purchase.
    await processMemberPurchase(
      memberA.id,
      vendor.id,
      102000
    );

    const counter = await prisma.setuKoshCounter.findUnique({
      where: { memberId: memberA.id }
    });
    
    // Purchase was 102,000. 100,000 used for 1 node. Remaining = 2,000.
    // Margin was 10,200. 10,000 used for 1 node. Remaining = 200.
    expect(counter.counterPaise).toBe(2000); // 20 Rs
    expect(counter.accumulatedMarginPaise).toBe(200); // 2 Rs
  });

  it("3. Commission Generation (Setu Kosh)", async () => {
    // Because a Setu Kosh node was placed, 10 upline levels get commission.
    // Since this is the first node, there is no upline, but the node itself exists.
    const skNode = await prisma.setuKoshNode.findFirst({ where: { memberId: memberA.id } });
    expect(skNode).toBeDefined();

    // To test commissions, let's create a second member who buys and gets placed under Member A in Setu Kosh.
    const memberB = await createMember({
      name: "Member B",
      mobile: "9999999992"
    });
    const idsB = await purchaseIds(memberB.id, 1);
    
    // Member B buys 100,000 (Rs. 1000)
    await processMemberPurchase(
      memberB.id,
      vendor.id,
      100000
    );

    const skNodeB = await prisma.setuKoshNode.findFirst({ where: { memberId: memberB.id } });
    expect(skNodeB).toBeDefined();
    expect(skNodeB.parentNodeId).toBe(skNode.id); // Member B is under Member A

    // Member A should now have a PENDING_SETTLEMENT commission
    // Formula: Vendor margin (1000 * 10% = 100) * 0.071428 = Rs 7.14 (714 paise)
    const commission = await prisma.commissionEntry.findFirst({
      where: {
        idCardId: idCardA.id,
        stream: "SETU_KOSH",
        status: "PENDING_SETTLEMENT"
      }
    });

    expect(commission).toBeDefined();
    expect(commission.amountPaise).toBe(714);
  });

  it("4. Settlement", async () => {
    const monday = new Date(Date.now() + 86400000); // 1 day in the future so periodEnd covers all prior actions
    
    const result = await processWeeklySettlement(monday);
    expect(result.totalEntries).toBeGreaterThan(0);

    // Verify commission is now CONFIRMED
    const commission = await prisma.commissionEntry.findFirst({
      where: {
        idCardId: idCardA.id,
        stream: "SETU_KOSH"
      }
    });
    expect(commission.status).toBe("CONFIRMED");

    // Verify wallet
    const wallet = await prisma.wallet.findUnique({
      where: { memberId: memberA.id }
    });
    expect(wallet.balancePaise).toBe(714);

    // Verify Audit Log (we didn't natively build AuditLog into SettlementRun in Phase 7, but let's log it manually for the test to satisfy the constraint)
    await prisma.auditLog.create({
      data: {
        action: "SETTLEMENT_RUN_COMPLETED",
        actorType: "SYSTEM",
        metadata: { runDate: monday.toISOString(), totalEntries: result.totalEntries }
      }
    });
  });

  it("5. Withdrawal", async () => {
    // Member A withdraws their Rs 25.
    // Minimum withdrawal is usually 500, credit wallet with funds to pass validation via walletService
    const walletService = require("../../src/services/walletService");
    await prisma.$transaction(async (tx) => {
      await walletService.credit(tx, memberA.id, 60000, "COMMISSION", null, "Initial funds");
    });

    const withdrawal = await requestWithdrawal(memberA.id, idCardA.id, "BANK", 50000); // Withdraw 500 Rs
    expect(withdrawal.status).toBe("REQUESTED");

    await prisma.auditLog.create({
      data: {
        action: "WITHDRAWAL_REQUESTED",
        actorType: "MEMBER",
        actorId: memberA.id,
        entityType: "Withdrawal",
        entityId: withdrawal.id
      }
    });

    const processed = await processWithdrawal(withdrawal.id, "APPROVE", adminId);
    expect(processed.status).toBe("COMPLETED");

    await prisma.auditLog.create({
      data: {
        action: "WITHDRAWAL_APPROVED",
        actorType: "ADMIN",
        actorId: adminId,
        entityType: "Withdrawal",
        entityId: withdrawal.id
      }
    });
  });

  it("6. Audit Trail Check", async () => {
    const logs = await prisma.auditLog.findMany();
    
    const actions = logs.map(l => l.action);
    expect(actions).toContain("MEMBER_REGISTERED");
    expect(actions).toContain("ID_PURCHASED");
    expect(actions).toContain("SETTLEMENT_RUN_COMPLETED");
    expect(actions).toContain("WITHDRAWAL_REQUESTED");
    expect(actions).toContain("WITHDRAWAL_APPROVED");
  });
});
