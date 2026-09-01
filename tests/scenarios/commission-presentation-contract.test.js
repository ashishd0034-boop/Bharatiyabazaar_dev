const request = require("supertest");
const app = require("../../src/server");
const prisma = require("../../src/lib/prisma");
const { truncateDb } = require("../helpers/cleanDb");
const { seedSettingsAndSuperAdmin } = require("../../src/lib/seedSettings");
const { adminGeneratePins } = require("../../src/services/pinService");
const CommissionUI = require("../../public/js/commission-ui");

describe("Commission Presentation & Status Vocabulary Contract", () => {
  let superAdmin, member, mainCard, subCard, rebirthCard, token;

  beforeAll(async () => {
    await truncateDb(prisma);
    await seedSettingsAndSuperAdmin();

    superAdmin = await prisma.adminUser.findFirst({ where: { role: "SUPER_ADMIN" } });

    // Generate 3-ID PIN
    const pinRes = await adminGeneratePins(superAdmin.id, 1, 3, "Test Pioneer");
    const pin = pinRes.pins[0].pinCode;

    // Register 3-ID Member
    const regRes = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Presentation Test Member",
        mobile: "9876500001",
        password: "password123",
        activationPin: pin,
        side: "LEFT"
      });
    expect(regRes.status).toBe(201);
    member = regRes.body.data.member;

    const cards = await prisma.memberIdCard.findMany({
      where: { memberId: member.id },
      orderBy: { createdAt: "asc" }
    });
    mainCard = cards.find(c => c.type === "MAIN");
    subCard = cards.find(c => c.type === "SUB");

    // Create a Rebirth Card
    rebirthCard = await prisma.memberIdCard.create({
      data: {
        memberId: member.id,
        cardNumber: "RB10001",
        type: "REBIRTH",
        status: "ACTIVE",
        acbStatus: true
      }
    });

    // Create a series of commission entries with various statuses
    await prisma.commissionEntry.createMany({
      data: [
        {
          idCardId: mainCard.id,
          stream: "MY_SYSTEM",
          level: 1,
          amountPaise: 50000,
          status: "PENDING_7_DAY",
          createdAt: new Date()
        },
        {
          idCardId: mainCard.id,
          stream: "AUTOPOOL",
          level: 1,
          amountPaise: 30000,
          status: "WITHDRAWABLE",
          createdAt: new Date(Date.now() - 86400000)
        },
        {
          idCardId: mainCard.id,
          stream: "AUTOPOOL",
          level: 2,
          amountPaise: 30000,
          status: "CONFIRMED",
          createdAt: new Date(Date.now() - 172800000)
        },
        {
          idCardId: subCard.id,
          stream: "MY_SYSTEM",
          level: 2,
          amountPaise: 25000,
          status: "LOCKED_ACB",
          createdAt: new Date(Date.now() - 259200000)
        },
        {
          idCardId: mainCard.id,
          stream: "MY_SYSTEM",
          level: 1,
          amountPaise: 0,
          status: "PAY_ONCE_BLOCKED",
          createdAt: new Date(Date.now() - 345600000)
        },
        {
          idCardId: rebirthCard.id,
          stream: "AUTOPOOL",
          level: 3,
          amountPaise: 20000,
          status: "PENDING_7_DAY",
          createdAt: new Date()
        },
        {
          idCardId: mainCard.id,
          stream: "SETU_KOSH",
          level: 1,
          amountPaise: 15000,
          status: "PENDING_SETTLEMENT",
          createdAt: new Date()
        },
        {
          idCardId: mainCard.id,
          stream: "SETU_KOSH",
          level: 2,
          amountPaise: 10000,
          status: "PIN_GATE_INACTIVE",
          createdAt: new Date()
        }
      ]
    });

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ mobile: "9876500001", password: "password123" });
    token = loginRes.body.data.token;
  });

  afterAll(async () => {
    await truncateDb(prisma);
    await prisma.$disconnect();
  });

  describe("1. CommissionUI Status Vocabulary & Badge Mapping", () => {
    it("should map WITHDRAWABLE and CONFIRMED to friendly 'WITHDRAWABLE' with success badge", () => {
      const withMeta = CommissionUI.getStatusMeta("WITHDRAWABLE");
      expect(withMeta.label).toBe("WITHDRAWABLE");
      expect(withMeta.badgeClass).toBe("success");

      const confMeta = CommissionUI.getStatusMeta("CONFIRMED");
      expect(confMeta.label).toBe("WITHDRAWABLE");
      expect(confMeta.badgeClass).toBe("success");
    });

    it("should map PENDING_7_DAY to friendly 'PENDING (7-DAY)' with pending badge", () => {
      const meta = CommissionUI.getStatusMeta("PENDING_7_DAY");
      expect(meta.label).toBe("PENDING (7-DAY)");
      expect(meta.badgeClass).toBe("pending");
    });

    it("should map LOCKED_ACB to friendly 'LOCKED (ACB)' with locked badge", () => {
      const meta = CommissionUI.getStatusMeta("LOCKED_ACB");
      expect(meta.label).toBe("LOCKED (ACB)");
      expect(meta.badgeClass).toBe("locked");
    });

    it("should map PAY_ONCE_BLOCKED to friendly 'PAY-ONCE BLOCKED' with blocked badge", () => {
      const meta = CommissionUI.getStatusMeta("PAY_ONCE_BLOCKED");
      expect(meta.label).toBe("PAY-ONCE BLOCKED");
      expect(meta.badgeClass).toBe("blocked");
    });

    it("should map PENDING_SETTLEMENT and PIN_GATE_INACTIVE correctly", () => {
      const setMeta = CommissionUI.getStatusMeta("PENDING_SETTLEMENT");
      expect(setMeta.label).toBe("PENDING (SETTLEMENT)");
      expect(setMeta.badgeClass).toBe("pending");

      const pinMeta = CommissionUI.getStatusMeta("PIN_GATE_INACTIVE");
      expect(pinMeta.label).toBe("PIN GATE INACTIVE");
      expect(pinMeta.badgeClass).toBe("locked");
    });
  });

  describe("2. CommissionUI Subtext & ACB v3 Rules", () => {
    it("should render 'ACB not required' for REBIRTH card in 7-day pending subtext", () => {
      const entry = {
        cardNumber: "RB10001",
        cardType: "REBIRTH",
        status: "PENDING_7_DAY",
        createdAt: new Date().toISOString()
      };
      const subtext = CommissionUI.renderReleaseSubtext(entry);
      expect(subtext).toContain("ACB not required");
      expect(subtext).toContain("Releases in 7d");
    });

    it("should render 'ACB ✓' for ACB-qualified MAIN/SUB card in 7-day pending subtext", () => {
      const entry = {
        cardNumber: "BB10001",
        cardType: "MAIN",
        cardAcbStatus: true,
        status: "PENDING_7_DAY",
        createdAt: new Date().toISOString()
      };
      const subtext = CommissionUI.renderReleaseSubtext(entry);
      expect(subtext).toContain("ACB ✓");
      expect(subtext).toContain("Releases in 7d");
    });

    it("should render 'Awaiting ACB' for non-ACB card in 7-day pending subtext", () => {
      const entry = {
        cardNumber: "SB10002",
        cardType: "SUB",
        cardAcbStatus: false,
        status: "PENDING_7_DAY",
        createdAt: new Date().toISOString()
      };
      const subtext = CommissionUI.renderReleaseSubtext(entry);
      expect(subtext).toContain("Awaiting ACB");
    });

    it("should render 'Awaiting 1L + 1R referral on this ID' for LOCKED_ACB", () => {
      const entry = {
        cardNumber: "SB10002",
        cardType: "SUB",
        status: "LOCKED_ACB"
      };
      const subtext = CommissionUI.renderReleaseSubtext(entry);
      expect(subtext).toContain("Awaiting 1L + 1R referral on this ID");
    });

    it("should render 'Already rewarded for Level N' for PAY_ONCE_BLOCKED", () => {
      const entry = {
        cardNumber: "BB10001",
        level: 3,
        status: "PAY_ONCE_BLOCKED"
      };
      const subtext = CommissionUI.renderReleaseSubtext(entry);
      expect(subtext).toContain("Already rewarded for Level 3");
    });
  });

  describe("3. Unified 6-Column HTML Structure", () => {
    it("should render a valid 6-column <tr> without the deprecated Description column", () => {
      const entry = {
        cardNumber: "BB10001",
        cardType: "MAIN",
        stream: "MY_SYSTEM",
        level: 2,
        amountPaise: 50000,
        status: "WITHDRAWABLE",
        createdAt: "2026-08-20T10:00:00.000Z"
      };
      const rowHtml = CommissionUI.renderCommissionRow(entry);

      expect(rowHtml).toContain("20 Aug 2026");
      expect(rowHtml).toContain("BB10001");
      expect(rowHtml).toContain("(MAIN)");
      expect(rowHtml).toContain("MY_SYSTEM");
      expect(rowHtml).toContain("Level 2");
      expect(rowHtml).toContain("+Rs.500.00");
      expect(rowHtml).toContain("<span class=\"badge success\">WITHDRAWABLE</span>");

      // Verify exact 6 <td> elements
      const tdCount = (rowHtml.match(/<td/g) || []).length;
      expect(tdCount).toBe(6);
    });
  });

  describe("4. API Total Count & Pagination Contract", () => {
    it("should accurately return totalCount field on /api/wallet/commissions alongside data array", async () => {
      const res = await request(app)
        .get("/api/wallet/commissions")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.totalCount).toBe(10);
      expect(res.body.data.length).toBe(10);
    });

    it("should maintain accurate totalCount when limit is applied", async () => {
      const res = await request(app)
        .get("/api/wallet/commissions?limit=3")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(3);
      expect(res.body.totalCount).toBe(10); // Total remains 10 even when slice is 3
    });
  });
});
