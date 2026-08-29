const { truncateDb } = require("../helpers/cleanDb");
const request = require("supertest");
const app = require("../../src/server");
const prisma = require("../../src/lib/prisma");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const JWT_SECRET = process.env.JWT_SECRET || "default_jwt_secret";

describe("Task 10A: Vendor UI Integration & End-to-End API Flow", () => {
  const unique = Date.now().toString().slice(-6);

  let referrerMember, buyerMember, buyerCard;
  let memberToken, vendorToken;
  let registeredVendor, registeredMember;

  async function cleanDb() {
    await truncateDb(prisma);
  }

  beforeAll(async () => {
    await cleanDb();

    // 1. Create a Referrer Member
    referrerMember = await prisma.member.create({
      data: {
        name: `Referrer ${unique}`,
        mobile: `9111${unique}`,
        memberCode: `REF${unique}`,
        kycStatus: "VERIFIED",
        panNumber: "REFPA1234F",
        mainWallet: {
          create: { balancePaise: 0 }
        }
      }
    });

    const refCard = await prisma.memberIdCard.create({
      data: {
        memberId: referrerMember.id,
        cardNumber: `CARD_REF_${unique}`,
        type: "MAIN"
      }
    });

    await prisma.mySystemNode.create({
      data: {
        idCardId: refCard.id,
        placementType: "DIRECT"
      }
    });

    // 2. Create a Buyer Member
    const passwordHash = await bcrypt.hash("Buyer@123", 10);
    const walletService = require("../../src/services/walletService");

    buyerMember = await prisma.member.create({
      data: {
        name: `Buyer ${unique}`,
        mobile: `9222${unique}`,
        memberCode: `BUY${unique}`,
        passwordHash,
        kycStatus: "VERIFIED",
        panNumber: "BUYPA1234F",
        mainWallet: {
          create: { balancePaise: 0 }
        }
      }
    });

    await prisma.$transaction(async (tx) => {
      await walletService.credit(tx, buyerMember.id, 500000, "TOPUP", null, "Buyer topup");
    });

    buyerCard = await prisma.memberIdCard.create({
      data: {
        memberId: buyerMember.id,
        cardNumber: `CARD_BUY_${unique}`,
        type: "MAIN"
      }
    });

    await prisma.mySystemNode.create({
      data: {
        idCardId: buyerCard.id,
        sponsorIdCardId: refCard.id,
        placementType: "DIRECT"
      }
    });

    // Create a regular member token
    memberToken = jwt.sign(
      { id: buyerMember.id, loginCardId: buyerCard.id, type: "MEMBER" },
      JWT_SECRET,
      { expiresIn: "1d" }
    );
  });

  afterAll(async () => {
    await cleanDb();
    await prisma.$disconnect();
  });

  it("1. should register a new vendor with category margin, referral binding, and deposit notice", async () => {
    const payload = {
      name: `Vendor Owner ${unique}`,
      businessName: `Kirana Superstore ${unique}`,
      mobile: `9333${unique}`,
      password: "Vendor@Password123",
      category: "GROCERY",
      entityType: "INDIVIDUAL",
      panNumber: "ABCDE1234F",
      pinCode: "110001",
      address: "Shop 12, Main Market, Connaught Place",
      referrerCode: referrerMember.memberCode,
      payoutMethod: "WALLET"
    };

    const res = await request(app)
      .post("/api/vendors/register")
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.vendor).toBeDefined();
    expect(res.body.data.vendor.businessName).toBe(payload.businessName);
    expect(res.body.data.vendor.category).toBe("GROCERY");
    expect(res.body.data.vendor.marginRatePct).toBe(7.0); // 7% Grocery margin
    expect(res.body.data.vendor.securityDepositPaise).toBe(500000); // Rs. 5,000 security deposit
    expect(res.body.data.vendorCode).toBe(res.body.data.vendor.id);

    registeredVendor = res.body.data.vendor;
    registeredMember = res.body.data.member;
  });

  it("2. should login the vendor and return a valid VENDOR JWT token", async () => {
    const res = await request(app)
      .post("/api/vendors/login")
      .send({
        mobile: `9333${unique}`,
        password: "Vendor@Password123"
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();

    vendorToken = res.body.data.token;
    const decoded = jwt.verify(vendorToken, JWT_SECRET);
    expect(decoded.type).toBe("VENDOR");
    expect(decoded.vendorId).toBe(registeredVendor.id);
  });

  it("3. should enforce cross-auth rejection between member and vendor endpoints", async () => {
    // 3A: Member token on Vendor endpoint -> 401 Unauthorized
    const resVendorMe = await request(app)
      .get("/api/vendors/me")
      .set("Authorization", `Bearer ${memberToken}`);

    expect(resVendorMe.status).toBe(401);
    expect(resVendorMe.body.success).toBe(false);

    // 3B: Vendor token on Member endpoint -> 401 Unauthorized
    const resMemberWithdrawal = await request(app)
      .post("/api/withdrawals/request")
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({
        amountPaise: 10000,
        method: "BANK"
      });

    expect(resMemberWithdrawal.status).toBe(401);
    expect(resMemberWithdrawal.body.success).toBe(false);

    // 3C: Vendor token on /api/vendors/me -> 200 OK
    const resVendorAuthOk = await request(app)
      .get("/api/vendors/me")
      .set("Authorization", `Bearer ${vendorToken}`);

    expect(resVendorAuthOk.status).toBe(200);
    expect(resVendorAuthOk.body.success).toBe(true);
    expect(resVendorAuthOk.body.data.vendor.id).toBe(registeredVendor.id);
    expect(resVendorAuthOk.body.data.vendor.marginRatePct).toBe(7.0);
  });

  it("4. should record a member purchase via /api/vendors/sale, update Setu Kosh counter, and distribute splits", async () => {
    const saleAmountRs = 1500; // Rs. 1,500 = 150,000 paise
    const amountPaise = saleAmountRs * 100;
    const idempotencyKey = `sale_test_${unique}_1`;

    const res = await request(app)
      .post("/api/vendors/sale")
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({
        buyerCode: buyerCard.cardNumber,
        amountPaise,
        idempotencyKey
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.vendorSale).toBeDefined();
    expect(res.body.data.vendorSale.amountPaise).toBe(amountPaise);
    expect(res.body.data.vendorSale.marginPaise).toBe(10500); // 7% of 150,000 = 10,500 paise

    // 1 ID should be created (Rs. 1,000 threshold reached), Rs. 500 carried forward
    expect(res.body.data.idsCreated).toBe(1);
    expect(res.body.data.currentCounterPaise).toBe(50000);

    // Verify Setu Kosh node created for buyer
    const setuNodes = await prisma.setuKoshNode.findMany({
      where: { memberId: buyerMember.id }
    });
    expect(setuNodes.length).toBe(1);

    // Verify vendor referral bonus was tracked for referrer
    const refBonus = await prisma.commissionEntry.findFirst({
      where: { stream: "VENDOR_REFERRAL_BONUS" }
    });
    expect(refBonus).toBeDefined();
    expect(refBonus.amountPaise).toBe(375); // 0.25% of 150,000 = 375 paise
  });

  it("5. should execute on-demand early settlement with flat Rs. 250 fee and record settlement run", async () => {
    const res = await request(app)
      .post("/api/vendors/settlement/early")
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();

    const settlement = res.body.data;
    expect(settlement.grossSalesPaise).toBe(150000); // Rs. 1,500
    expect(settlement.marginPaise).toBe(10500); // 7% = Rs. 105
    expect(settlement.postMarginPaise).toBe(139500); // Rs. 1,395
    expect(settlement.earlyFeePaise).toBe(25000); // Flat Rs. 250 fee

    // Verify settlement is listed in GET /api/vendors/settlements
    const listRes = await request(app)
      .get("/api/vendors/settlements")
      .set("Authorization", `Bearer ${vendorToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.success).toBe(true);
    expect(listRes.body.data.length).toBe(1);
    expect(listRes.body.data[0].id).toBe(settlement.id);
  });
});
