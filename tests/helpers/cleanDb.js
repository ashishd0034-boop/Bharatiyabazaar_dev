/**
 * Clean all database tables using TRUNCATE TABLE ... CASCADE.
 * In PostgreSQL, TRUNCATE does not fire row-level triggers (such as ledger_immutability_guard).
 */
async function truncateDb(prisma) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "ledger_entries",
      "wallets",
      "commission_entries",
      "payonce_ledger",
      "MySystemNode",
      "autopool_nodes",
      "MemberIdCard",
      "vouchers",
      "withdrawals",
      "setukosh_nodes",
      "setukosh_counters",
      "tds_ledger",
      "vendor_sales",
      "vendor_settlements",
      "vendor_referral_bonus",
      "vendors",
      "activation_pins",
      "audit_logs",
      "members",
      "system_counters",
      "platform_settings",
      "admin_users"
    CASCADE;
  `);
}

module.exports = { truncateDb };
