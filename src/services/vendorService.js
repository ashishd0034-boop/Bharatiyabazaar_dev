const prisma = require("../lib/prisma");
const setuKoshService = require("./setuKoshService");
const adminService = require("./adminService");

const DEFAULT_CATEGORY_MARGINS = {
  GROCERY: 7.0,
  APPAREL: 15.0,
  ELECTRONICS: 10.0,
  RESTAURANT: 12.0,
  HEALTHCARE: 10.0,
  SERVICES: 20.0,
  GENERAL: 10.0
};

/**
 * Resolves category margin percentage from PlatformSettings or default.
 */
async function getCategoryMargin(category = "GENERAL") {
  const normCat = (category || "GENERAL").toUpperCase();
  const settingKey = `CATEGORY_MARGIN_${normCat}`;
  const legacyKey = `VENDOR_MARGIN_${normCat}`;

  const dynamicMargin = await adminService.getSetting(settingKey, null).catch(() => null) ??
    await adminService.getSetting(legacyKey, null).catch(() => null);

  if (dynamicMargin !== null && dynamicMargin !== undefined && dynamicMargin !== "undefined") {
    return parseFloat(dynamicMargin);
  }

  return DEFAULT_CATEGORY_MARGINS[normCat] ?? 10.0;
}

/**
 * Registers a new vendor with category margin and permanent referral binding.
 */
async function registerVendor(data) {
  const {
    memberId,
    businessName,
    category = "GENERAL",
    gstin,
    address,
    pinCode,
    marginRatePct,
    referredByMemberId = null
  } = data;

  const resolvedMargin = marginRatePct ?? (await getCategoryMargin(category));

  return await prisma.$transaction(async (tx) => {
    const existing = await tx.vendor.findUnique({
      where: { memberId }
    });

    if (existing) {
      throw new Error(`Member ${memberId} is already registered as a vendor`);
    }

    const vendor = await tx.vendor.create({
      data: {
        memberId,
        businessName,
        category: category.toUpperCase(),
        gstin,
        address,
        pinCode,
        marginRatePct: resolvedMargin,
        status: "ACTIVE"
      }
    });

    // Permanent first-referrer binding
    if (referredByMemberId) {
      const existingRef = await tx.vendorReferralBonus.findFirst({
        where: { referredVendorId: vendor.id }
      });

      if (!existingRef) {
        await tx.vendorReferralBonus.create({
          data: {
            memberId: referredByMemberId,
            referredVendorId: vendor.id,
            bonusPaise: 0,
            status: "ACTIVE"
          }
        });
      }
    }

    return vendor;
  });
}

/**
 * Delegate purchase to setuKoshService.recordPurchase.
 */
async function processMemberPurchase(memberId, vendorId, amountPaise, options = {}) {
  return await setuKoshService.recordPurchase(memberId, vendorId, amountPaise, options);
}

module.exports = {
  getCategoryMargin,
  registerVendor,
  processMemberPurchase,
  DEFAULT_CATEGORY_MARGINS
};
