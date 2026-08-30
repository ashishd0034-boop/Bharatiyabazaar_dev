const prisma = require("../database/prisma");

/**
 * Logs an action to the AuditLog.
 * 
 * @param {Object} params
 * @param {String} params.action - e.g., "SETTINGS_UPDATED", "WITHDRAWAL_APPROVED"
 * @param {String} params.actorType - "ADMIN", "SYSTEM", "MEMBER"
 * @param {String} [params.actorId] - ID of the admin/member. Null for SYSTEM.
 * @param {String} [params.entityType] - e.g., "PlatformSetting"
 * @param {String} [params.entityId] - ID of the affected entity
 * @param {Object} [params.metadata] - Additional info (oldValue, newValue, reason)
 * @param {String} [params.ipAddress] - Request IP
 */
async function logAction({
  action,
  actorType,
  actorId = null,
  entityType = null,
  entityId = null,
  metadata = null,
  ipAddress = null
}) {
  return await prisma.auditLog.create({
    data: {
      action,
      actorType,
      actorId,
      entityType,
      entityId,
      metadata: metadata || undefined,
      ipAddress
    }
  });
}

module.exports = {
  logAction
};
