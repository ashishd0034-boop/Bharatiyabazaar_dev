const prisma = require("../database/prisma");
const { logAction } = require("./audit.service");
const crypto = require("crypto");

// In-memory cache with 60s TTL
const cache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

const SUPER_ADMIN_ONLY_PREFIXES = ["TDS_", "VENDOR_INACTIVITY_"];
const SUPER_ADMIN_ONLY_KEYS = [
  "MY_SYSTEM_7DAY_HOLD",
  "AUTOPOOL_LOCKED_BEFORE_ACB",
  "REBIRTH_WITHDRAWAL_REQUIRES_MAIN_ACB",
  "COMPANY_WALLET_MEMBER_ID"
];

function isSuperAdminOnly(key) {
  if (SUPER_ADMIN_ONLY_KEYS.includes(key)) return true;
  if (SUPER_ADMIN_ONLY_PREFIXES.some(p => key.startsWith(p))) return true;
  return false;
}

function parseSettingValue(rawVal, type) {
  if (rawVal === undefined || rawVal === null) return rawVal;
  switch (type) {
    case "integer":
      return parseInt(rawVal, 10);
    case "number":
    case "float":
      return parseFloat(rawVal);
    case "boolean":
      return rawVal === "true" || rawVal === true || rawVal === "1" || rawVal === 1;
    case "json":
      try {
        return typeof rawVal === "string" ? JSON.parse(rawVal) : rawVal;
      } catch (e) {
        return rawVal;
      }
    default:
      return String(rawVal);
  }
}

/**
 * Get a platform setting by key with in-memory caching (<= 60s TTL).
 */
async function getSetting(key, defaultValue, type = "string") {
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return parseSettingValue(cached.value, type);
  }

  const setting = await prisma.platformSetting.findUnique({
    where: { key }
  });

  if (!setting) {
    return defaultValue;
  }

  cache.set(key, {
    value: setting.value,
    expiresAt: Date.now() + CACHE_TTL_MS
  });

  return parseSettingValue(setting.value, type);
}

async function getSettingNumber(key, defaultValue) {
  return await getSetting(key, defaultValue, "number");
}

async function getSettingBoolean(key, defaultValue) {
  return await getSetting(key, defaultValue, "boolean");
}

function invalidateCache(key = null) {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}

/**
 * Retrieve all platform settings from the database.
 */
async function getAllSettings() {
  return await prisma.platformSetting.findMany({
    orderBy: { key: "asc" }
  });
}

/**
 * Update a platform setting with RBAC checks and immutable audit logging.
 */
async function updateSetting(key, value, adminId, description = null) {
  const admin = await prisma.adminUser.findUnique({
    where: { id: adminId }
  });

  if (!admin) {
    const err = new Error("Admin user not found.");
    err.status = 401;
    err.code = "UNAUTHORIZED";
    throw err;
  }

  const normRole = (admin.role || "").toUpperCase();

  // RBAC: Only SUPER_ADMIN can update financial/TDS/system lifecycle settings
  if (isSuperAdminOnly(key) && normRole !== "SUPER_ADMIN" && normRole !== "SUPERADMIN") {
    const err = new Error(`Unauthorized: Only SUPER_ADMIN can update ${key}.`);
    err.status = 403;
    err.code = "FORBIDDEN";
    throw err;
  }

  const existingSetting = await prisma.platformSetting.findUnique({
    where: { key }
  });

  const oldValue = existingSetting ? existingSetting.value : null;
  const strValue = String(value);

  const updatedSetting = await prisma.platformSetting.upsert({
    where: { key },
    update: {
      value: strValue,
      description: description || existingSetting?.description,
      updatedBy: admin.id
    },
    create: {
      key,
      value: strValue,
      description,
      updatedBy: admin.id
    }
  });

  // Invalidate Cache
  invalidateCache(key);

  // Write immutable AuditLog
  await logAction({
    action: "SETTINGS_UPDATED",
    actorType: "ADMIN",
    actorId: admin.id,
    entityType: "PlatformSetting",
    entityId: updatedSetting.id,
    metadata: {
      key,
      oldValue,
      newValue: strValue,
      reason: description
    }
  });

  return updatedSetting;
}

/**
 * Category margin update with applyToExisting toggle.
 */
