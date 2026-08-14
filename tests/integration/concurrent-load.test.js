const prisma = require("../../src/lib/prisma");
const { createMember } = require("../../src/services/memberService");
const { purchaseIds } = require("../../src/services/idCardService");

describe("Integration: Concurrent Load", () => {
  beforeAll(async () => {
    await cleanDb();
  });

  afterAll(async () => {
    await cleanDb();
    await prisma.$disconnect();
  });

  async function cleanDb() {
    await prisma.auditLog.deleteMany({});
    await prisma.tdsLedger.deleteMany({});
    await prisma.withdrawal.deleteMany({});
    await prisma.vendorSale.deleteMany({});
    await prisma.settlementRun.deleteMany({});
    await prisma.ledgerEntry.deleteMany({});
    await prisma.commissionEntry.deleteMany({});
    await prisma.mySystemNode.deleteMany({});
    await prisma.autoPoolNode.deleteMany({});
    await prisma.setuKoshNode.deleteMany({});
    await prisma.payOnceLedger.deleteMany({});
    await prisma.memberIdCard.deleteMany({});
    await prisma.wallet.deleteMany({});
    await prisma.setuKoshCounter.deleteMany({});
    await prisma.member.deleteMany({});
    await prisma.adminUser.deleteMany({});
    await prisma.platformSetting.deleteMany({});
    await prisma.systemCounter.deleteMany({});
    
    // Seed the SystemCounter to avoid P2002 race conditions in upsert during 50 concurrent transactions
    await prisma.systemCounter.create({
      data: {
        id: "AUTOPOOL_GLOBAL",
        currentValue: 0
      }
    });
  }

  it("should process 50 concurrent ID purchases without race conditions", async () => {
    // 1. Setup 50 members
    const members = [];
    for (let i = 0; i < 50; i++) {
      const member = await createMember({
        name: `Load Member ${i}`,
        mobile: `5550000${i.toString().padStart(3, '0')}`
      });
      members.push(member);
    }

    // 2. Fire 50 concurrent purchases
    const purchasePromises = members.map(m => purchaseIds(m.id, 1));
    const results = await Promise.allSettled(purchasePromises);

    // 3. Ensure no unhandled exceptions or DB deadlocks caused failures
    const failures = results.filter(r => r.status === "rejected");
    if (failures.length > 0) {
      console.error("Failures detected:", failures.map(f => f.reason));
    }
    expect(failures.length).toBe(0);

    // 4. Verify exactly 52 IDs were created (50 direct purchases + 2 Rebirth IDs)
    const idCount = await prisma.memberIdCard.count();
    expect(idCount).toBe(52);

    // 5. Verify 52 AutoPool nodes were placed sequentially
    const apNodes = await prisma.autoPoolNode.findMany({
      orderBy: { globalPosition: 'asc' }
    });
    expect(apNodes.length).toBe(52);

    // Ensure strictly sequential global positions (1 to 52) with no gaps or duplicates
    const positions = apNodes.map(n => n.globalPosition);
    for (let i = 0; i < 52; i++) {
      expect(positions[i]).toBe(i + 1);
    }

    // Verify counter state matches
    const counter = await prisma.systemCounter.findUnique({
      where: { id: "AUTOPOOL_GLOBAL" }
    });
    expect(counter.currentValue).toBe(52);
  });
});
