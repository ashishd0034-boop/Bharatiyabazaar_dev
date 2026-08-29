const crypto = require("crypto");
const prisma = require("../lib/prisma");
const walletService = require("./walletService");
const adminService = require("./adminService");
const { logAction } = require("./auditService");

/**
 * Generate a new activation PIN using funds from the purchaser's wallet.
 * Debits purchaser wallet, credits company reserve wallet (accounting invariant).
 */
async function generatePin(purchaserMemberId, quantity, customTx = null) {
  const qty = parseInt(quantity, 10);
  if (isNaN(qty) || qty < 1 || qty > 10) {
    const err = new Error("Quantity must be between 1 and 10.");
    err.code = "INVALID_QUANTITY";
    err.status = 400;
    throw err;
  }

  const idPricePaise = await adminService.getSetting("ID_PRICE_PAISE", 60000, "integer");
  const pricePaise = qty * idPricePaise;
  const companyMemberId = await adminService.getSetting("COMPANY_WALLET_MEMBER_ID", "COMPANY_WALLET");

  const runLogic = async (tx) => {
    // Generate secure random PIN code: PIN-XXXXXXXX
    const randomHex = crypto.randomBytes(4).toString("hex").toUpperCase();
    const pinCode = `PIN-${randomHex}`;

    // 1. Debit purchaser wallet
    await walletService.debit(
      tx,
      purchaserMemberId,
      pricePaise,
      "PIN_PURCHASE",
      pinCode,
      `Purchase of ${qty} activation PIN (${pinCode})`
    );

    // 2. Safeguard: Credit company revenue wallet (Sum of wallets == Sum of ledger)
    await walletService.credit(
      tx,
      companyMemberId,
      pricePaise,
      "PIN_SALE",
      pinCode,
      `Revenue from PIN ${pinCode} purchase by member ${purchaserMemberId}`
    );

    // 3. Create ActivationPin record
    const pin = await tx.activationPin.create({
      data: {
        pinCode,
        quantity: qty,
        pricePaise,
        status: "AVAILABLE",
        purchasedByMemberId: purchaserMemberId
      }
    });

    return {
      id: pin.id,
      pinCode: pin.pinCode,
      quantity: pin.quantity,
      pricePaise: pin.pricePaise,
      status: pin.status,
      createdAt: pin.createdAt
    };
  };

  if (customTx) {
    return await runLogic(customTx);
  } else {
    return await prisma.$transaction(runLogic, { timeout: 15000 });
  }
}

/**
 * Validate PIN code status and return metadata.
 */
async function validatePin(pinCode) {
  const cleanCode = (pinCode || "").trim().toUpperCase();
  if (!cleanCode) {
    const err = new Error("PIN code is required.");
    err.code = "PIN_REQUIRED";
    err.status = 400;
    throw err;
  }

  const pin = await prisma.activationPin.findUnique({
    where: { pinCode: cleanCode },
    include: {
      purchasedByMember: {
        select: { name: true, memberCode: true }
      }
    }
  });

  if (!pin) {
    const err = new Error("Invalid PIN code.");
    err.code = "INVALID_PIN";
    err.status = 400;
    throw err;
  }

  if (pin.status !== "AVAILABLE") {
    const err = new Error(`PIN is not available (Status: ${pin.status}).`);
    err.code = "PIN_NOT_AVAILABLE";
    err.status = 400;
    throw err;
  }

  return {
    valid: true,
    pinCode: pin.pinCode,
    quantity: pin.quantity,
    pricePaise: pin.pricePaise,
    status: pin.status,
    purchasedBy: pin.purchasedByMember ? {
      name: pin.purchasedByMember.name,
      memberCode: pin.purchasedByMember.memberCode
    } : null
  };
}

/**
 * Validate and atomically redeem a PIN inside a transaction with concurrency protection.
 */
