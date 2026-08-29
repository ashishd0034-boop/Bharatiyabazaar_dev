const prisma = require("../src/lib/prisma");
const walletService = require("../src/services/walletService");
const pinService = require("../src/services/pinService");
const idCardService = require("../src/services/idCardService");
const { runReconciliation } = require("../scripts/reconcile");
const request = require("supertest");
const app = require("../src/server");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

async function runLiveE2E() {
  console.log("================================================================================");
  console.log("🚀 STARTING LIVE END-TO-END LEDGER INTEGRITY & PIN LIFECYCLE VERIFICATION");
  console.log("================================================================================\n");

  // Step 1: Pick a seeded member with wallet balance (e.g., BB10001)
  const sponsor = await prisma.member.findUnique({
    where: { memberCode: "BB10001" },
    include: { mainWallet: true }
  });

  if (!sponsor) {
    throw new Error("Seeded member BB10001 not found! Ensure database is seeded.");
  }

  console.log(`Step 1: Inspecting Seeded Sponsor [${sponsor.memberCode}]...`);
  console.log(`- Current Wallet Balance: ₹${sponsor.mainWallet.balancePaise / 100}`);

  // If sponsor has less than ₹600, credit via legitimate walletService credit inside tx
  if (sponsor.mainWallet.balancePaise < 60000) {
    console.log(`- Funding sponsor wallet with ₹600 via walletService.credit...`);
    await prisma.$transaction(async (tx) => {
      await walletService.credit(tx, sponsor.id, 60000, "COMMISSION", "SEED-TOPUP", "Sponsor commission topup");
    });
  }

  const sponsorWalletBefore = await prisma.wallet.findUnique({
    where: { id: sponsor.mainWallet.id }
  });
  console.log(`- Sponsor Balance Before PIN Purchase: ₹${sponsorWalletBefore.balancePaise / 100}`);

  // Sponsor buys 1 PIN (₹600)
  console.log(`\nStep 2: Sponsor purchases 1 Activation PIN via pinService.generatePin()...`);
  const pin = await pinService.generatePin(sponsor.id, 1);
  console.log(`✓ PIN Generated Successfully: Code = ${pin.pinCode}, Status = ${pin.status}, Qty = ${pin.quantity}`);

  const sponsorWalletAfter = await prisma.wallet.findUnique({
    where: { id: sponsor.mainWallet.id },
    include: { ledgerEntries: true }
  });
  console.log(`- Sponsor Balance After PIN Purchase: ₹${sponsorWalletAfter.balancePaise / 100}`);
  const pinPurchaseDebit = sponsorWalletAfter.ledgerEntries.find(e => e.referenceId === pin.pinCode && e.type === "DEBIT");
  if (!pinPurchaseDebit) {
    throw new Error("CRITICAL: Ledger entry for PIN_PURCHASE debit was not created!");
  }
  console.log(`✓ Verified Ledger Debit: ₹${pinPurchaseDebit.amountPaise / 100} (Source: ${pinPurchaseDebit.source})`);

  // Step 3: Fresh referral registers redeeming the generated PIN
  console.log(`\nStep 3: Fresh Referral registers using PIN [${pin.pinCode}]...`);
  const uniqueSuffix = Date.now().toString().slice(-6);
  const regRes = await request(app)
    .post("/api/auth/register")
    .send({
      name: `Live E2E Referral ${uniqueSuffix}`,
      mobile: `9333${uniqueSuffix}`,
      password: "Password123!",
      pinCode: "110001",
      activationPin: pin.pinCode,
      sponsorCardNumber: "BB10001",
      side: "LEFT"
    });

  if (regRes.status !== 201) {
    console.error("Registration failed:", regRes.body);
    throw new Error(`Registration failed with status ${regRes.status}`);
  }

  const newMember = regRes.body.data.member;
  console.log(`✓ Referral registered successfully: ID = ${newMember.id}, MemberCode = ${newMember.memberCode}`);

  // Check ID Card status
  const idCards = await prisma.memberIdCard.findMany({ where: { memberId: newMember.id } });
  console.log(`✓ Referral ID Cards Created: Count = ${idCards.length}`);
  const mainCard = idCards.find(c => c.type === "MAIN");
  if (!mainCard) {
    throw new Error("CRITICAL: Referral MAIN card was not created!");
  }
  console.log(`✓ Main Card Number: ${mainCard.cardNumber}, Active: ${mainCard.status || "ACTIVE"}`);

  // Verify PIN is now REDEEMED
  const updatedPin = await prisma.activationPin.findUnique({ where: { pinCode: pin.pinCode } });
  console.log(`✓ Activation PIN status after redemption: ${updatedPin.status} (Redeemed by Member ID: ${updatedPin.redeemedByMemberId})`);
  if (updatedPin.status !== "REDEEMED") {
    throw new Error("CRITICAL: PIN was not marked REDEEMED!");
  }

  // Step 4: Security Invariant Check — Direct wallet mutation MUST fail
  console.log(`\nStep 4: Attempting direct prisma.wallet.update (Bypassing ledger)...`);
  let trigger1Fired = false;
  try {
    await prisma.wallet.update({
      where: { id: sponsor.mainWallet.id },
      data: { balancePaise: 999999 }
    });
  } catch (err) {
    if (err.message.includes("LEDGER_INTEGRITY_VIOLATION")) {
      trigger1Fired = true;
      console.log(`✅ SUCCESS: Direct wallet balance injection rejected by database trigger:`);
      console.log(`   Error: "${err.message.trim()}"`);
    } else {
      throw err;
    }
  }
  if (!trigger1Fired) {
    throw new Error("CRITICAL FAILURE: wallet_ledger_guard trigger failed to block direct wallet balance mutation!");
  }

  // Step 5: Security Invariant Check — Direct LedgerEntry UPDATE/DELETE MUST fail
  console.log(`\nStep 5: Attempting direct UPDATE and DELETE on ledger_entries...`);
  let trigger2AFired = false;
  try {
    await prisma.ledgerEntry.update({
      where: { id: pinPurchaseDebit.id },
      data: { amountPaise: 1 }
    });
  } catch (err) {
    if (err.message.includes("LEDGER_IMMUTABLE")) {
      trigger2AFired = true;
      console.log(`✅ SUCCESS: Direct ledger UPDATE rejected by database trigger:`);
      console.log(`   Error: "${err.message.trim()}"`);
    } else {
      throw err;
    }
  }
  if (!trigger2AFired) {
    throw new Error("CRITICAL FAILURE: ledger_immutability_guard failed to block direct ledger update!");
  }

  let trigger2BFired = false;
  try {
    await prisma.ledgerEntry.delete({
      where: { id: pinPurchaseDebit.id }
    });
  } catch (err) {
    if (err.message.includes("LEDGER_IMMUTABLE")) {
      trigger2BFired = true;
      console.log(`✅ SUCCESS: Direct ledger DELETE rejected by database trigger:`);
      console.log(`   Error: "${err.message.trim()}"`);
    } else {
      throw err;
    }
  }
  if (!trigger2BFired) {
    throw new Error("CRITICAL FAILURE: ledger_immutability_guard failed to block direct ledger delete!");
  }

  // Step 6: Platform-wide continuous reconciliation check
  console.log(`\nStep 6: Executing Platform-Wide Continuous Financial Reconciliation...`);
  const reconResult = await runReconciliation();
  if (!reconResult.isReconciled || reconResult.divergencesCount > 0) {
    throw new Error(`CRITICAL: Reconciliation failed with ${reconResult.divergencesCount} divergent wallets!`);
  }

  // Step 7: Call GET /api/admin/reports/reconciliation HTTP endpoint
  console.log(`\nStep 7: Verifying GET /api/admin/reports/reconciliation API endpoint...`);
  const superAdmin = await prisma.adminUser.findFirst({ where: { role: "SUPER_ADMIN" } });
  const adminToken = jwt.sign(
    { id: superAdmin.id, email: superAdmin.email, role: "SUPER_ADMIN", type: "ADMIN" },
    JWT_SECRET,
    { expiresIn: "1h" }
  );

  const apiRecon = await request(app)
    .get("/api/admin/reports/reconciliation")
    .set("Authorization", `Bearer ${adminToken}`);

  console.log(`- API Status: ${apiRecon.status}`);
  console.log(`- Total Wallets Checked: ${apiRecon.body.data.totalWalletsChecked}`);
  console.log(`- Balanced Wallets: ${apiRecon.body.data.totalBalancedWallets}`);
  console.log(`- Divergent Wallets: ${apiRecon.body.data.totalDivergentWallets}`);
  console.log(`- System Variance: ₹${apiRecon.body.data.variancePaise / 100}`);
  console.log(`- Reconciled: ${apiRecon.body.data.isReconciled}`);

  if (apiRecon.status !== 200 || !apiRecon.body.data.isReconciled || apiRecon.body.data.totalDivergentWallets !== 0) {
    throw new Error("API Reconciliation failed!");
  }

  console.log("\n================================================================================");
  console.log("🎉 ALL LIVE END-TO-END VERIFICATION CHECKS PASSED WITH 100% INTEGRITY");
  console.log("================================================================================");
}

runLiveE2E()
  .then(() => {
    prisma.$disconnect();
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ LIVE E2E ERROR:", err);
    prisma.$disconnect();
    process.exit(1);
  });
