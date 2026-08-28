const prisma = require("./prisma");
const bcrypt = require("bcrypt");

const DEFAULT_SETTINGS = [
  { key: "ID_PRICE_PAISE", value: "60000", description: "Standard price per ID card activation in paise (Rs. 600)" },
  { key: "MAX_PURCHASED_IDS", value: "255", description: "Maximum purchased IDs per member (rebirths exempt)" },
  { key: "MY_SYSTEM_7DAY_HOLD", value: "true", description: "Enforce 7-day fraud hold on MY SYSTEM commissions" },
  { key: "AUTOPOOL_LOCKED_BEFORE_ACB", value: "true", description: "Require ACB to withdraw AutoPool commissions" },
  { key: "REBIRTH_WITHDRAWAL_REQUIRES_MAIN_ACB", value: "true", description: "Require owner MAIN ID ACB for rebirth withdrawals" },

  { key: "TDS_194H_THRESHOLD_PAISE", value: "2000000", description: "194H FY exemption threshold (Rs. 20,000 in paise)" },
  { key: "TDS_194H_RATE_VERIFIED", value: "0.03", description: "194H TDS rate with verified PAN (3%)" },
  { key: "TDS_194H_RATE_UNVERIFIED", value: "0.20", description: "194H TDS rate without PAN (20%)" },

  { key: "TDS_194R_THRESHOLD_PAISE", value: "2000000", description: "194R FY exemption threshold (Rs. 20,000 in paise)" },
  { key: "TDS_194R_RATE", value: "0.10", description: "194R TDS rate (10%)" },

  { key: "TDS_194C_SINGLE_THRESHOLD_PAISE", value: "3000000", description: "194C single transaction threshold (Rs. 30,000 in paise)" },
  { key: "TDS_194C_AGGREGATE_THRESHOLD_PAISE", value: "10000000", description: "194C FY aggregate threshold (Rs. 1,00,000 in paise)" },
  { key: "TDS_194C_RATE_INDIVIDUAL", value: "0.01", description: "194C rate for individual/proprietorship with PAN (1%)" },
  { key: "TDS_194C_RATE_COMPANY", value: "0.02", description: "194C rate for company with PAN (2%)" },
  { key: "TDS_194C_RATE_UNVERIFIED", value: "0.20", description: "194C rate without PAN (20%)" },

  { key: "ADMIN_CHARGE_BANK_PCT", value: "10", description: "Admin charge % for bank withdrawal (10%)" },
  { key: "ADMIN_CHARGE_WALLET_PCT", value: "5", description: "Admin charge % for wallet transfer (5%)" },
  { key: "ADMIN_CHARGE_VOUCHER_PCT", value: "5", description: "Admin charge % for voucher conversion (5%)" },

  { key: "VENDOR_ADMIN_CHARGE_BANK_PCT", value: "10", description: "Vendor settlement admin charge % for bank payout" },
  { key: "VENDOR_ADMIN_CHARGE_WALLET_PCT", value: "5", description: "Vendor settlement admin charge % for wallet credit" },

  { key: "SETU_KOSH_COUNTER_THRESHOLD_PAISE", value: "100000", description: "Setu Kosh ID creation threshold (Rs. 1,000 in paise)" },
  { key: "SETU_KOSH_PIN_GATE_COUNT", value: "10", description: "Active member threshold per PIN code to activate commissions" },
  { key: "SETU_KOSH_REFERRAL_BONUS_BPS", value: "25", description: "Vendor purchase referral bonus in basis points (25 bps = 0.25%)" },

  { key: "EARLY_SETTLEMENT_FEE_PAISE", value: "25000", description: "Vendor on-demand early settlement fee (Rs. 250 in paise)" },

  { key: "VOLUME_DISCOUNT_TIER_1_MIN_SALES_PAISE", value: "0", description: "Volume discount Tier 1 min monthly sales" },
  { key: "VOLUME_DISCOUNT_TIER_1_RATE_PCT", value: "0", description: "Volume discount Tier 1 discount % on admin charge" },
  { key: "VOLUME_DISCOUNT_TIER_2_MIN_SALES_PAISE", value: "5000000", description: "Volume discount Tier 2 min monthly sales (Rs. 50k)" },
  { key: "VOLUME_DISCOUNT_TIER_2_RATE_PCT", value: "10", description: "Volume discount Tier 2 discount % on admin charge" },
  { key: "VOLUME_DISCOUNT_TIER_3_MIN_SALES_PAISE", value: "10000000", description: "Volume discount Tier 3 min monthly sales (Rs. 1L)" },
  { key: "VOLUME_DISCOUNT_TIER_3_RATE_PCT", value: "20", description: "Volume discount Tier 3 discount % on admin charge" },
  { key: "VOLUME_DISCOUNT_TIER_4_MIN_SALES_PAISE", value: "20000000", description: "Volume discount Tier 4 min monthly sales (Rs. 2L)" },
  { key: "VOLUME_DISCOUNT_TIER_4_RATE_PCT", value: "30", description: "Volume discount Tier 4 discount % on admin charge" },
  { key: "VOLUME_DISCOUNT_TIER_5_MIN_SALES_PAISE", value: "50000000", description: "Volume discount Tier 5 min monthly sales (Rs. 5L)" },
  { key: "VOLUME_DISCOUNT_TIER_5_RATE_PCT", value: "50", description: "Volume discount Tier 5 discount % on admin charge" },

  { key: "VENDOR_INACTIVITY_INACTIVE_DAYS", value: "31", description: "Days without sales before vendor becomes INACTIVE" },
  { key: "VENDOR_INACTIVITY_FROZEN_DAYS", value: "91", description: "Days without sales before vendor deposit is FROZEN" },
  { key: "VENDOR_INACTIVITY_CLOSED_DAYS", value: "181", description: "Days without sales before vendor is permanently CLOSED" },

  { key: "VOUCHER_FACE_VALUE_PAISE", value: "20000", description: "Default face value of AutoPool L5-L7 vouchers (Rs. 200 in paise)" },
  { key: "VOUCHER_VALIDITY_DAYS", value: "365", description: "Validity of AutoPool vouchers in days" },

  { key: "CATEGORY_MARGIN_GROCERY", value: "7.0", description: "Default margin % for Grocery category" },
  { key: "CATEGORY_MARGIN_ELECTRONICS", value: "10.0", description: "Default margin % for Electronics category" },
  { key: "CATEGORY_MARGIN_SERVICES", value: "0.0", description: "Default margin % for Services category" },
  { key: "CATEGORY_MARGIN_GENERAL", value: "10.0", description: "Default margin % for General category" },

  { key: "COMPANY_WALLET_MEMBER_ID", value: "COMPANY_WALLET", description: "System member ID for company reserve and closed streams" }
];

