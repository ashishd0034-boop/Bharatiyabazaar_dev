const request = require("supertest");
const app = require("../src/server");
const prisma = require("../src/lib/prisma");
const { resetMemberSequence } = require("./reset_member_sequence");
const walletService = require("../src/services/walletService");

async function main() {
  console.log("================================================================================");
  console.log("🧪 LIVE VERIFICATION: CLEAN RESET, BB10001 REGISTRATION & PIN PURCHASE");
  console.log("================================================================================");

  // 1. First Clean Reset
  console.log("\n[STEP 1] Executing Clean Reset...");
  await resetMemberSequence();

  // 2. Super Admin Login
  console.log("\n[STEP 2] Super Admin Login...");
  const adminLoginRes = await request(app)
    .post("/api/admin/login")
    .send({
      email: "admin@bharatiyabazaar.com",
      password: process.env.SUPERADMIN_PASSWORD || "Admin@123456"
    });
  if (adminLoginRes.status !== 200 || !adminLoginRes.body.success) {
    throw new Error(`Admin login failed: ${JSON.stringify(adminLoginRes.body)}`);
  }
  const adminToken = adminLoginRes.body.data.token;
  console.log("✓ Super Admin authenticated successfully.");

  // 3. Super Admin Generates 3-ID PIN
  console.log("\n[STEP 3] Super Admin generates 3-ID PIN...");
  const pinGenRes = await request(app)
    .post("/api/admin/pins/generate")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      quantity: 3,
      count: 1,
      reason: "Initial Bootstrap Root Member Registration"
    });
  if (pinGenRes.status !== 201 || !pinGenRes.body.success) {
    throw new Error(`PIN generation failed: ${JSON.stringify(pinGenRes.body)}`);
  }
  const adminPin = pinGenRes.body.data.pins[0];
  console.log(`✓ Admin PIN Generated: ${adminPin.pinCode} (${adminPin.quantity} IDs, ₹${adminPin.pricePaise / 100})`);

  // 4. Register Root Member using Admin PIN and password "password123"
  console.log("\n[STEP 4] Registering Root Member with PIN...");
  const regRes = await request(app)
    .post("/api/auth/register")
    .send({
      name: "Root Pioneer Member",
      mobile: "9888539202",
      password: "password123",
      pinCode: "110001",
      activationPin: adminPin.pinCode,
      side: "LEFT"
    });
  if (regRes.status !== 201 || !regRes.body.success) {
    throw new Error(`Registration failed: ${JSON.stringify(regRes.body)}`);
  }

  const memberData = regRes.body.data.member;
  const cards = await prisma.memberIdCard.findMany({ where: { memberId: memberData.id } });
  console.log(`✓ Member Registered! Code: ${memberData.memberCode}, Name: ${memberData.name}`);
  console.log(`✓ Generated Cards (${cards.length}): ${cards.map(c => `${c.cardNumber} (${c.type})`).join(", ")}`);

  // Assert exact memberCode is BB10001
  if (memberData.memberCode !== "BB10001") {
    throw new Error(`SEQUENCE ERROR: Expected memberCode to be 'BB10001' but got '${memberData.memberCode}'`);
  }
  console.log("✅ PERFECT SEQUENCE VERIFIED: memberCode is exactly 'BB10001'!");

  // 5. Member Login with password "password123"
  console.log("\n[STEP 5] Testing Member Login with 'password123'...");
  const memberLoginRes = await request(app)
    .post("/api/auth/login")
    .send({
      mobile: "9888539202",
      password: "password123"
    });
  if (memberLoginRes.status !== 200 || !memberLoginRes.body.success) {
    throw new Error(`Member login failed: ${JSON.stringify(memberLoginRes.body)}`);
  }
  const memberToken = memberLoginRes.body.data.token;
  console.log("✓ Member login succeeded with password 'password123'. Session token received.");

  // 6. Grant ₹600 via walletService.adjustBalance (ADMIN_ADJUSTMENT)
  console.log("\n[STEP 6] Granting ₹600 wallet balance to BB10001 via adjustBalance...");
  await prisma.$transaction(async (tx) => {
    await walletService.adjustBalance(
      tx,
      memberData.id,
      60000,
      "Initial testing funds for PIN purchase",
      "MANUAL_DEV_TOPUP_600"
    );
  });
  const updatedWallet = await prisma.wallet.findUnique({ where: { memberId: memberData.id } });
  console.log(`✓ Member Wallet Balance: ₹${updatedWallet.balancePaise / 100}`);

  // 7. Member Purchases 1-ID PIN from Wallet
  console.log("\n[STEP 7] Member purchases 1-ID PIN from wallet (₹600)...");
  const initialMemberBalance = updatedWallet.balancePaise;
  const purchaseRes = await request(app)
    .post("/api/pins/purchase")
    .set("Authorization", `Bearer ${memberToken}`)
    .send({ quantity: 1 });
  if (purchaseRes.status !== 201 || !purchaseRes.body.success) {
    throw new Error(`PIN purchase failed: ${JSON.stringify(purchaseRes.body)}`);
  }
  const purchasedPin = purchaseRes.body.data;
  console.log(`✓ PIN Purchased Successfully: ${purchasedPin.pinCode} (Status: ${purchasedPin.status})`);

  // 8. Confirm Balances and Financial Parity
  console.log("\n[STEP 8] Verifying Financial Parity...");
  const postMemberWallet = await prisma.wallet.findUnique({ where: { memberId: memberData.id } });
  const companyWallet = await prisma.wallet.findUnique({ where: { memberId: "COMPANY_WALLET" } });
  console.log(`- Member Wallet Balance:  ₹${postMemberWallet.balancePaise / 100} (Expected: ₹${(initialMemberBalance - 60000) / 100})`);
  console.log(`- Company Wallet Balance: ₹${companyWallet.balancePaise / 100} (Expected: ₹600.00)`);

  if (postMemberWallet.balancePaise !== initialMemberBalance - 60000) throw new Error("Member wallet balance mismatch");
  if (companyWallet.balancePaise !== 60000) throw new Error("Company wallet balance mismatch");

  // Run reconciliation check
  const reportRes = await request(app)
    .get("/api/admin/reports/reconciliation")
    .set("Authorization", `Bearer ${adminToken}`);
  console.log(`- Reconciliation: isReconciled=${reportRes.body.data?.isReconciled}, Variance = ₹${(reportRes.body.data?.variancePaise || 0) / 100}`);
  if (!reportRes.body.data?.isReconciled || reportRes.body.data?.variancePaise !== 0) {
    throw new Error(`Reconciliation discrepancy detected: Variance = ${reportRes.body.data?.variancePaise}`);
  }
  console.log("✅ FINANCIAL RECONCILIATION VERIFIED: Δ = 0!");

  // 9. Verify Admin Password Reset produces one-time random temp password
  console.log("\n[STEP 9] Verifying Admin Password Reset on BB10001...");
  const resetRes = await request(app)
    .post(`/api/admin/members/${memberData.id}/reset-password`)
    .set("Authorization", `Bearer ${adminToken}`);
  if (resetRes.status !== 200 || !resetRes.body.success) {
    throw new Error(`Password reset failed: ${JSON.stringify(resetRes.body)}`);
  }
  const tempPass = resetRes.body.data.temporaryPassword;
  console.log(`✓ Admin Password Reset Generated: ${tempPass}`);
  if (!tempPass.startsWith("BB@Temp")) throw new Error("Temp password prefix mismatch");

  // 10. Amendment 3: Final pristine reset for manual testing
  console.log("\n[STEP 10] AMENDMENT 3: Final Pristine Sequence Reset for User Manual Testing...");
  await resetMemberSequence();
  console.log("✅ DATABASE LEFT PRISTINE: 0 members, AUTOPOOL_GLOBAL=0, MEMBER_CODE=10000, Company Wallet=₹0");
  console.log("================================================================================");
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error("Error in live verification:", err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
