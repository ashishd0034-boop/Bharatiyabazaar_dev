const prisma = require("../src/lib/prisma");
const { seedSettingsAndSuperAdmin } = require("../src/lib/seedSettings");

async function resetMemberSequence() {
  console.log("================================================================================");
  console.log("⚡ INITIATING SEQUENCE RESET, BUSINESS DATA WIPE & COMPANY WALLET BOOTSTRAP");
  console.log("================================================================================");

  // 1. Truncate business tables in strict cascading order
  const tablesToTruncate = [
    "ledger_entries",
    "activation_pins",
    "commission_entries",
    "payonce_ledger",
    "withdrawals",
    "tds_ledger",
    "vouchers",
    "setukosh_nodes",
    "setukosh_counters",
    "vendor_sales",
    "vendor_settlements",
    "vendor_referral_bonus",
    "vendors",
    "autopool_nodes",
    "MySystemNode",
    "MemberIdCard",
    "members",
    "wallets",
    "system_counters"
  ];

  for (const table of tablesToTruncate) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`);
    console.log(`✓ Truncated ${table}`);
  }

  // 2. Clean audit logs preserving only ADMIN logs
  await prisma.$executeRawUnsafe(`DELETE FROM "audit_logs" WHERE "actorType" != 'ADMIN';`);
  console.log("✓ Preserved administrative audit logs");

  // 3. Upsert System Counters (AUTOPOOL_GLOBAL -> 0, MEMBER_CODE -> 10000)
  await prisma.systemCounter.upsert({
    where: { id: "AUTOPOOL_GLOBAL" },
    create: { id: "AUTOPOOL_GLOBAL", currentValue: 0 },
    update: { currentValue: 0 }
  });
  console.log("✓ SystemCounter AUTOPOOL_GLOBAL upserted to 0 (Next: 1 -> BB10001)");

  await prisma.systemCounter.upsert({
    where: { id: "MEMBER_CODE" },
    create: { id: "MEMBER_CODE", currentValue: 10000 },
    update: { currentValue: 10000 }
  });
  console.log("✓ SystemCounter MEMBER_CODE upserted to 10000 (Next: 10001 -> BB10001)");

  // 4. Recreate Company Reserve Member & Wallet (Amendment 1)
  await prisma.member.upsert({
    where: { id: "COMPANY_WALLET" },
    create: {
      id: "COMPANY_WALLET",
      name: "Company Reserve Wallet",
      mobile: "0000000000",
      status: "SYSTEM"
    },
    update: {}
  });

  await prisma.wallet.upsert({
    where: { memberId: "COMPANY_WALLET" },
    create: {
      memberId: "COMPANY_WALLET",
      balancePaise: 0
    },
    update: { balancePaise: 0 }
  });
  console.log("✓ Recreated Company Reserve Member (COMPANY_WALLET) and Wallet (0 balance)");

  // 5. Ensure Platform Settings & Super Admin are present
  await seedSettingsAndSuperAdmin();
  console.log("✓ Verified Platform Settings & Super Admin account");

  // 6. Report Current DB Summary
  const [
    memberCount,
    walletCount,
    pinCount,
    cardCount,
    autopoolCount,
    settingsCount,
    adminCount,
    companyWallet,
    counterAutopool,
    counterMemberCode
  ] = await Promise.all([
    prisma.member.count({ where: { status: { not: "SYSTEM" } } }),
    prisma.wallet.count(),
    prisma.activationPin.count(),
    prisma.memberIdCard.count(),
    prisma.autoPoolNode.count(),
    prisma.platformSetting.count(),
    prisma.adminUser.count(),
    prisma.wallet.findUnique({ where: { memberId: "COMPANY_WALLET" } }),
    prisma.systemCounter.findUnique({ where: { id: "AUTOPOOL_GLOBAL" } }),
    prisma.systemCounter.findUnique({ where: { id: "MEMBER_CODE" } })
  ]);

  console.log("\n================================================================================");
  console.log("📊 CURRENT DATABASE INVENTORY:");
  console.log(`- Regular Members:     ${memberCount}`);
  console.log(`- Wallets:             ${walletCount} (Company Reserve Wallet present at ₹${(companyWallet?.balancePaise || 0) / 100})`);
  console.log(`- Activation PINs:     ${pinCount}`);
  console.log(`- ID Cards:            ${cardCount}`);
  console.log(`- AutoPool Nodes:      ${autopoolCount}`);
  console.log(`- Platform Settings:   ${settingsCount}`);
  console.log(`- Admin Users:         ${adminCount}`);
  console.log(`- AUTOPOOL_GLOBAL:     ${counterAutopool?.currentValue}`);
  console.log(`- MEMBER_CODE:         ${counterMemberCode?.currentValue}`);
  console.log("================================================================================");
}

if (require.main === module) {
  resetMemberSequence()
    .catch((err) => {
      console.error("Error during sequence reset:", err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

module.exports = { resetMemberSequence };