const adminService = require("../services/adminService");

async function seedSettingsAndSuperAdmin() {
  // 1. Seed Platform Settings
  for (const s of DEFAULT_SETTINGS) {
    try {
      const existing = await prisma.platformSetting.findUnique({ where: { key: s.key } });
      if (!existing) {
        await prisma.platformSetting.create({ data: s }).catch(() => {});
      } else {
        await prisma.platformSetting.update({
          where: { key: s.key },
          data: { value: s.value, description: s.description }
        }).catch(() => {});
      }
    } catch (e) {
      // Ignore concurrent race during test cleans
    }
  }
  adminService.invalidateCache();

  // 2. Seed / Bootstrap Superadmin
  const superAdminEmail = (process.env.SUPERADMIN_EMAIL || "admin@bharatiyabazaar.com").toLowerCase();
  const rawPassword = process.env.SUPERADMIN_PASSWORD || "Admin@123456";
  const passwordHash = await bcrypt.hash(rawPassword, 10);

  await prisma.adminUser.upsert({
    where: { email: superAdminEmail },
    create: {
      email: superAdminEmail,
      passwordHash,
      role: "SUPER_ADMIN",
      name: "Super Administrator"
    },
    update: {
      role: "SUPER_ADMIN"
    }
  });

  if (!process.env.SUPERADMIN_PASSWORD) {
    console.warn("⚠️ [SECURITY WARNING] Default SUPERADMIN bootstrapped with 'admin@bharatiyabazaar.com' / 'Admin@123456'. Please change this password on first login!");
  } else {
    console.log(`[BOOTSTRAP] Superadmin account created for ${superAdminEmail}`);
  }

  // 3. Ensure COMPANY_WALLET system member exists
  try {
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
  } catch (e) {
    // Ignore concurrent race during test cleans
  }
}

module.exports = {
  seedSettingsAndSuperAdmin,
  DEFAULT_SETTINGS
};
