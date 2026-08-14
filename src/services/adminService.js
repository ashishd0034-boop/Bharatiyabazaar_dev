const prisma = require("../lib/prisma");
const { logAction } = require("./auditService");

const FINANCIAL_SETTINGS = [
  "TDS_194H_RATE", "TDS_194R_RATE", "TDS_194C_RATE",
  "ADMIN_CHARGE_BANK", "ADMIN_CHARGE_WALLET", "ADMIN_CHARGE_VOUCHER",
  "VENDOR_EARLY_SETTLEMENT_FEE", "SETU_KOSH_THRESHOLD"
];

/**
 * Get a platform setting by key.
 * 
 * @param {String} key 
 * @param {any} defaultValue 
 * @param {String} type - 'string', 'integer', 'boolean', 'json'
 * @returns {any}
 */
async function getSetting(key, defaultValue, type = 'string') {
  const setting = await prisma.platformSetting.findUnique({
    where: { key }
  });

  if (!setting) return defaultValue;

  switch (type) {
    case 'integer':
      return parseInt(setting.value, 10);
    case 'boolean':
      return setting.value === 'true';
    case 'json':
      return JSON.parse(setting.value);
    default:
      return setting.value;
  }
}

/**
 * Update a platform setting and log the audit action.
 * 
 * @param {String} key 
 * @param {String} value 
 * @param {String} adminId 
 * @param {String} [description] 
 */
async function updateSetting(key, value, adminId, description = null) {
  const admin = await prisma.adminUser.findUnique({
    where: { id: adminId }
  });

  if (!admin) {
    throw new Error("Admin user not found.");
  }

  // RBAC: Only SUPER_ADMIN can update financial settings
  if (FINANCIAL_SETTINGS.includes(key) && admin.role !== "SUPER_ADMIN") {
    throw new Error(`Unauthorized: Only SUPER_ADMIN can update financial setting ${key}.`);
  }

  const existingSetting = await prisma.platformSetting.findUnique({
    where: { key }
  });

  const oldValue = existingSetting ? existingSetting.value : null;

  // No-op if value hasn't changed
  if (oldValue === value) {
    return existingSetting;
  }

  const updatedSetting = await prisma.platformSetting.upsert({
    where: { key },
    update: { 
      value,
      description: description || existingSetting?.description,
      updatedBy: admin.id
    },
    create: {
      key,
      value,
      description,
      updatedBy: admin.id
    }
  });

  // Audit Log
  await logAction({
    action: "SETTINGS_UPDATED",
    actorType: "ADMIN",
    actorId: admin.id,
    entityType: "PlatformSetting",
    entityId: updatedSetting.id,
    metadata: {
      key,
      oldValue,
      newValue: value,
      reason: description
    }
  });

  return updatedSetting;
}

module.exports = {
  getSetting,
  updateSetting,
  FINANCIAL_SETTINGS
};
