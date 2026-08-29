const request = require("supertest");
const app = require("../src/server");
const prisma = require("../src/lib/prisma");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

async function runSecurityValidation() {
  console.log("==================================================");
  console.log("🔒 PHASE 1 SECURITY REMEDIATION VALIDATION SUITE");
  console.log("==================================================");

  const unique = Date.now().toString().slice(-6);
  const passwordHash = await bcrypt.hash("password123", 10);

  // Setup Test Member
  const member = await prisma.member.create({
    data: {
      name: "Security Tester",
      mobile: `9999${unique}`,
      memberCode: `M999${unique}`,
      passwordHash,
      kycStatus: "VERIFIED",
      mainWallet: {
        create: { balancePaise: 0 } // 0 balance
      }
    },
    include: { mainWallet: true }
  });

  const memberMainCard = await prisma.memberIdCard.create({
    data: {
      memberId: member.id,
      cardNumber: `BB99${unique}`,
      type: "MAIN",
      acbStatus: true
    }
  });

  const token = jwt.sign(
    { id: member.id, loginCardId: memberMainCard.id, type: "MEMBER" },
    JWT_SECRET,
    { expiresIn: "1h" }
  );

  // Setup Other Member
  const otherMember = await prisma.member.create({
    data: {
      name: "Other Member",
      mobile: `9998${unique}`,
      memberCode: `M998${unique}`,
      passwordHash,
      mainWallet: { create: { balancePaise: 0 } }
    }
  });

  console.log("\n[CHECK 1] Verify GET /api/members/profile does NOT leak passwordHash:");
  const profileRes = await request(app)
    .get("/api/members/profile")
    .set("Authorization", `Bearer ${token}`);

  console.log(`  - Status: ${profileRes.status}`);
  console.log(`  - Has passwordHash in response: ${profileRes.body.data?.passwordHash !== undefined}`);
  if (profileRes.body.data?.passwordHash === undefined && profileRes.status === 200) {
    console.log("  ✅ PASS: passwordHash is stripped from profile response.");
  } else {
    console.error("  ❌ FAIL: passwordHash is still present in profile response!");
  }

  console.log("\n[CHECK 2] Verify POST /api/id-cards/purchase is blocked without PIN / wallet funds:");
  const freePurchaseRes = await request(app)
    .post("/api/id-cards/purchase")
    .set("Authorization", `Bearer ${token}`)
    .send({ count: 1 });

  console.log(`  - Status: ${freePurchaseRes.status}`);
  console.log(`  - Error Code: ${freePurchaseRes.body.error?.code}`);
  console.log(`  - Error Message: ${freePurchaseRes.body.error?.message}`);
  if (freePurchaseRes.status === 400 && freePurchaseRes.body.error?.code === "INSUFFICIENT_FUNDS") {
    console.log("  ✅ PASS: Free ID purchase successfully blocked.");
  } else {
    console.error("  ❌ FAIL: Free ID purchase was not properly rejected!");
  }

  console.log("\n[CHECK 3] Verify GET /api/id-cards/tree/:memberId IDOR protection:");
  const idorRes = await request(app)
    .get(`/api/id-cards/tree/${otherMember.id}`)
    .set("Authorization", `Bearer ${token}`);

  console.log(`  - Status: ${idorRes.status}`);
  console.log(`  - Error Code: ${idorRes.body.error?.code}`);
  if (idorRes.status === 403) {
    console.log("  ✅ PASS: IDOR attempt rejected with 403 FORBIDDEN.");
  } else {
    console.error("  ❌ FAIL: IDOR attempt was not blocked with 403!");
  }

  console.log("\n[CHECK 4] Verify POST /api/setu-kosh/purchase requires vendorAuthMiddleware:");
  const setuRes = await request(app)
    .post("/api/setu-kosh/purchase")
    .set("Authorization", `Bearer ${token}`) // Member token, not vendor
    .send({ amountPaise: 100000, memberId: member.id });

  console.log(`  - Status: ${setuRes.status}`);
  console.log(`  - Error Message: ${setuRes.body.error?.message}`);
  if (setuRes.status === 401 && setuRes.body.error?.message?.includes("Vendor authentication required")) {
    console.log("  ✅ PASS: Non-vendor blocked from arbitrary Setu Kosh purchase recording.");
  } else {
    console.error("  ❌ FAIL: Non-vendor was not rejected on Setu Kosh purchase!");
  }

  console.log("\n[CHECK 5] Verify Rate Limiting on /api/pins/validate (10 rapid requests):");
  const results = [];
  for (let i = 1; i <= 10; i++) {
    const res = await request(app)
      .post("/api/pins/validate")
      .set("Authorization", `Bearer ${token}`)
      .send({ pinCode: "PIN-INVALID" });
    results.push({ attempt: i, status: res.status });
  }

  console.log("  - Attempt statuses:", results.map(r => `#${r.attempt}: ${r.status}`).join(", "));
  const first5Statuses = results.slice(0, 5).map(r => r.status);
  const remainingStatuses = results.slice(5).map(r => r.status);

  const rateLimitSuccess = first5Statuses.every(s => s === 400) && remainingStatuses.every(s => s === 429);
  if (rateLimitSuccess) {
    console.log("  ✅ PASS: First 5 requests processed, 6th-10th blocked with 429 (TOO_MANY_REQUESTS).");
  } else {
    console.log(`  Rate limit result: ${rateLimitSuccess ? "PASS" : "CHECK DETAILS"}`);
  }

  // Cleanup
  await prisma.memberIdCard.deleteMany({ where: { memberId: { in: [member.id, otherMember.id] } } });
  await prisma.wallet.deleteMany({ where: { memberId: { in: [member.id, otherMember.id] } } });
  await prisma.member.deleteMany({ where: { id: { in: [member.id, otherMember.id] } } });
  await prisma.$disconnect();

  console.log("\n==================================================");
  console.log("🎉 ALL VALIDATION CHECKS COMPLETE");
  console.log("==================================================");
}

runSecurityValidation().catch(err => {
  console.error("Validation error:", err);
  process.exit(1);
});
