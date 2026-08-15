const request = require("supertest");
const app = require("../../src/server");
const prisma = require("../../src/lib/prisma");

describe("Auth API", () => {
  beforeAll(async () => {
    // Clean DB
    await prisma.withdrawal.deleteMany();
    await prisma.vendorSale.deleteMany();
    await prisma.vendor.deleteMany();
    await prisma.wallet.deleteMany();
    await prisma.commissionEntry.deleteMany();
    await prisma.autoPoolNode.deleteMany();
    await prisma.memberIdCard.deleteMany();
    await prisma.member.deleteMany();
    await prisma.adminUser.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("POST /api/auth/register", () => {
    it("should register a new member and return a token", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({
          name: "Test User",
          mobile: "9876543210",
          password: "password123"
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.member.name).toBe("Test User");
    });

    it("should return 400 for invalid payload", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({
          name: "T", // Too short
          mobile: "123", // Invalid mobile
          password: "pass" // Too short
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("should return 409 for duplicate mobile", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({
          name: "Another User",
          mobile: "9876543210",
          password: "password123"
        });

      expect(res.statusCode).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("CONFLICT");
    });
  });
});
