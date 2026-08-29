const { truncateDb } = require("../helpers/cleanDb");
const prisma = require("../../src/lib/prisma");
const idCardService = require("../../src/services/idCardService");
const rebirthService = require("../../src/services/rebirthService");
const adminService = require("../../src/services/adminService");
const { seedSettingsAndSuperAdmin } = require("../../src/lib/seedSettings");

describe("Unit: Rebirth Priority, Placement & Cap Invariants", () => {
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

  describe("Immediate & Position-Fixed Placement", () => {
    it("should place rebirth at next consecutive globalPosition immediately when Level 4 completes", async () => {
      // Create root member (Pos 1)
      const rootMember = await prisma.member.create({
        data: { name: `Root ${unique}`, mobile: `8501${unique}`, status: "ACTIVE" }
      });
      await prisma.wallet.create({ data: { memberId: rootMember.id, balancePaise: 0 } });
      await idCardService.purchaseIds(rootMember.id, 1);

      // Place 30 additional nodes (Positions 2 through 31) to complete Level 4 for Position 1 (1*16 + 15 = 31)
      const fillerMember = await prisma.member.create({
        data: { name: `Filler ${unique}`, mobile: `8502${unique}`, status: "ACTIVE" }
      });
      await prisma.wallet.create({ data: { memberId: fillerMember.id, balancePaise: 0 } });

      // Purchasing 30 cards triggers Level 4 completion for root at position 31
      await idCardService.purchaseIds(fillerMember.id, 30);

      // Verify rebirth node was placed at Position 32
      const rebirthNode = await prisma.autoPoolNode.findUnique({
        where: { globalPosition: 32 },
        include: { idCard: true }
      });

      expect(rebirthNode).not.toBeNull();
      expect(rebirthNode.idCard.type).toBe("REBIRTH");
      expect(rebirthNode.idCard.memberId).toBe(rootMember.id);
    });
  });

  describe("Deepest / Nearest-First Rebirth Priority", () => {
    it("should order multiple simultaneous rebirth completions by deepest node first, ancestor second", async () => {
      // In a 63-node tree, placement at #63 completes L4 for #3 (depth 2) and L5 for #1 (depth 0).
      // Verify deepest ancestor node (#3) gets rebirth at #64, and shallower (#1) gets #65.

      // Root member
      const m1 = await prisma.member.create({
        data: { name: `M1 ${unique}`, mobile: `8503${unique}`, status: "ACTIVE" }
      });
      await prisma.wallet.create({ data: { memberId: m1.id, balancePaise: 0 } });
      await idCardService.purchaseIds(m1.id, 1); // Pos 1

      // Member 2 (Pos 2, Pos 3)
      const m2 = await prisma.member.create({
        data: { name: `M2 ${unique}`, mobile: `8504${unique}`, status: "ACTIVE" }
      });
      await prisma.wallet.create({ data: { memberId: m2.id, balancePaise: 0 } });
      await idCardService.purchaseIds(m2.id, 2); // Pos 2, 3

      // Place 59 filler nodes (Positions 4 through 62)
      const filler = await prisma.member.create({
        data: { name: `FillerBulk ${unique}`, mobile: `8505${unique}`, status: "ACTIVE" }
      });
      await prisma.wallet.create({ data: { memberId: filler.id, balancePaise: 0 } });
      await idCardService.purchaseIds(filler.id, 59);

      // Position 63 placement completes:
      // - Level 4 for Position 3 (3*16 + 15 = 63)
      // - Level 5 for Position 1 (1*32 + 31 = 63)
      const triggeringMember = await prisma.member.create({
        data: { name: `Trig ${unique}`, mobile: `8506${unique}`, status: "ACTIVE" }
      });
      await prisma.wallet.create({ data: { memberId: triggeringMember.id, balancePaise: 0 } });
      await idCardService.purchaseIds(triggeringMember.id, 1); // Pos 63

      // Check position 64 (Deepest node #3 / m2 rebirth)
      const node64 = await prisma.autoPoolNode.findUnique({
        where: { globalPosition: 64 },
        include: { idCard: true }
      });
      expect(node64).not.toBeNull();
      expect(node64.idCard.type).toBe("REBIRTH");
      expect(node64.idCard.memberId).toBe(m2.id);

      // Check position 65 (Ancestor node #1 / m1 rebirth)
      const node65 = await prisma.autoPoolNode.findUnique({
        where: { globalPosition: 65 },
        include: { idCard: true }
      });
      expect(node65).not.toBeNull();
      expect(node65.idCard.type).toBe("REBIRTH");
      expect(node65.idCard.memberId).toBe(m1.id);
    });
  });

  describe("Rebirth Exemption from MAX_PURCHASED_IDS Cap", () => {
    it("should allow rebirth creation even when member has reached MAX_PURCHASED_IDS cap", async () => {
      // Set cap of 2
      await prisma.platformSetting.upsert({
        where: { key: "MAX_PURCHASED_IDS" },
        create: { key: "MAX_PURCHASED_IDS", value: "2" },
        update: { value: "2" }
      });
      adminService.invalidateCache();

      const member = await prisma.member.create({
        data: { name: `CapExempt ${unique}`, mobile: `8507${unique}`, status: "ACTIVE" }
      });
      await prisma.wallet.create({ data: { memberId: member.id, balancePaise: 0 } });

      // Member purchases 2 IDs (Pos 1 and Pos 2, reaching cap)
      await idCardService.purchaseIds(member.id, 2);

      // Purchasing 1 more ID directly fails with cap error
      await expect(idCardService.purchaseIds(member.id, 1)).rejects.toThrow("purchased IDs (Limit: 2)");

      // 15 filler members purchase 2 cards each (Positions 3 through 32, triggering Pos 1 L4 at 31)
      for (let f = 0; f < 15; f++) {
        const filler = await prisma.member.create({
          data: { name: `FillCap${f}_${unique}`, mobile: `855${f}_${unique}`, status: "ACTIVE" }
        });
        await prisma.wallet.create({ data: { memberId: filler.id, balancePaise: 0 } });
        await idCardService.purchaseIds(filler.id, 2);
      }

      // Rebirth was generated for member (exempt from cap of 2)
      const allCards = await prisma.memberIdCard.findMany({ where: { memberId: member.id } });
      expect(allCards).toHaveLength(3); // 2 purchased + 1 rebirth
      const rebirthCard = allCards.find(c => c.type === "REBIRTH");
      expect(rebirthCard).toBeDefined();
    });
  });

  describe("Rebirth Card Domain Properties", () => {
    it("should ensure rebirth card has no MY SYSTEM node and participates in AutoPool only", async () => {
      const rootMember = await prisma.member.create({
        data: { name: `RootProp ${unique}`, mobile: `8509${unique}`, status: "ACTIVE" }
      });
      await prisma.wallet.create({ data: { memberId: rootMember.id, balancePaise: 0 } });
      await idCardService.purchaseIds(rootMember.id, 1); // Pos 1

      // 30 filler cards -> completes L4 for Pos 1 -> Rebirth at Pos 32
      for (let i = 1; i <= 30; i++) {
        const filler = await prisma.member.create({
          data: { name: `FillerProp ${unique}_${i}`, mobile: `8510${unique}${i.toString().padStart(2, '0')}`, status: "ACTIVE" }
        });
        await prisma.wallet.create({ data: { memberId: filler.id, balancePaise: 0 } });
        await idCardService.purchaseIds(filler.id, 1);
      }

      const rebirthCard = await prisma.memberIdCard.findFirst({
        where: { memberId: rootMember.id, type: "REBIRTH" },
        include: { mySystemNode: true, autoPoolNode: true }
      });

      expect(rebirthCard).not.toBeNull();
      expect(rebirthCard.type).toBe("REBIRTH");
      expect(rebirthCard.mySystemNode).toBeNull();
      expect(rebirthCard.autoPoolNode).not.toBeNull();
      expect(rebirthCard.autoPoolNode.globalPosition).toBe(32);
    });
  });
});
