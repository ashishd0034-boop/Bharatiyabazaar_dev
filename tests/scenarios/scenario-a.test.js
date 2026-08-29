const { truncateDb } = require("../helpers/cleanDb");
const prisma = require("../../src/lib/prisma");
const { purchaseIds } = require("../../src/services/idCardService");

describe("Scenario A: Member joins with 3 IDs", () => {
  let member;
  const testMobile = "9999999991";

  beforeAll(async () => {
    await cleanDb();
    
    // Create a dummy member
    member = await prisma.member.create({
      data: {
        name: "Test Member A",
        mobile: testMobile,
        kycStatus: "VERIFIED"
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

  it("should calculate correct commissions and ACB status", async () => {
    const cards = await purchaseIds(member.id, 3);
    expect(cards).toHaveLength(3);
    
    const mainCard = cards.find(c => c.type === "MAIN");
    expect(mainCard).toBeDefined();

    // Verify Main Card ACB status
    const updatedMainCard = await prisma.memberIdCard.findUnique({
      where: { id: mainCard.id }
    });
    expect(updatedMainCard.acbStatus).toBe(true);

    // Verify AutoPool Commission (should be CONFIRMED since ACB is achieved)
    const autoPoolCommissions = await prisma.commissionEntry.findMany({
      where: { idCardId: mainCard.id, stream: "AUTOPOOL" }
    });
    expect(autoPoolCommissions).toHaveLength(1);
    expect(autoPoolCommissions[0].level).toBe(1);
    expect(autoPoolCommissions[0].amountPaise).toBe(30000);
    expect(autoPoolCommissions[0].status).toBe("WITHDRAWABLE");

    // Verify MY SYSTEM Commission (should be PAY_ONCE_BLOCKED)
    const mySystemCommissions = await prisma.commissionEntry.findMany({
      where: { idCardId: mainCard.id, stream: "MY_SYSTEM" }
    });
    expect(mySystemCommissions).toHaveLength(1);
    expect(mySystemCommissions[0].level).toBe(1);
    expect(mySystemCommissions[0].amountPaise).toBe(0);
    expect(mySystemCommissions[0].status).toBe("PAY_ONCE_BLOCKED");

    // Sub IDs should have NO commissions
    const subCardIds = cards.filter(c => c.type === "SUB").map(c => c.id);
    const subCommissions = await prisma.commissionEntry.findMany({
      where: { idCardId: { in: subCardIds } }
    });
    expect(subCommissions).toHaveLength(0);
  });
});
