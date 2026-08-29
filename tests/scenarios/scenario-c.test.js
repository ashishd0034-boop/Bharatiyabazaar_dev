const { truncateDb } = require("../helpers/cleanDb");
const prisma = require("../../src/lib/prisma");
const { purchaseIds } = require("../../src/services/idCardService");

describe("Scenario C & Cascading Rebirths", () => {
  const testMobile = "9999999993";
  let member;

  beforeAll(async () => {
    await cleanDb();
    
    member = await prisma.member.create({
      data: {
        name: "Test Member C",
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

  it("should generate a Rebirth ID when AutoPool Level 4 is completed", async () => {
    // 31 purchases fills positions 1 to 31. Position 31 completes L4 for Node 1.
    // This triggers a Rebirth ID placed at position 32.
    await purchaseIds(member.id, 31);
    
    const nodes = await prisma.autoPoolNode.findMany({
      orderBy: { globalPosition: 'asc' },
      include: { idCard: true }
    });

    expect(nodes.length).toBe(32); // 31 purchased + 1 rebirth
    
    const rebirthNode = nodes[31];
    expect(rebirthNode.globalPosition).toBe(32);
    expect(rebirthNode.idCard.type).toBe("REBIRTH");

    // The Rebirth ID should NOT have a MY SYSTEM node
    const mySystemNode = await prisma.mySystemNode.findUnique({
      where: { idCardId: rebirthNode.idCardId }
    });
    expect(mySystemNode).toBeNull();
  });

  it("should handle cascading rebirths cleanly (priority queue)", async () => {
    await cleanDb();
    member = await prisma.member.create({
      data: { name: "Test Member C2", mobile: testMobile, kycStatus: "VERIFIED" }
    });

    // We buy 62 IDs.
    // P1 to P31 -> fills 1 to 31. Rebirth 1 triggers -> Queue adds Rebirth (pos 32).
    // Queue processes Rebirth 1 (pos 32).
    // P32 to P46 -> fills 33 to 47. Position 47 completes L4 for Node 2.
    // Rebirth 2 triggers -> Queue adds Rebirth (pos 48).
    // P47 to P61 -> fills 49 to 63. Position 63 completes L4 for Node 3.
    // Rebirth 3 triggers -> Queue adds Rebirth (pos 64).
    // P62 -> fills 65.
    // Total nodes expected: 62 purchased + 3 Rebirths = 65 nodes.

    await purchaseIds(member.id, 62);
    
    const nodes = await prisma.autoPoolNode.findMany({
      orderBy: { globalPosition: 'asc' },
      include: { idCard: true }
    });
    
    // Total nodes: 62 purchased + 4 Rebirths = 66 nodes.
    // Rebirth 1: Node 1 L4 (at pos 31) -> takes 32
    // Rebirth 2: Node 2 L4 (at pos 47) -> takes 48
    // Rebirth 3: Node 3 L4 (at pos 63) -> takes 64
    // Rebirth 4: Node 1 L5 (at pos 63) -> takes 65
    // Purchased 62 takes 66.
    expect(nodes.length).toBe(66);
    
    const rebirths = nodes.filter(n => n.idCard.type === "REBIRTH");
    expect(rebirths.length).toBe(4);
    
    expect(rebirths[0].globalPosition).toBe(32);
    expect(rebirths[1].globalPosition).toBe(48);
    
    // At pos 63, BOTH Node 3 L4 and Node 1 L5 complete.
    // Node 3 is deeper (depth 1) than Node 1 (depth 0), so it gets priority.
    expect(rebirths[2].globalPosition).toBe(64);
    expect(rebirths[3].globalPosition).toBe(65);
  });
});
