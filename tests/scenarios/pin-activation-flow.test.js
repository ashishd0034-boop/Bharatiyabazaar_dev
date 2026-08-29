const { truncateDb } = require("../helpers/cleanDb");
const request = require("supertest");
const app = require("../../src/server");
const prisma = require("../../src/lib/prisma");
const { seedSettingsAndSuperAdmin } = require("../../src/lib/seedSettings");
const { credit } = require("../../src/services/walletService");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "default_jwt_secret";

describe("Task 11: PIN-Based ID Activation System & Safeguards", () => {
  const unique = Date.now().toString().slice(-6);

  let sponsorMember, sponsorToken;
  let adminUser, adminToken;

  async function cleanDb() {
    await truncateDb(prisma);
  }

  beforeAll(async () => {
    await cleanDb();
    await seedSettingsAndSuperAdmin();

    // 1. Create Sponsor Member with active MAIN ID
    const pwHash = await bcrypt.hash("Password123", 10);
    sponsorMember = await prisma.member.create({
      data: {
        name: `Sponsor ${unique}`,
        mobile: `98888${unique}`,
        passwordHash: pwHash,
        memberCode: `BB${unique}`,
        status: "ACTIVE"
      }
    });

    await prisma.wallet.create({
      data: { memberId: sponsorMember.id, balancePaise: 0 }
    });

    const sponsorMainCard = await prisma.memberIdCard.create({
      data: {
        memberId: sponsorMember.id,
        cardNumber: `BB${unique}`,
        type: "MAIN",
        status: "ACTIVE"
      }
    });

    await prisma.mySystemNode.create({
      data: {
        idCardId: sponsorMainCard.id,
        placementType: "ROOT"
      }
    });

    await prisma.autoPoolNode.create({
      data: {
        idCardId: sponsorMainCard.id,
        globalPosition: 100,
        depthLevel: 6
      }
    });

    sponsorToken = jwt.sign({
      id: sponsorMember.id,
      type: "MEMBER",
      loginCardId: sponsorMainCard.id,
      loginCardNumber: sponsorMainCard.cardNumber,
      loginCardType: "MAIN",
      isSubCard: false,
      ownerMemberCode: sponsorMember.memberCode
    }, JWT_SECRET, { expiresIn: "7d" });

    // 2. Create Admin User
    adminUser = await prisma.adminUser.create({
      data: {
        name: "Admin User",
        email: `admin_${unique}@bharatiyabazaar.com`,
        passwordHash: pwHash,
        role: "ADMIN",
        status: "ACTIVE"
      }
    });

    adminToken = jwt.sign({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      type: "ADMIN"
    }, JWT_SECRET, { expiresIn: "7d" });
  });

  afterAll(async () => {
    await cleanDb();
    await prisma.$disconnect();
  });

  describe("1. PIN Purchase & Company Accounting Safeguards", () => {
    it("should fail to purchase PIN if sponsor has insufficient wallet balance", async () => {
      const res = await request(app)
        .post("/api/pins/purchase")
        .set("Authorization", `Bearer ${sponsorToken}`)
        .send({ quantity: 1 });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.message).toMatch(/insufficient funds/i);
    });

    it("should successfully purchase a 1-ID PIN and enforce company wallet credit accounting invariant", async () => {
      // Credit sponsor wallet with ₹2,000 (200000 paise)
      await prisma.$transaction(async (tx) => {
        await credit(tx, sponsorMember.id, 200000, "INITIAL_TOPUP", "TOPUP-01", "Top up sponsor wallet");
      });

      const companyMember = await prisma.member.findUnique({
        where: { id: "COMPANY_WALLET" },
        include: { mainWallet: true }
      });
      const initialCompanyBalance = companyMember?.mainWallet?.balancePaise || 0;

      const res = await request(app)
        .post("/api/pins/purchase")
        .set("Authorization", `Bearer ${sponsorToken}`)
        .send({ quantity: 1 });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.pinCode).toMatch(/^PIN-[A-F0-9]{8}$/);
      expect(res.body.data.quantity).toBe(1);
      expect(res.body.data.pricePaise).toBe(60000);

      const pinCode = res.body.data.pinCode;

      // Verify PIN in DB
      const pinRecord = await prisma.activationPin.findUnique({
        where: { pinCode }
      });
      expect(pinRecord).toBeDefined();
      expect(pinRecord.status).toBe("AVAILABLE");
      expect(pinRecord.purchasedByMemberId).toBe(sponsorMember.id);

      // Verify Sponsor Wallet Debited
      const sponsorWallet = await prisma.wallet.findUnique({
        where: { memberId: sponsorMember.id },
        include: { ledgerEntries: { orderBy: { createdAt: "desc" } } }
      });
      expect(sponsorWallet.balancePaise).toBe(140000); // 200000 - 60000 = 140000
      expect(sponsorWallet.ledgerEntries[0].type).toBe("DEBIT");
      expect(sponsorWallet.ledgerEntries[0].source).toBe("PIN_PURCHASE");
      expect(sponsorWallet.ledgerEntries[0].amountPaise).toBe(60000);

      // Safeguard 2 Check: Company wallet credited exact same amount
      const updatedCompany = await prisma.member.findUnique({
        where: { id: "COMPANY_WALLET" },
        include: { mainWallet: { include: { ledgerEntries: { orderBy: { createdAt: "desc" } } } } }
      });
      expect(updatedCompany.mainWallet.balancePaise).toBe(initialCompanyBalance + 60000);
      expect(updatedCompany.mainWallet.ledgerEntries[0].type).toBe("CREDIT");
      expect(updatedCompany.mainWallet.ledgerEntries[0].source).toBe("PIN_SALE");
      expect(updatedCompany.mainWallet.ledgerEntries[0].amountPaise).toBe(60000);
    });

    it("should successfully purchase a multi-ID PIN (e.g. 3 IDs)", async () => {
      const res = await request(app)
        .post("/api/pins/purchase")
        .set("Authorization", `Bearer ${sponsorToken}`)
        .send({ quantity: 2 }); // 2 * 60000 = 120000 paise

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.quantity).toBe(2);
      expect(res.body.data.pricePaise).toBe(120000);
    });
  });

  describe("2. PIN Validation & Public Endpoint", () => {
    let testPinCode;

    beforeAll(async () => {
      await prisma.$transaction(async (tx) => {
        await credit(tx, sponsorMember.id, 200000, "TOPUP", "TOPUP-VAL", "Top up for validation test");
      });

      // Purchase a PIN to test validation
      const res = await request(app)
        .post("/api/pins/purchase")
        .set("Authorization", `Bearer ${sponsorToken}`)
        .send({ quantity: 1 });
      testPinCode = res.body.data.pinCode;
    });

    it("should validate an existing available PIN", async () => {
      const res = await request(app)
        .post("/api/pins/validate")
        .set("Authorization", `Bearer ${sponsorToken}`)
        .send({ pinCode: testPinCode });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.valid).toBe(true);
      expect(res.body.data.quantity).toBe(1);
      expect(res.body.data.status).toBe("AVAILABLE");
    });

    it("should return 400 for a non-existent PIN", async () => {
      const res = await request(app)
        .post("/api/pins/validate")
        .set("Authorization", `Bearer ${sponsorToken}`)
        .send({ pinCode: "PIN-NONEXISTENT" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.message).toMatch(/invalid pin/i);
    });
  });

  describe("3. Registration Flow with PIN Redemption", () => {
    let singlePinCode, multiPinCode;

    beforeAll(async () => {
      // Top up sponsor
      await prisma.$transaction(async (tx) => {
        await credit(tx, sponsorMember.id, 500000, "TOPUP", "TOPUP-02", "Top up");
      });

      // Buy single-ID PIN
      const res1 = await request(app)
        .post("/api/pins/purchase")
        .set("Authorization", `Bearer ${sponsorToken}`)
        .send({ quantity: 1 });
      singlePinCode = res1.body.data.pinCode;

      // Buy multi-ID PIN (3 IDs)
      const res2 = await request(app)
        .post("/api/pins/purchase")
        .set("Authorization", `Bearer ${sponsorToken}`)
        .send({ quantity: 3 });
      multiPinCode = res2.body.data.pinCode;
    });

    it("should register referral with single-ID PIN and atomically redeem it", async () => {
      const mobile = `98111${Date.now().toString().slice(-5)}`;
      const res = await request(app)
        .post("/api/auth/register")
        .send({
          name: "Direct Referral 1",
          mobile,
          password: "Password123",
          referralCode: sponsorMember.memberCode,
          side: "LEFT",
          activationPin: singlePinCode
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.cardsCreated).toBe(1);

      // Verify PIN is now REDEEMED
      const pinRecord = await prisma.activationPin.findUnique({
        where: { pinCode: singlePinCode }
      });
      expect(pinRecord.status).toBe("REDEEMED");
      expect(pinRecord.redeemedByMemberId).toBe(res.body.data.member.id);
      expect(pinRecord.redeemedAt).toBeDefined();

      // Verify ID Card created and placed
      const memberCards = await prisma.memberIdCard.findMany({
        where: { memberId: res.body.data.member.id }
      });
      expect(memberCards).toHaveLength(1);
      expect(memberCards[0].type).toBe("MAIN");
      expect(memberCards[0].status).toBe("ACTIVE");
    });

    it("should register referral with 3-ID PIN and create 1 MAIN + 2 SUB IDs", async () => {
      const mobile = `98222${Date.now().toString().slice(-5)}`;
      const res = await request(app)
        .post("/api/auth/register")
        .send({
          name: "Direct Referral Multi",
          mobile,
          password: "Password123",
          referralCode: sponsorMember.memberCode,
          side: "RIGHT",
          activationPin: multiPinCode
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.cardsCreated).toBe(3);

      // Verify PIN is now REDEEMED
      const pinRecord = await prisma.activationPin.findUnique({
        where: { pinCode: multiPinCode }
      });
      expect(pinRecord.status).toBe("REDEEMED");

      // Verify 3 cards in DB
      const memberCards = await prisma.memberIdCard.findMany({
        where: { memberId: res.body.data.member.id },
        orderBy: { createdAt: "asc" }
      });
      expect(memberCards).toHaveLength(3);
      expect(memberCards[0].type).toBe("MAIN");
      expect(memberCards[1].type).toBe("SUB");
      expect(memberCards[2].type).toBe("SUB");
    });

    it("should reject registration using an already redeemed PIN", async () => {
      const mobile = `98333${Date.now().toString().slice(-5)}`;
      const res = await request(app)
        .post("/api/auth/register")
        .send({
          name: "Double Spend Attempt",
          mobile,
          password: "Password123",
          referralCode: sponsorMember.memberCode,
          activationPin: singlePinCode // already redeemed above
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.message).toMatch(/invalid or already redeemed/i);

      // Verify no member created with this mobile
      const member = await prisma.member.findUnique({ where: { mobile } });
      expect(member).toBeNull();
    });
  });

  describe("4. Concurrency Test (Double-Spend Lock)", () => {
    let racePinCode;

    beforeAll(async () => {
      await prisma.$transaction(async (tx) => {
        await credit(tx, sponsorMember.id, 200000, "TOPUP", "TOPUP-03", "Top up");
      });

      const res = await request(app)
        .post("/api/pins/purchase")
        .set("Authorization", `Bearer ${sponsorToken}`)
        .send({ quantity: 1 });
      racePinCode = res.body.data.pinCode;
    });

    it("should handle 5 simultaneous registration requests with the exact same PIN: exactly 1 succeeds and 4 fail", async () => {
      const requests = Array.from({ length: 5 }, (_, i) => {
        const mobile = `984440000${i}`;
        return request(app)
          .post("/api/auth/register")
          .send({
            name: `Race Member ${i}`,
            mobile,
            password: "Password123",
            referralCode: sponsorMember.memberCode,
            side: "LEFT",
            activationPin: racePinCode
          });
      });

      const responses = await Promise.all(requests);

      const successes = responses.filter(r => r.status === 201);
      const failures = responses.filter(r => r.status === 400);

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(4);

      failures.forEach(f => {
        expect(f.body.error?.message).toMatch(/invalid or already redeemed/i);
      });

      // Verify PIN status in DB is REDEEMED
      const pinRecord = await prisma.activationPin.findUnique({
        where: { pinCode: racePinCode }
      });
      expect(pinRecord.status).toBe("REDEEMED");
      expect(pinRecord.redeemedByMemberId).toBe(successes[0].body.data.member.id);

      // Verify only 1 member exists among the 5 race attempts
      const createdCount = await prisma.member.count({
        where: { mobile: { startsWith: "984440000" } }
      });
      expect(createdCount).toBe(1);
    });
  });

  describe("5. Admin Governance & PIN Revocation", () => {
    let pinToRevoke;

    beforeAll(async () => {
      await prisma.$transaction(async (tx) => {
        await credit(tx, sponsorMember.id, 200000, "TOPUP", "TOPUP-04", "Top up");
      });

      const res = await request(app)
        .post("/api/pins/purchase")
        .set("Authorization", `Bearer ${sponsorToken}`)
        .send({ quantity: 1 });
      pinToRevoke = res.body.data;
    });

    it("should list all PINs for Admin", async () => {
      const res = await request(app)
        .get("/api/admin/pins")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it("should revoke an available PIN and prevent future registration with it", async () => {
      const res = await request(app)
        .post(`/api/admin/pins/revoke/${pinToRevoke.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ reason: "Fraudulent test activity" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("REVOKED");

      // Verify registration attempt fails
      const regRes = await request(app)
        .post("/api/auth/register")
        .send({
          name: "Revoked PIN Member",
          mobile: `98555${Date.now().toString().slice(-5)}`,
          password: "Password123",
          activationPin: pinToRevoke.pinCode
        });

      expect(regRes.status).toBe(400);
      expect(regRes.body.error?.message).toMatch(/invalid|not available|already redeemed/i);
    });
  });
});