async function validateAndRedeemPin(tx, pinCode, redeemingMemberId, requestedQty = null) {
  const cleanCode = (pinCode || "").trim().toUpperCase();
  if (!cleanCode) {
    const err = new Error("PIN code is required.");
    err.code = "PIN_REQUIRED";
    err.status = 400;
    throw err;
  }

  // 1. Check existence and quantity
  const pin = await tx.activationPin.findUnique({
    where: { pinCode: cleanCode }
  });

  if (!pin) {
    const err = new Error("Invalid PIN code.");
    err.code = "INVALID_PIN";
    err.status = 400;
    throw err;
  }

  if (requestedQty !== null && pin.quantity !== requestedQty) {
    const err = new Error(`PIN quantity mismatch. This PIN provides ${pin.quantity} ID(s), but ${requestedQty} requested.`);
    err.code = "PIN_QTY_MISMATCH";
    err.status = 400;
    throw err;
  }

  // 2. Concurrency Lock: Atomic updateMany ensuring count === 1
  const updateResult = await tx.activationPin.updateMany({
    where: {
      pinCode: cleanCode,
      status: "AVAILABLE"
    },
    data: {
      status: "REDEEMED",
      redeemedByMemberId: redeemingMemberId,
      redeemedAt: new Date()
    }
  });

  if (updateResult.count !== 1) {
    const err = new Error("PIN is invalid or already redeemed.");
    err.code = "PIN_ALREADY_REDEEMED";
    err.status = 400;
    throw err;
  }

  return {
    ...pin,
    status: "REDEEMED",
    redeemedByMemberId: redeemingMemberId,
    redeemedAt: new Date()
  };
}

/**
 * List PINs for admin / member query.
 */
async function listPins(filter = {}) {
  const where = {};
  if (filter.status) where.status = filter.status.toUpperCase();
  if (filter.purchasedByMemberId) where.purchasedByMemberId = filter.purchasedByMemberId;
  if (filter.redeemedByMemberId) where.redeemedByMemberId = filter.redeemedByMemberId;

  return await prisma.activationPin.findMany({
    where,
    include: {
      purchasedByMember: {
        select: { id: true, name: true, memberCode: true, mobile: true }
      },
      redeemedByMember: {
        select: { id: true, name: true, memberCode: true, mobile: true }
      }
    },
    orderBy: { createdAt: "desc" },
    take: filter.limit || 100,
    skip: filter.offset || 0
  });
}

/**
 * Admin action to revoke an unredeemed PIN.
 */
async function revokePin(pinId, adminId, reason = null) {
  const pin = await prisma.activationPin.findUnique({
    where: { id: pinId }
  });

  if (!pin) {
    const err = new Error("PIN not found.");
    err.code = "NOT_FOUND";
    err.status = 404;
    throw err;
  }

  if (pin.status !== "AVAILABLE") {
    const err = new Error(`Cannot revoke PIN with status ${pin.status}.`);
    err.code = "BAD_REQUEST";
    err.status = 400;
    throw err;
  }

  const updated = await prisma.activationPin.update({
    where: { id: pinId },
    data: { status: "REVOKED" }
  });

  await logAction({
    action: "PIN_REVOKED",
    actorType: "ADMIN",
    actorId: adminId,
    entityType: "ActivationPin",
    entityId: pinId,
    metadata: {
      pinCode: pin.pinCode,
      reason
    }
  });

  return updated;
}

/**
 * Direct administrative PIN generation by SUPER_ADMIN.
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

  const idPricePaise = await adminService.getSetting("ID_PRICE_PAISE", 60000, "integer");
  const pricePaise = qty * idPricePaise;

  return await prisma.$transaction(async (tx) => {
    const createdPins = [];
    const pinCodes = [];

    for (let i = 0; i < batchCount; i++) {
      let pinCode;
      let isUnique = false;

      // Ensure uniqueness
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
          purchasedByMemberId: null // Admin issued
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

    // Write AuditLog
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
  generatePin,
  validatePin,
  validateAndRedeemPin,
  listPins,
  revokePin,
  adminGeneratePins
};