async function updateCategoryMargin(category, marginRatePct, applyToExisting = false, adminId, description = null) {
  const admin = await prisma.adminUser.findUnique({
    where: { id: adminId }
  });

  if (!admin) {
    const err = new Error("Admin user not found.");
    err.status = 401;
    err.code = "UNAUTHORIZED";
    throw err;
  }

  const normCat = (category || "").toUpperCase();
  const key = `CATEGORY_MARGIN_${normCat}`;
  const rateVal = parseFloat(marginRatePct);

  const setting = await updateSetting(key, String(rateVal), adminId, description || `Category margin for ${normCat}`);

  let updatedVendorsCount = 0;

  if (applyToExisting) {
    const updateRes = await prisma.vendor.updateMany({
      where: { category: normCat },
      data: { marginRatePct: rateVal }
    });
    updatedVendorsCount = updateRes.count;
  }

  await logAction({
    action: "CATEGORY_MARGIN_UPDATED",
    actorType: "ADMIN",
    actorId: admin.id,
    entityType: "Category",
    entityId: normCat,
    metadata: {
      category: normCat,
      marginRatePct: rateVal,
      applyToExisting,
      updatedVendorsCount
    }
  });

  return {
    setting,
    category: normCat,
    marginRatePct: rateVal,
    applyToExisting,
    updatedVendorsCount
  };
}

/**
 * Administrative Member Password Reset (SUPER_ADMIN & ADMIN).
 */
async function resetMemberPassword(adminId, adminEmail, memberId, ipAddress = null) {
  const bcrypt = require("bcrypt");

  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { id: true, memberCode: true, name: true, mobile: true }
  });

  if (!member) {
    const err = new Error("Member not found.");
    err.code = "NOT_FOUND";
    err.status = 404;
    throw err;
  }

  const randomSuffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  const temporaryPassword = `BB@Temp${randomSuffix}`;
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);

  await prisma.$transaction(async (tx) => {
    await tx.member.update({
      where: { id: memberId },
      data: { passwordHash }
    });

    await logAction({
      action: "MEMBER_PASSWORD_RESET",
      actorType: "ADMIN",
      actorId: adminId,
      entityType: "Member",
      entityId: member.id,
      metadata: {
        memberCode: member.memberCode,
        memberName: member.name,
        adminEmail
      },
      ipAddress
    });
  });

  return {
    memberId: member.id,
    memberCode: member.memberCode,
    name: member.name,
    mobile: member.mobile,
    temporaryPassword
  };
}

/**
 * Direct administrative PIN generation by SUPER_ADMIN (admin-privileged operation).
 * Bypasses wallet debit, generates batch of PINs with purchasedByMemberId = null,
 * and records structured AuditLog.
 */
async function adminGeneratePins(adminId, count = 1, quantity = 1, reason = "", ipAddress = null) {
  const batchCount = parseInt(count, 10) || 1;
  const qty = parseInt(quantity, 10) || 1;

  if (batchCount < 1 || batchCount > 20) {
    const err = new Error("Batch count must be between 1 and 20.");
    err.code = "INVALID_BATCH_COUNT";
    err.status = 400;
    throw err;
  }

  if (qty < 1 || qty > 10) {
    const err = new Error("Quantity per PIN must be between 1 and 10.");
    err.code = "INVALID_QUANTITY";
    err.status = 400;
    throw err;
  }

  if (!reason || reason.trim().length < 5) {
    const err = new Error("Administrative reason is required (min 5 characters).");
    err.code = "REASON_REQUIRED";
    err.status = 400;
    throw err;
  }

  const idPricePaise = await getSetting("ID_PRICE_PAISE", 60000, "integer");
  const pricePaise = qty * idPricePaise;

  return await prisma.$transaction(async (tx) => {
    const createdPins = [];
    const pinCodes = [];

    for (let i = 0; i < batchCount; i++) {
      let pinCode;
      let isUnique = false;

      while (!isUnique) {
        const randomHex = crypto.randomBytes(4).toString("hex").toUpperCase();
        pinCode = `PIN-${randomHex}`;
        const existing = await tx.activationPin.findUnique({ where: { pinCode } });
        if (!existing) isUnique = true;
      }

      const pin = await tx.activationPin.create({
        data: {
          pinCode,
          quantity: qty,
          pricePaise,
          status: "AVAILABLE",
          purchasedByMemberId: null
        }
      });

      createdPins.push({
        id: pin.id,
        pinCode: pin.pinCode,
        quantity: pin.quantity,
        pricePaise: pin.pricePaise,
        status: pin.status,
        issuanceType: "ADMIN_ISSUED",
        createdAt: pin.createdAt
      });
      pinCodes.push(pinCode);
    }

    await logAction({
      action: "ADMIN_PIN_GENERATED",
      actorType: "ADMIN",
      actorId: adminId,
      entityType: "ActivationPin",
      entityId: pinCodes[0] || null,
      metadata: {
        count: batchCount,
        quantityPerPin: qty,
        totalPricePaise: pricePaise * batchCount,
        pinCodes,
        reason: reason.trim()
      },
      ipAddress
    });

    return {
      pins: createdPins,
      totalGenerated: createdPins.length,
      reason: reason.trim()
    };
  }, { timeout: 15000 });
}

module.exports = {
  getSetting,
  getSettingNumber,
  getSettingBoolean,
  getAllSettings,
  updateSetting,
  updateCategoryMargin,
  invalidateCache,
  isSuperAdminOnly,
  resetMemberPassword,
  adminGeneratePins
};
