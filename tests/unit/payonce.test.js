const { truncateDb } = require("../helpers/cleanDb");
const prisma = require("../../src/lib/prisma");
const payOnceService = require("../../src/services/payOnceService");
const commissionService = require("../../src/services/commissionService");
const adminService = require("../../src/services/adminService");
const { seedSettingsAndSuperAdmin } = require("../../src/lib/seedSettings");

describe("Unit: Pay-Once Engine & Cross-Stream Invariants", () => {
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

  describe("Pay-Once Service Pure Logic", () => {
    it("should accurately track hasAlreadyPaid status on PayOnceLedger", async () => {
      const member = await prisma.member.create({
        data: { name: `PayOnce M1 ${unique}`, mobile: `8801${unique}`, status: "ACTIVE" }
      });
      const card = await prisma.memberIdCard.create({
        data: { memberId: member.id, cardNumber: `PO1_${unique}`, type: "MAIN", acbStatus: true }
      });

      // 1. Initial check is false
      await prisma.$transaction(async (tx) => {
        const paidBefore = await payOnceService.hasAlreadyPaid(tx, card.id, 1);
        expect(paidBefore).toBe(false);

        // 2. Record payment
        await payOnceService.recordPayment(tx, card.id, 1, "AUTOPOOL");

        // 3. Subsequent check is true
        const paidAfter = await payOnceService.hasAlreadyPaid(tx, card.id, 1);
        expect(paidAfter).toBe(true);

        // 4. Other levels remain false
        const level2Paid = await payOnceService.hasAlreadyPaid(tx, card.id, 2);
        expect(level2Paid).toBe(false);
      });
    });

    it("should prevent duplicate inserts for same (idCardId, level) in PayOnceLedger", async () => {
      const member = await prisma.member.create({
        data: { name: `PayOnce M2 ${unique}`, mobile: `8802${unique}`, status: "ACTIVE" }
      });
      const card = await prisma.memberIdCard.create({
        data: { memberId: member.id, cardNumber: `PO2_${unique}`, type: "MAIN", acbStatus: true }
      });

      await prisma.$transaction(async (tx) => {
        await payOnceService.recordPayment(tx, card.id, 1, "AUTOPOOL");
      });

      // Duplicate attempt should reject with unique constraint error
      await expect(
        prisma.$transaction(async (tx) => {
          await payOnceService.recordPayment(tx, card.id, 1, "MY_SYSTEM");
        })
      ).rejects.toThrow();
    });
  });

  describe("Tie-Breaker: AutoPool First vs MY SYSTEM Second", () => {
    it("should create PAY_ONCE_BLOCKED with amount 0 when MY SYSTEM Level N follows AutoPool Level N", async () => {
      const member = await prisma.member.create({
        data: { name: `TieBreaker M1 ${unique}`, mobile: `8803${unique}`, status: "ACTIVE" }
      });
      await prisma.wallet.create({ data: { memberId: member.id, balancePaise: 0 } });
      const card = await prisma.memberIdCard.create({
        data: { memberId: member.id, cardNumber: `TB1_${unique}`, type: "MAIN", acbStatus: true }
      });

      // 1. AutoPool Level 1 completes first (₹300 = 30,000 paise)
      await prisma.$transaction(async (tx) => {
        await commissionService.calculateAndCreateCommissions(tx, card.id, 1, "AUTOPOOL", 30000);
      });

      const autoPoolComm = await prisma.commissionEntry.findFirst({
        where: { idCardId: card.id, stream: "AUTOPOOL", level: 1 }
      });
      expect(autoPoolComm.amountPaise).toBe(30000);
      expect(autoPoolComm.status).toBe("WITHDRAWABLE");

      // 2. MY SYSTEM Level 1 is processed second
      await prisma.$transaction(async (tx) => {
        await commissionService.calculateAndCreateCommissions(tx, card.id, 1, "MY_SYSTEM", 30000);
      });

      const mySysComm = await prisma.commissionEntry.findFirst({
        where: { idCardId: card.id, stream: "MY_SYSTEM", level: 1 }
      });
      expect(mySysComm).not.toBeNull();
      expect(mySysComm.amountPaise).toBe(0);
      expect(mySysComm.status).toBe("PAY_ONCE_BLOCKED");

      // Wallet should have only received the single ₹300 credit
      const wallet = await prisma.wallet.findUnique({ where: { memberId: member.id } });
      expect(wallet.balancePaise).toBe(30000);
    });

    it("should block AutoPool Level 2 if MY SYSTEM Level 2 completes first", async () => {
      const member = await prisma.member.create({
        data: { name: `TieBreaker M2 ${unique}`, mobile: `8804${unique}`, status: "ACTIVE" }
      });
      await prisma.wallet.create({ data: { memberId: member.id, balancePaise: 0 } });
      const card = await prisma.memberIdCard.create({
        data: { memberId: member.id, cardNumber: `TB2_${unique}`, type: "MAIN", acbStatus: true }
      });

      // 1. MY SYSTEM Level 2 completes first (₹300 = 30,000 paise)
      await prisma.$transaction(async (tx) => {
        await commissionService.calculateAndCreateCommissions(tx, card.id, 2, "MY_SYSTEM", 30000);
      });

      const mySysComm = await prisma.commissionEntry.findFirst({
        where: { idCardId: card.id, stream: "MY_SYSTEM", level: 2 }
      });
      expect(mySysComm.amountPaise).toBe(30000);

      // 2. AutoPool Level 2 is processed second
      await prisma.$transaction(async (tx) => {
        await commissionService.calculateAndCreateCommissions(tx, card.id, 2, "AUTOPOOL", 30000);
      });

      const autoPoolComm = await prisma.commissionEntry.findFirst({
        where: { idCardId: card.id, stream: "AUTOPOOL", level: 2 }
      });
      expect(autoPoolComm).not.toBeNull();
      expect(autoPoolComm.amountPaise).toBe(0);
      expect(autoPoolComm.status).toBe("PAY_ONCE_BLOCKED");
    });
  });

  describe("Multi-Level Independence", () => {
    it("should allow Level 2 to be earned even if Level 1 was blocked", async () => {
      const member = await prisma.member.create({
        data: { name: `Indep M ${unique}`, mobile: `8805${unique}`, status: "ACTIVE" }
      });
      await prisma.wallet.create({ data: { memberId: member.id, balancePaise: 0 } });
      const card = await prisma.memberIdCard.create({
        data: { memberId: member.id, cardNumber: `IND_${unique}`, type: "MAIN", acbStatus: true }
      });

      // Pay Level 1 via AutoPool
      await prisma.$transaction(async (tx) => {
        await commissionService.calculateAndCreateCommissions(tx, card.id, 1, "AUTOPOOL", 30000);
      });

      // Block MY SYSTEM Level 1
      await prisma.$transaction(async (tx) => {
        await commissionService.calculateAndCreateCommissions(tx, card.id, 1, "MY_SYSTEM", 30000);
      });

      // Now pay MY SYSTEM Level 2 (should succeed!)
      await prisma.$transaction(async (tx) => {
        await commissionService.calculateAndCreateCommissions(tx, card.id, 2, "MY_SYSTEM", 30000);
      });

      const l2Comm = await prisma.commissionEntry.findFirst({
        where: { idCardId: card.id, stream: "MY_SYSTEM", level: 2 }
      });
      expect(l2Comm.amountPaise).toBe(30000);
      expect(l2Comm.status).not.toBe("PAY_ONCE_BLOCKED");
    });
  });
});
