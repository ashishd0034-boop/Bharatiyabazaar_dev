const prisma = require("../src/lib/prisma");
const request = require("supertest");
const app = require("../src/server");
const jwt = require("jsonwebtoken");
const { runReconciliation } = require("../scripts/reconcile");

const JWT_SECRET = process.env.JWT_SECRET;

async function runLiveBootstrapVerification() {
  console.log("================================================================================");
  console.log("🚀 LIVE VERIFICATION: ADMIN PIN GENERATION & INITIAL BOOTSTRAP REGISTRATION");
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log("================================================================================\n");

  // Step 1: Login / Sign token for SUPER_ADMIN
  const superAdmin = await prisma.adminUser.findFirst({ where: { role: "SUPER_ADMIN" } });
  if (!superAdmin) {
    throw new Error("Superadmin user not found in bb_dev database!");
  }

  const superAdminToken = jwt.sign(
    { id: superAdmin.id, email: superAdmin.email, role: "SUPER_ADMIN", type: "ADMIN" },
    JWT_SECRET,
    { expiresIn: "1h" }
  );

  console.log(`Step 1: Authenticated as SUPER_ADMIN: ${superAdmin.email}`);

  // Step 2: Call POST /api/admin/pins/generate to issue 1 PIN with 3-ID capacity
  console.log("\nStep 2: Issuing 1 Admin PIN (3-ID package, ₹1,800 value)...");
  const genRes = await request(app)
    .post("/api/admin/pins/generate")
    .set("Authorization", `Bearer ${superAdminToken}`)
    .send({
      count: 1,
      quantity: 3,
      reason: "Live Phase B initial bootstrap root registration"
    });

  if (genRes.status !== 201 || !genRes.body.success) {
    console.error("PIN Generation Failed:", genRes.body);
    throw new Error(`Admin PIN generation failed with status ${genRes.status}`);
  }

  const generatedPin = genRes.body.data.pins[0];
  console.log(`✓ Admin PIN Generated Successfully:`);
  console.log(`  - PIN Code:     ${generatedPin.pinCode}`);
  console.log(`  - Capacity:     ${generatedPin.quantity} IDs`);
  console.log(`  - Price Value:  ₹${generatedPin.pricePaise / 100}`);
  console.log(`  - Status:       ${generatedPin.status}`);
  console.log(`  - Issuance:     ${generatedPin.issuanceType}`);

  // Step 3: Verify DB state of generated PIN
  const pinInDb = await prisma.activationPin.findUnique({
    where: { pinCode: generatedPin.pinCode }
  });
  if (!pinInDb || pinInDb.purchasedByMemberId !== null || pinInDb.status !== "AVAILABLE") {
    throw new Error("PIN database state is invalid!");
  }
  console.log(`✓ Verified DB State: purchasedByMemberId is null (No wallet balance deducted).`);

  // Step 4: Verify AuditLog record
  console.log("\nStep 3: Verifying AuditLog record...");
  const auditLog = await prisma.auditLog.findFirst({
    where: {
      action: "ADMIN_PIN_GENERATED",
      actorId: superAdmin.id
    },
    orderBy: { createdAt: "desc" }
  });

  if (!auditLog) {
    throw new Error("AuditLog entry not found!");
  }
  console.log(`✓ AuditLog Verified: ID = ${auditLog.id}, Action = ${auditLog.action}, Reason = "${auditLog.metadata?.reason}"`);

  // Step 5: Register initial member using the generated PIN
  console.log("\nStep 4: Registering initial member using the Admin PIN...");
  const unique = Date.now().toString().slice(-6);
  const regRes = await request(app)
    .post("/api/auth/register")
    .send({
      name: "Root Pioneer Member",
      mobile: `9888${unique}`,
      password: "PioneerPass123!",
      pinCode: "110001",
      activationPin: generatedPin.pinCode,
      side: "LEFT"
    });

  if (regRes.status !== 201 || !regRes.body.success) {
    console.error("Registration failed:", regRes.body);
    throw new Error(`Registration failed with status ${regRes.status}`);
  }

  const member = regRes.body.data.member;
  console.log(`✓ Pioneer Member Registered: MemberCode = ${member.memberCode}, Name = "${member.name}"`);

  // Step 6: Verify Member ID Cards
  const cards = await prisma.memberIdCard.findMany({
    where: { memberId: member.id },
    orderBy: { cardNumber: "asc" }
  });
  console.log(`✓ Member ID Cards Created (${cards.length} cards):`);
  for (const card of cards) {
    console.log(`  - Card ${card.cardNumber} (${card.type}) -> Status: ${card.status || "ACTIVE"}`);
  }

  // Step 7: Verify PIN is REDEEMED
  const redeemedPin = await prisma.activationPin.findUnique({
    where: { pinCode: generatedPin.pinCode }
  });
  console.log(`\nStep 5: Verifying PIN redemption status...`);
  console.log(`- Status:           ${redeemedPin.status}`);
  console.log(`- Redeemed By:      Member ID ${redeemedPin.redeemedByMemberId}`);
  console.log(`- Redeemed At:      ${redeemedPin.redeemedAt?.toISOString()}`);

  if (redeemedPin.status !== "REDEEMED" || redeemedPin.redeemedByMemberId !== member.id) {
    throw new Error("PIN redemption verification failed!");
  }

  // Step 8: Reconcile financial ledger
  console.log("\nStep 6: Running Platform Financial Reconciliation...");
  const recon = await runReconciliation();
  if (!recon.isReconciled || recon.divergencesCount > 0) {
    throw new Error("Reconciliation variance detected!");
  }

  console.log("\n================================================================================");
  console.log("🎉 LIVE ADMIN PIN BOOTSTRAP VERIFICATION PASSED WITH 100% SUCCESS");
  console.log("================================================================================");
}

runLiveBootstrapVerification()
  .then(() => prisma.$disconnect())
  .catch(err => {
    console.error("\n❌ LIVE VERIFICATION ERROR:", err);
    prisma.$disconnect();
    process.exit(1);
  });
