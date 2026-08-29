const request = require("supertest");
const app = require("../src/server");
const prisma = require("../src/lib/prisma");
const { resetMemberSequence } = require("./reset_member_sequence");

async function main() {
  console.log("================================================================================");
  console.log("🧪 LIVE E2E: PUBLIC PIN VERIFICATION, BB10001 REGISTRATION & AUTHENTICATION");
  console.log("================================================================================");

  // 1. Initial Pristine Reset
  console.log("\n[STEP 1] Resetting Database to Clean State...");
  await resetMemberSequence();

  // 2. Super Admin Login & PIN Generation
  console.log("\n[STEP 2] Super Admin Generates 3-ID Activation PIN...");
  const adminLoginRes = await request(app)
    .post("/api/admin/login")
    .send({
      email: "admin@bharatiyabazaar.com",
      password: process.env.SUPERADMIN_PASSWORD || "Admin@123456"
    });
  if (adminLoginRes.status !== 200) {
    throw new Error(`Admin login failed: ${JSON.stringify(adminLoginRes.body)}`);
  }
  const adminToken = adminLoginRes.body.data.token;

  const pinGenRes = await request(app)
    .post("/api/admin/pins/generate")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      quantity: 3,
      count: 1,
      reason: "Public Registration Verification"
    });
  if (pinGenRes.status !== 201) {
    throw new Error(`PIN generation failed: ${JSON.stringify(pinGenRes.body)}`);
  }
  const generatedPin = pinGenRes.body.data.pins[0];
  console.log(`✓ Admin PIN Generated: ${generatedPin.pinCode} (${generatedPin.quantity} IDs, ₹${generatedPin.pricePaise / 100})`);

  // 3. Unauthenticated Public PIN Verification (Simulating bb-register.html)
  console.log("\n[STEP 3] Simulating Public 'Verify PIN' click (No Auth Header)...");
  const verifyRes = await request(app)
    .post("/api/auth/verify-pin")
    .send({ pinCode: generatedPin.pinCode });

  console.log("Response Status:", verifyRes.status);
  console.log("Response Body:", verifyRes.body);

  if (verifyRes.status !== 200 || !verifyRes.body.success || !verifyRes.body.data?.valid) {
    throw new Error(`Public PIN verification failed: ${JSON.stringify(verifyRes.body)}`);
  }
  if (verifyRes.body.data.quantity !== 3 || verifyRes.body.data.pricePaise !== 180000) {
    throw new Error(`Public PIN metadata mismatch: ${JSON.stringify(verifyRes.body.data)}`);
  }
  console.log(`✅ PUBLIC VERIFY SUCCESS: Valid PIN for ${verifyRes.body.data.quantity} ID(s) (₹${verifyRes.body.data.pricePaise / 100} prepaid) without auth!`);

  // 4. Public Registration with Verified PIN
  console.log("\n[STEP 4] Submitting Public Registration with Verified PIN...");
  const regRes = await request(app)
    .post("/api/auth/register")
    .send({
      name: "Public Registrant One",
      mobile: "9876543210",
      password: "password123",
      pinCode: "401303",
      activationPin: generatedPin.pinCode,
      side: "LEFT"
    });

  if (regRes.status !== 201 || !regRes.body.success) {
    throw new Error(`Registration failed: ${JSON.stringify(regRes.body)}`);
  }

  const member = regRes.body.data.member;
  const cards = await prisma.memberIdCard.findMany({ where: { memberId: member.id } });
  console.log(`✓ Member Registered: ${member.memberCode} (${member.name})`);
  console.log(`✓ Cards Generated (${cards.length}): ${cards.map(c => `${c.cardNumber} (${c.type})`).join(", ")}`);

  if (member.memberCode !== "BB10001") {
    throw new Error(`Expected BB10001 but got ${member.memberCode}`);
  }
  console.log("✅ PERFECT SEQUENCE VERIFIED: memberCode is exactly 'BB10001'!");

  // 5. Member Login with password123
  console.log("\n[STEP 5] Authenticating newly registered member...");
  const loginRes = await request(app)
    .post("/api/auth/login")
    .send({
      mobile: "9876543210",
      password: "password123"
    });

  if (loginRes.status !== 200 || !loginRes.body.success) {
    throw new Error(`Member login failed: ${JSON.stringify(loginRes.body)}`);
  }
  console.log(`✓ Member login successful! Token received: ${loginRes.body.data.token.slice(0, 20)}...`);

  // 6. Test that Redeemed PIN is rejected on verify-pin
  console.log("\n[STEP 6] Verifying Redeemed PIN rejection on /api/auth/verify-pin...");
  const usedPinRes = await request(app)
    .post("/api/auth/verify-pin")
    .send({ pinCode: generatedPin.pinCode });

  if (usedPinRes.status !== 400 || usedPinRes.body.error?.code !== "PIN_NOT_AVAILABLE") {
    throw new Error(`Expected PIN_NOT_AVAILABLE but got: ${JSON.stringify(usedPinRes.body)}`);
  }
  console.log("✓ Redeemed PIN correctly rejected with PIN_NOT_AVAILABLE.");

  // 7. Final Pristine Reset
  console.log("\n[STEP 7] Final Pristine Reset for User Manual Testing...");
  await resetMemberSequence();
  console.log("✅ DATABASE LEFT PRISTINE: 0 members, AUTOPOOL_GLOBAL=0, MEMBER_CODE=10000, Company Wallet=₹0");
  console.log("================================================================================");
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error("Live verification error:", err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
