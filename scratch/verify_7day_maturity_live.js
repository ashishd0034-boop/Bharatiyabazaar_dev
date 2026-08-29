const request = require("supertest");
const app = require("../src/server");
const prisma = require("../src/lib/prisma");
const { resetMemberSequence } = require("./reset_member_sequence");
const { run7DaySweep } = require("../src/jobs/scheduler");

async function main() {
  console.log("================================================================================");
  console.log("🧪 LIVE E2E: 7-DAY COMMISSION MATURITY PIPELINE & TIME-TRAVEL SWEEP");
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
      reason: "Root Pioneer Member 3-ID Registration"
    });
  const adminPin = pinGenRes.body.data.pins[0];
  console.log(`✓ Admin PIN Generated: ${adminPin.pinCode} (${adminPin.quantity} IDs)`);

  // 3. Register Root Member (BB10001, SB10002, SB10003)
  console.log("\n[STEP 3] Registering Root Member...");
  const regRes = await request(app)
    .post("/api/auth/register")
    .send({
      name: "Root Pioneer Member",
      mobile: "9888111111",
      password: "password123",
      pinCode: "110001",
      activationPin: adminPin.pinCode,
      side: "LEFT"
    });
  if (regRes.status !== 201) throw new Error("Registration failed");
  const member = regRes.body.data.member;
  const cards = await prisma.memberIdCard.findMany({ where: { memberId: member.id }, orderBy: { createdAt: "asc" } });
  const subCard2 = cards.find(c => c.cardNumber.endsWith("2") || c.type === "SUB");
  console.log(`✓ Member Registered: ${member.memberCode} | Target SUB Card: ${subCard2.cardNumber}`);

  // 4. Create a PENDING_7_DAY Commission on SB10002
  console.log(`\n[STEP 4] Creating a PENDING_7_DAY commission on ${subCard2.cardNumber}...`);
  // Ensure ACB is true on SB10002 for maturity testing
  await prisma.memberIdCard.update({
    where: { id: subCard2.id },
    data: { acbStatus: true }
  });

  const comm = await prisma.commissionEntry.create({
    data: {
      idCardId: subCard2.id,
      stream: "MY_SYSTEM",
      level: 1,
      amountPaise: 30000, // ₹300
      status: "PENDING_7_DAY",
      createdAt: new Date() // Fresh commission
    }
  });
  console.log(`✓ Commission Created: ID ${comm.id} (Status: ${comm.status}, Amount: ₹${comm.amountPaise / 100})`);

  // 5. Authenticate as SB10002 & Check Pre-Maturity Dashboard Slices
  console.log(`\n[STEP 5] Checking ${subCard2.cardNumber} Pre-Maturity Dashboard Stats...`);
  const subLoginRes = await request(app)
    .post("/api/auth/login")
    .send({ mobile: subCard2.cardNumber, password: "password123" });
  const subToken = subLoginRes.body.data.token;

  const preBalanceRes = await request(app)
    .get("/api/wallet/balance")
    .set("Authorization", `Bearer ${subToken}`);

  console.log(`- ${subCard2.cardNumber} Wallet Balance:    ₹${preBalanceRes.body.data.displayBalancePaise / 100} (Expected: ₹0.00)`);
  console.log(`- ${subCard2.cardNumber} Total Earnings:    ₹${preBalanceRes.body.data.displayTotalEarningsPaise / 100} (Expected: ₹300.00)`);
  console.log(`- ${subCard2.cardNumber} On-Hold:           ₹${preBalanceRes.body.data.displayOnHoldPaise / 100} (Expected: ₹300.00)`);

  if (preBalanceRes.body.data.displayBalancePaise !== 0) throw new Error("Pre-maturity balance must be 0");
  if (preBalanceRes.body.data.displayTotalEarningsPaise !== 30000) throw new Error("Pre-maturity total earnings must be ₹300");
  if (preBalanceRes.body.data.displayOnHoldPaise !== 30000) throw new Error("Pre-maturity on hold must be ₹300");

  // 6. Time-Travel: Advance commission createdAt by 8 days (> 7 days)
  console.log("\n[STEP 6] Time-Traveling: Advancing commission age to 8 days ago...");
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  await prisma.commissionEntry.update({
    where: { id: comm.id },
    data: { createdAt: eightDaysAgo }
  });

  // 7. Execute 7-Day Maturity Sweep
  console.log("\n[STEP 7] Executing run7DaySweep()...");
  const processed = await run7DaySweep();
  console.log(`✓ 7-Day Maturity Sweep processed: ${processed} commission(s)`);
  if (processed !== 1) throw new Error(`Expected 1 processed commission, got ${processed}`);

  // 8. Verify Post-Maturity Slices & Parity
  console.log(`\n[STEP 8] Checking ${subCard2.cardNumber} Post-Maturity Dashboard Stats...`);
  const postBalanceRes = await request(app)
    .get("/api/wallet/balance")
    .set("Authorization", `Bearer ${subToken}`);

  console.log(`- ${subCard2.cardNumber} Wallet Balance:    ₹${postBalanceRes.body.data.displayBalancePaise / 100} (Expected: ₹300.00)`);
  console.log(`- ${subCard2.cardNumber} Total Earnings:    ₹${postBalanceRes.body.data.displayTotalEarningsPaise / 100} (Expected: ₹300.00)`);
  console.log(`- ${subCard2.cardNumber} On-Hold:           ₹${postBalanceRes.body.data.displayOnHoldPaise / 100} (Expected: ₹0.00)`);

  if (postBalanceRes.body.data.displayBalancePaise !== 30000) throw new Error("Post-maturity balance must be ₹300");
  if (postBalanceRes.body.data.displayOnHoldPaise !== 0) throw new Error("Post-maturity on hold must be ₹0");

  // 9. Financial Reconciliation Check
  console.log("\n[STEP 9] Verifying Financial Ledger Reconciliation...");
  const reportRes = await request(app)
    .get("/api/admin/reports/reconciliation")
    .set("Authorization", `Bearer ${adminToken}`);
  console.log(`- Reconciliation: isReconciled=${reportRes.body.data.isReconciled}, Variance = ₹${reportRes.body.data.variancePaise / 100}`);
  if (!reportRes.body.data.isReconciled || reportRes.body.data.variancePaise !== 0) {
    throw new Error("Financial reconciliation variance detected");
  }
  console.log("✅ FINANCIAL RECONCILIATION VERIFIED: Δ = 0!");

  // 10. Final Pristine Reset
  console.log("\n[STEP 10] Final Pristine Reset for User Manual Testing...");
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
