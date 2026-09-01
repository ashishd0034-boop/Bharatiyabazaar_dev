const request = require("supertest");
const app = require("../../src/server");
const prisma = require("../../src/lib/prisma");
const { truncateDb } = require("../helpers/cleanDb");
const { seedSettingsAndSuperAdmin } = require("../../src/lib/seedSettings");
const { adminGeneratePins } = require("../../src/services/pinService");

describe("Identity Session Hygiene & Contract Verification", () => {
  let superAdmin;
  let memberA, memberB;
  let memberAMainCard, memberASubCard2;
  let memberBMainCard;
  let memberAMainToken, memberASub2Token, memberBMainToken;

  beforeAll(async () => {
    await truncateDb(prisma);
    await seedSettingsAndSuperAdmin();

    superAdmin = await prisma.adminUser.findFirst({ where: { role: "SUPER_ADMIN" } });

    // Generate PINs for 3-ID member A and 1-ID member B
    const pinResA = await adminGeneratePins(superAdmin.id, 1, 3, "Member A 3-IDs");
    const pinA = pinResA.pins[0].pinCode;

    const pinResB = await adminGeneratePins(superAdmin.id, 1, 1, "Member B 1-ID");
    const pinB = pinResB.pins[0].pinCode;

    // Register Member A (3 IDs)
    const regResA = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Bhura Pioneer",
        mobile: "9876543210",
        password: "password123",
        activationPin: pinA,
        side: "LEFT"
      });
    expect(regResA.status).toBe(201);
    memberA = regResA.body.data.member;

    const cardsA = await prisma.memberIdCard.findMany({
      where: { memberId: memberA.id },
      orderBy: { createdAt: "asc" }
    });
    memberAMainCard = cardsA.find(c => c.type === "MAIN");
    memberASubCard2 = cardsA.find(c => c.type === "SUB");

    // Register Member B (1 ID)
    const regResB = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Second Member",
        mobile: "9876543211",
        password: "password123",
        activationPin: pinB,
        side: "RIGHT"
      });
    expect(regResB.status).toBe(201);
    memberB = regResB.body.data.member;

    const cardsB = await prisma.memberIdCard.findMany({
      where: { memberId: memberB.id }
    });
    memberBMainCard = cardsB.find(c => c.type === "MAIN");

    // Login tokens
    const loginMainA = await request(app)
      .post("/api/auth/login")
      .send({ mobile: "9876543210", password: "password123" });
    expect(loginMainA.status).toBe(200);
    memberAMainToken = loginMainA.body.data.token;

    const loginSub2A = await request(app)
      .post("/api/auth/login")
      .send({ mobile: memberASubCard2.cardNumber, password: "password123" });
    expect(loginSub2A.status).toBe(200);
    memberASub2Token = loginSub2A.body.data.token;

    const loginMainB = await request(app)
      .post("/api/auth/login")
      .send({ mobile: "9876543211", password: "password123" });
    expect(loginMainB.status).toBe(200);
    memberBMainToken = loginMainB.body.data.token;
  });

  afterAll(async () => {
    await truncateDb(prisma);
    await prisma.$disconnect();
  });

  describe("1. Login & Registration Contract Tests", () => {
    it("should return MAIN loginContext when logging in with mobile or MAIN card", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ mobile: "9876543210", password: "password123" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.loginContext).toBeDefined();
      expect(res.body.data.loginContext.isSubCard).toBe(false);
      expect(res.body.data.loginContext.cardType).toBe("MAIN");
      expect(res.body.data.loginContext.cardNumber).toBe(memberAMainCard.cardNumber);
      expect(res.body.data.loginContext.ownerMemberCode).toBe(memberA.memberCode);
    });

    it("should return SUB loginContext with owner annotation when logging in with SUB card", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ mobile: memberASubCard2.cardNumber, password: "password123" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.loginContext).toBeDefined();
      expect(res.body.data.loginContext.isSubCard).toBe(true);
      expect(res.body.data.loginContext.cardType).toBe("SUB");
      expect(res.body.data.loginContext.cardNumber).toBe(memberASubCard2.cardNumber);
      expect(res.body.data.loginContext.ownerMemberCode).toBe(memberA.memberCode);
    });
  });

  describe("2. Server Identity Parity Across Endpoints", () => {
    it("should return identical server-resolved loginContext on /api/members/profile, /api/wallet/balance, and /api/wallet/commissions for MAIN session", async () => {
      const [profRes, balRes, commRes] = await Promise.all([
        request(app).get("/api/members/profile").set("Authorization", `Bearer ${memberAMainToken}`),
        request(app).get("/api/wallet/balance").set("Authorization", `Bearer ${memberAMainToken}`),
        request(app).get("/api/wallet/commissions").set("Authorization", `Bearer ${memberAMainToken}`)
      ]);

      expect(profRes.status).toBe(200);
      expect(balRes.status).toBe(200);
      expect(commRes.status).toBe(200);

      const profCtx = profRes.body.data.loginContext;
      const balCtx = balRes.body.data.loginContext;
      const commCtx = commRes.body.loginContext || commRes.body.data.loginContext;

      expect(profCtx.cardNumber).toBe(memberAMainCard.cardNumber);
      expect(balCtx.loginCardNumber).toBe(memberAMainCard.cardNumber);
      expect(commCtx.loginCardNumber).toBe(memberAMainCard.cardNumber);

      expect(profCtx.isSubCard).toBe(false);
      expect(balCtx.isSubCard).toBe(false);
      expect(commCtx.isSubCard).toBe(false);
    });

    it("should return identical server-resolved loginContext on /api/members/profile, /api/wallet/balance, and /api/wallet/commissions for SUB session", async () => {
      const [profRes, balRes, commRes] = await Promise.all([
        request(app).get("/api/members/profile").set("Authorization", `Bearer ${memberASub2Token}`),
        request(app).get("/api/wallet/balance").set("Authorization", `Bearer ${memberASub2Token}`),
        request(app).get("/api/wallet/commissions").set("Authorization", `Bearer ${memberASub2Token}`)
      ]);

      expect(profRes.status).toBe(200);
      expect(balRes.status).toBe(200);
      expect(commRes.status).toBe(200);

      const profCtx = profRes.body.data.loginContext;
      const balCtx = balRes.body.data.loginContext;
      const commCtx = commRes.body.loginContext || commRes.body.data.loginContext;

      expect(profCtx.cardNumber).toBe(memberASubCard2.cardNumber);
      expect(balCtx.loginCardNumber).toBe(memberASubCard2.cardNumber);
      expect(commCtx.loginCardNumber).toBe(memberASubCard2.cardNumber);

      expect(profCtx.isSubCard).toBe(true);
      expect(balCtx.isSubCard).toBe(true);
      expect(commCtx.isSubCard).toBe(true);

      expect(profCtx.ownerMemberCode).toBe(memberA.memberCode);
    });
  });

  describe("3. Security & IDOR Enforcement", () => {
    it("should reject access to another member's tree endpoint with 403 FORBIDDEN", async () => {
      const res = await request(app)
        .get(`/api/id-cards/tree/${memberB.id}`)
        .set("Authorization", `Bearer ${memberAMainToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("should reject withdrawal initiation when authenticated under a SUB card", async () => {
      const res = await request(app)
        .post("/api/withdrawals/request")
        .set("Authorization", `Bearer ${memberASub2Token}`)
        .send({ amountPaise: 50000 });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("FORBIDDEN_SUB_CARD");
    });

    it("should reject missing or invalid authorization header with 401 UNAUTHORIZED", async () => {
      const res = await request(app)
        .get("/api/members/profile")
        .set("Authorization", "Bearer invalid-or-forged-token");

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    });
  });
});
