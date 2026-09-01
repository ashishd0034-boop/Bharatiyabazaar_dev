const crypto = require("crypto");
const prisma = require("../../core/database/prisma");
const walletService = require("../../core/services/wallet.service");
const adminService = require("../../core/services/system-settings.service");
const { logAction } = require("../../core/services/audit.service");

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

    const purchaser = await tx.member.findUnique({
      where: { id: purchaserMemberId },
      select: { memberCode: true, name: true }
    });

    await logAction({
      action: "PIN_PURCHASED",
      actorType: "MEMBER",
      actorId: purchaserMemberId,
      entityType: "ActivationPin",
      entityId: pin.id,
      metadata: {
        pinCode: pin.pinCode,
        quantity: qty,
        pricePaise,
        purchaserMemberCode: purchaser?.memberCode,
        purchaserName: purchaser?.name
      }
    });

    return {
      id: pin.id,
      pinCode: pin.pinCode,
      quantity: pin.quantity,
      pricePaise: pin.pricePaise,
      status: pin.status,
      source: "MEMBER_PURCHASED",
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
 * List PINs for member or admin query.
 */
async function listPins(filter = {}) {
  const where = {};
  if (filter.status && filter.status.toUpperCase() !== "ALL") {
    where.status = filter.status.toUpperCase();
  }
  if (filter.purchasedByMemberId) {
    where.purchasedByMemberId = filter.purchasedByMemberId;
  }
  if (filter.redeemedByMemberId) {
    where.redeemedByMemberId = filter.redeemedByMemberId;
  }
  if (filter.source === "ADMIN_ISSUED") {
    where.purchasedByMemberId = null;
  } else if (filter.source === "MEMBER_PURCHASED") {
    where.purchasedByMemberId = { not: null };
  }
  if (filter.purchaserCode || filter.memberCode) {
    const code = (filter.purchaserCode || filter.memberCode).trim().toUpperCase();
    where.purchasedByMember = {
      memberCode: { contains: code }
    };
  }

  const pins = await prisma.activationPin.findMany({
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
    take: filter.limit ? parseInt(filter.limit, 10) : 100,
    skip: filter.offset ? parseInt(filter.offset, 10) : 0
  });

  return pins.map(p => ({
    ...p,
    source: p.purchasedByMemberId ? "MEMBER_PURCHASED" : "ADMIN_ISSUED"
  }));
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

module.exports = {
  generatePin,
  validatePin,
  validateAndRedeemPin,
  listPins,
  revokePin
};
