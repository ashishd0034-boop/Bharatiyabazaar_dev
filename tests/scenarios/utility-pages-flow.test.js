const { truncateDb } = require("../helpers/cleanDb");
const request = require("supertest");
const app = require("../../src/server");
const prisma = require("../../src/lib/prisma");
const { seedSettingsAndSuperAdmin } = require("../../src/lib/seedSettings");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "default_jwt_secret";

describe("Task 10C: Utility Pages & Derived Feed Flow Validation", () => {
  const unique = Date.now().toString().slice(-6);

  let member, otherMember, vendor;
  let memberToken, otherMemberToken, vendorToken;
  let memberCard, rebirthCard;

  async function cleanDb() {
    await truncateDb(prisma);
  }

  beforeAll(async () => {
    await cleanDb();
    await seedSettingsAndSuperAdmin();

    const pwHash = await bcrypt.hash("Pass123456", 10);

    const walletService = require("../../src/services/walletService");

    // 1. Primary Member
    member = await prisma.member.create({
      data: {
        name: `Ramesh Kumar ${unique}`,
        mobile: `9555${unique}`,
        memberCode: `M555${unique}`,
        passwordHash: pwHash,
        kycStatus: "VERIFIED",
        panNumber: "ABCDE5555F",
        mainWallet: {
          create: { balancePaise: 0 }
        }
      },
      include: { mainWallet: true }
    });

    await prisma.$transaction(async (tx) => {
      await walletService.credit(tx, member.id, 100000, "COMMISSION", null, "Initial commission");
    });

    memberCard = await prisma.memberIdCard.create({
      data: {
        memberId: member.id,
        cardNumber: `CARD_MAIN_${unique}`,
        type: "MAIN",
        acbStatus: true,
        acbUnlockedAt: new Date()
      }
    });

    // 2. Secondary Member
    otherMember = await prisma.member.create({
      data: {
        name: `Suresh Sharma ${unique}`,
        mobile: `9666${unique}`,
        memberCode: `M666${unique}`,
        passwordHash: pwHash,
        kycStatus: "PENDING",
        mainWallet: {
          create: { balancePaise: 0 }
        }
      },
      include: { mainWallet: true }
    });

    await prisma.$transaction(async (tx) => {
      await walletService.credit(tx, otherMember.id, 20000, "COMMISSION", null, "Initial commission");
    });

    // 3. Vendor
    vendor = await prisma.vendor.create({
      data: {
        memberId: otherMember.id,
        businessName: `Swadeshi Store ${unique}`,
        category: "GROCERY",
        marginRatePct: 7.0,
        status: "ACTIVE"
      }
    });

    // 4. Rebirth Card for primary member
    rebirthCard = await prisma.memberIdCard.create({
      data: {
        memberId: member.id,
        cardNumber: `CARD_REB_${unique}`,
        type: "REBIRTH",
        status: "ACTIVE"
      }
    });

    // 5. Seed Setu Kosh root node
    await prisma.setuKoshNode.create({
      data: {
        globalPosition: 1,
        depthLevel: 0,
        side: "ROOT",
        memberId: member.id
      }
    });

    await prisma.setuKoshNode.create({
      data: {
        globalPosition: 2,
        depthLevel: 1,
        side: "LEFT",
        memberId: otherMember.id
      }
    });

    // 6. Tokens
    memberToken = jwt.sign(
      { id: member.id, loginCardId: memberCard.id, loginCardNumber: memberCard.cardNumber, type: "MEMBER" },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    otherMemberToken = jwt.sign(
      { id: otherMember.id, type: "MEMBER" },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    vendorToken = jwt.sign(
      { id: otherMember.id, vendorId: vendor.id, type: "VENDOR" },
      JWT_SECRET,
      { expiresIn: "1d" }
    );
  });

  afterAll(async () => {
    await cleanDb();
    await prisma.$disconnect();
  });

  it("1. should serve live member profile, wallet, and ID card data for Hindi dashboard", async () => {
    // 1A: Profile API
    const resProfile = await request(app)
      .get("/api/members/profile")
      .set("Authorization", `Bearer ${memberToken}`);

    expect(resProfile.status).toBe(200);
    expect(resProfile.body.success).toBe(true);
    expect(resProfile.body.data.name).toContain("Ramesh Kumar");
    expect(resProfile.body.data.activeCard.acbStatus).toBe(true);

    // 1B: Wallet Summary API
    const resWallet = await request(app)
      .get("/api/wallets/summary")
      .set("Authorization", `Bearer ${memberToken}`);

    expect(resWallet.status).toBe(200);
    expect(resWallet.body.success).toBe(true);
    expect(resWallet.body.data.balancePaise).toBe(100000);

    // 1C: ID Cards API
    const resCards = await request(app)
      .get("/api/id-cards/my-cards")
      .set("Authorization", `Bearer ${memberToken}`);

    expect(resCards.status).toBe(200);
    expect(resCards.body.success).toBe(true);
    expect(resCards.body.data.length).toBeGreaterThanOrEqual(2); // MAIN + REBIRTH
  });

  it("2. should return Setu Kosh counter progress, referral bonuses, and 10-level tree explorer", async () => {
    // 2A: Seed a referral bonus for primary member
    await prisma.vendorReferralBonus.create({
      data: {
        memberId: member.id,
        referredVendorId: vendor.id,
        bonusPaise: 1250, // 0.25% of 5,000 = Rs. 12.50
        status: "WITHDRAWABLE"
      }
    });

    // Setu Kosh Counter
    const resCounter = await request(app)
      .get("/api/setu-kosh/counter")
      .set("Authorization", `Bearer ${memberToken}`);

    expect(resCounter.status).toBe(200);
    expect(resCounter.body.success).toBe(true);
    expect(resCounter.body.data.thresholdPaise).toBe(100000);
    expect(resCounter.body.data.referralBonuses.length).toBe(1);
    expect(resCounter.body.data.referralBonuses[0].bonusPaise).toBe(1250);

    // 2B: Setu Kosh Tree Explorer
    const resTree = await request(app)
      .get("/api/setu-kosh/tree?root=1&depth=10")
      .set("Authorization", `Bearer ${memberToken}`);

    expect(resTree.status).toBe(200);
    expect(resTree.body.success).toBe(true);
    expect(resTree.body.data.rootNode.globalPosition).toBe(1);
    expect(resTree.body.data.tree.children.LEFT).toBeDefined();
    expect(resTree.body.data.tree.children.LEFT.position).toBe(2);
  });

  it("3. should compute exact withdrawal preview math for authenticated session (Rs. 600 Bank -> Rs. 0 TDS, Rs. 60 Admin, Rs. 540 Net)", async () => {
    const resCalc = await request(app)
      .get("/api/withdrawals/tds-preview?amountPaise=60000&method=BANK")
      .set("Authorization", `Bearer ${memberToken}`);

    expect(resCalc.status).toBe(200);
    expect(resCalc.body.success).toBe(true);
    const r = resCalc.body.data;

    expect(r.grossPaise).toBe(60000); // Rs. 600
    expect(r.estimatedTdsPaise).toBe(0); // 0 TDS (< Rs. 20k)
    expect(r.adminChargeRatePct).toBe(10);
    expect(r.estimatedAdminChargePaise).toBe(6000); // 10% of 600 = Rs. 60
    expect(r.netPayablePaise).toBe(54000); // Rs. 540

    // Math invariant
    expect(r.grossPaise).toBe(r.recovered194RPaise + r.estimatedTdsPaise + r.estimatedAdminChargePaise + r.netPayablePaise);
    expect(r.isGuest).toBe(false);
  });

  it("4. should compute server-side withdrawal preview in unauthenticated guest mode without browser JS money math", async () => {
    // Unauthenticated GET (Guest mode)
    const resGuest = await request(app)
      .get("/api/withdrawals/tds-preview?amountPaise=100000&method=MEMBER_WALLET");

    expect(resGuest.status).toBe(200);
    expect(resGuest.body.success).toBe(true);
    const g = resGuest.body.data;

    expect(g.grossPaise).toBe(100000); // Rs. 1,000
    expect(g.estimatedTdsPaise).toBe(0); // < 20k threshold
    expect(g.adminChargeRatePct).toBe(5); // 5% for MEMBER_WALLET
    expect(g.estimatedAdminChargePaise).toBe(5000); // 5% of 1,000 = Rs. 50
    expect(g.netPayablePaise).toBe(95000); // Rs. 950
    expect(g.isGuest).toBe(true);
  });

  it("5. should derive strictly member-scoped notification feed across 6 sources capped at 50", async () => {
    // 5A: Create transactions for member
    await prisma.ledgerEntry.create({
      data: {
        walletId: member.mainWallet.id,
        type: "CREDIT",
        source: "COMMISSION",
        amountPaise: 25000,
        balanceAfterPaise: 125000,
        balanceBeforePaise: 100000,
        description: "AutoPool Level 1 Payout"
      }
    });

    await prisma.withdrawal.create({
      data: {
        memberId: member.id,
        idCardId: memberCard.id,
        method: "BANK",
        grossPaise: 50000,
        tdsPaise: 0,
        adminChargePaise: 5000,
        netPaise: 45000,
        status: "COMPLETED"
      }
    });

    await prisma.voucher.create({
      data: {
        memberId: member.id,
        sourceType: "AUTOPOOL_CYCLE",
        faceValuePaise: 15000,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 86400000 * 30)
      }
    });

    // 5B: Fetch notifications
    const resNotif = await request(app)
      .get("/api/members/notifications")
      .set("Authorization", `Bearer ${memberToken}`);

    expect(resNotif.status).toBe(200);
    expect(resNotif.body.success).toBe(true);

    const list = resNotif.body.data;
    expect(list.length).toBeGreaterThanOrEqual(5);

    const types = list.map(n => n.type);
    expect(types).toContain("WALLET_CREDIT");
    expect(types).toContain("WITHDRAWAL_STATUS");
    expect(types).toContain("REBIRTH_GENERATED");
    expect(types).toContain("ACB_UNLOCKED");
    expect(types).toContain("REFERRAL_BONUS");
    expect(types).toContain("VOUCHER_ISSUED");

    // Ensure list is strictly ordered newest first
    for (let i = 0; i < list.length - 1; i++) {
      const cur = new Date(list[i].timestamp).getTime();
      const next = new Date(list[i + 1].timestamp).getTime();
      expect(cur).toBeGreaterThanOrEqual(next);
    }

    // 5C: Verify other member receives only their own notifications
    const resOtherNotif = await request(app)
      .get("/api/members/notifications")
      .set("Authorization", `Bearer ${otherMemberToken}`);

    expect(resOtherNotif.status).toBe(200);
    const otherList = resOtherNotif.body.data;
    const otherMemberBonus = otherList.find(n => n.id.startsWith(`ref-`));
    expect(otherMemberBonus).toBeUndefined(); // Member's referral bonus not visible to otherMember
  });

  it("6. should enforce cross-auth rejection: vendor token on member notifications -> 401", async () => {
    const resVendorReject = await request(app)
      .get("/api/members/notifications")
      .set("Authorization", `Bearer ${vendorToken}`);

    expect(resVendorReject.status).toBe(401);
    expect(resVendorReject.body.success).toBe(false);
  });
});
