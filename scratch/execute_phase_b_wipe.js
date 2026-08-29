const prisma = require("../src/lib/prisma");
const bcrypt = require("bcrypt");
const request = require("supertest");
const app = require("../src/server");

async function executePhaseBWipe() {
  console.log("================================================================================");
  console.log("🧹 EXECUTING PHASE B: COMPLETE BUSINESS DATA WIPE");
  console.log(`Database: ${process.env.DATABASE_URL?.split("@")[1] || "bb_dev"}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log("================================================================================\n");

  // Step 1: Truncate all business data tables with CASCADE
  console.log("Step 1: Truncating business data tables via TRUNCATE TABLE ... CASCADE...");

  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "ledger_entries",
      "activation_pins",
      "commission_entries",
      "withdrawals",
      "tds_ledger",
      "autopool_nodes",
      "MySystemNode",
      "MemberIdCard",
      "vouchers",
      "setukosh_nodes",
      "setukosh_counters",
      "payonce_ledger",
      "vendor_sales",
      "vendor_settlements",
      "vendor_referral_bonus",
      "vendors",
      "wallets",
      "members"
    CASCADE;
  `);

  console.log("✓ All business data tables truncated.");

  // Step 2: Clean audit logs (Keep only ADMIN action logs)
  console.log("\nStep 2: Cleaning audit logs (preserving ADMIN actorType entries)...");
  const deletedAuditLogs = await prisma.auditLog.deleteMany({
    where: {
      actorType: {
        not: "ADMIN"
      }
    }
  });
  console.log(`✓ Deleted ${deletedAuditLogs.count} non-admin audit log entries.`);

  // Step 3: Verification of Empty Business Tables
  console.log("\nStep 3: Verifying zero counts across business tables...");
  const [
    memberCount,
    walletCount,
    ledgerCount,
    pinCount,
    cardCount,
    autopoolCount,
    mysystemCount,
    withdrawalCount,
    commissionCount,
    vendorCount,
    settingsCount,
    adminCount,
    remainingAuditCount
  ] = await Promise.all([
    prisma.member.count(),
    prisma.wallet.count(),
    prisma.ledgerEntry.count(),
    prisma.activationPin.count(),
    prisma.memberIdCard.count(),
    prisma.autoPoolNode.count(),
    prisma.mySystemNode.count(),
    prisma.withdrawal.count(),
    prisma.commissionEntry.count(),
    prisma.vendor.count(),
    prisma.platformSetting.count(),
    prisma.adminUser.count(),
    prisma.auditLog.count()
  ]);

  console.log(`- Members:            ${memberCount}`);
  console.log(`- Wallets:            ${walletCount}`);
  console.log(`- Ledger Entries:     ${ledgerCount}`);
  console.log(`- Activation PINs:    ${pinCount}`);
  console.log(`- ID Cards:           ${cardCount}`);
  console.log(`- AutoPool Nodes:     ${autopoolCount}`);
  console.log(`- MySystem Nodes:     ${mysystemCount}`);
  console.log(`- Withdrawals:        ${withdrawalCount}`);
  console.log(`- Commission Entries: ${commissionCount}`);
  console.log(`- Vendors:            ${vendorCount}`);
  console.log(`- Platform Settings:  ${settingsCount} (Preserved)`);
  console.log(`- Admin Users:        ${adminCount} (Preserved)`);
  console.log(`- Admin Audit Logs:   ${remainingAuditCount} (Preserved)`);

  const businessDataClean = (
    memberCount === 0 &&
    walletCount === 0 &&
    ledgerCount === 0 &&
    pinCount === 0 &&
    cardCount === 0 &&
    autopoolCount === 0 &&
    mysystemCount === 0 &&
    withdrawalCount === 0 &&
    commissionCount === 0 &&
    vendorCount === 0
  );

  if (!businessDataClean) {
    throw new Error("WIPE FAILED: Some business tables still contain records!");
  }
  if (settingsCount === 0) {
    throw new Error("INTEGRITY ERROR: Platform settings were accidentally deleted!");
  }
  if (adminCount === 0) {
    throw new Error("INTEGRITY ERROR: Admin user was accidentally deleted!");
  }

  // Step 4: Verify Admin Login via API
  console.log("\nStep 4: Verifying Admin Login Endpoint...");
  const loginRes = await request(app)
    .post("/api/admin/login")
    .send({
      email: "admin@bharatiyabazaar.com",
      password: process.env.SUPERADMIN_PASSWORD || "Admin@123456"
    });

  console.log(`- Admin Login HTTP Status: ${loginRes.status}`);
  if (loginRes.status === 200 && loginRes.body.success) {
    console.log(`✓ Admin login verified successfully! Token received.`);
    console.log(`✓ Admin User Role: ${loginRes.body.data.admin.role}`);
  } else {
    console.error("Admin login response:", loginRes.body);
    throw new Error(`Admin login failed with status ${loginRes.status}`);
  }

  console.log("\n================================================================================");
  console.log("✅ PHASE B BUSINESS DATA WIPE COMPLETE & SYSTEM INTEGRITY VERIFIED");
  console.log("================================================================================");
}

executePhaseBWipe()
  .then(() => prisma.$disconnect())
  .catch(err => {
    console.error("\n❌ PHASE B WIPE ERROR:", err);
    prisma.$disconnect();
    process.exit(1);
  });
