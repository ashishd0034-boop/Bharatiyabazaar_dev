const request = require("supertest");
const app = require("../../src/server");
const prisma = require("../../src/lib/prisma");
const { truncateDb } = require("../helpers/cleanDb");
const { seedSettingsAndSuperAdmin } = require("../../src/lib/seedSettings");
const { adminGeneratePins } = require("../../src/services/pinService");

describe("Scenario: Public Activation PIN Verification (Unauthenticated)", () => {
  let superAdmin;
  let availablePin, redeemedPin;

  beforeAll(async () => {
    await truncateDb(prisma);
    await seedSettingsAndSuperAdmin();

    superAdmin = await prisma.adminUser.findFirst({ where: { role: "SUPER_ADMIN" } });

    // Generate 2 test PINs via admin generator (count=2, quantity=3)
    const pinsResult = await adminGeneratePins(superAdmin.id, 2, 3, "Test Bootstrap PINs");
    availablePin = pinsResult.pins[0];
    redeemedPin = pinsResult.pins[1];

    // Mark second PIN as REDEEMED
    await prisma.activationPin.update({
      where: { id: redeemedPin.id },
      data: { status: "REDEEMED", redeemedAt: new Date() }
    });
  });

  afterAll(async () => {
    await truncateDb(prisma);
    await prisma.$disconnect();
  });

  it("1. Public Success: Should verify an available PIN without authorization header", async () => {
    const res = await request(app)
      .post("/api/auth/verify-pin")
      .send({ pinCode: availablePin.pinCode });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.pinCode).toBe(availablePin.pinCode);
    expect(res.body.data.quantity).toBe(3);
    expect(res.body.data.pricePaise).toBe(180000);

    // Ensure NO sensitive data is leaked
    expect(res.body.data.purchasedBy).toBeUndefined();
    expect(res.body.data.purchasedByMemberId).toBeUndefined();
    expect(res.body.data.id).toBeUndefined();
  });

  it("2. Validation Rejection: Should return 400 for a non-existent PIN", async () => {
    const res = await request(app)
      .post("/api/auth/verify-pin")
      .send({ pinCode: "PIN-NONEXISTENT99" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("INVALID_PIN");
  });

  it("3. Availability Rejection: Should return 400 for an already REDEEMED PIN", async () => {
    const res = await request(app)
      .post("/api/auth/verify-pin")
      .send({ pinCode: redeemedPin.pinCode });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("PIN_NOT_AVAILABLE");
  });

  it("4. Schema Rejection: Should return 400 if pinCode is empty or too short", async () => {
    const emptyRes = await request(app)
      .post("/api/auth/verify-pin")
      .send({ pinCode: "" });
    expect(emptyRes.status).toBe(400);

    const shortRes = await request(app)
      .post("/api/auth/verify-pin")
      .send({ pinCode: "AB" });
    expect(shortRes.status).toBe(400);
  });
});
