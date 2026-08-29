const express = require("express");
const router = express.Router();
const idCardService = require("../services/idCardService");
const pinService = require("../services/pinService");
const walletService = require("../services/walletService");
const adminService = require("../services/adminService");
const prisma = require("../lib/prisma");

// POST /api/id-cards/purchase
router.post("/purchase", async (req, res, next) => {
  try {
    const { count, sponsorIdCardId, sponsorSide, pinCode, activationPin } = req.body;
    const memberId = req.member.id; // Enforce authenticated member's ID

    const requestedCount = parseInt(count, 10) || 1;
    if (requestedCount < 1) {
      return res.status(400).json({
        success: false,
        error: { code: "BAD_REQUEST", message: "count (minimum 1) is required" }
      });
    }

    // Validate sponsor side if provided
    if (sponsorIdCardId && !["LEFT", "RIGHT"].includes(sponsorSide)) {
      return res.status(400).json({
        success: false,
        error: { code: "BAD_REQUEST", message: "sponsorSide must be LEFT or RIGHT when sponsorIdCardId is provided" }
      });
    }

    const pinToUse = (pinCode || activationPin || "").trim().toUpperCase();
    const idPricePaise = await adminService.getSetting("ID_PRICE_PAISE", 60000, "integer");
    const totalCostPaise = requestedCount * idPricePaise;
    const companyMemberId = await adminService.getSetting("COMPANY_WALLET_MEMBER_ID", "COMPANY_WALLET");

    const cards = await prisma.$transaction(async (tx) => {
      if (pinToUse) {
        // 1. Redeem PIN atomically
        await pinService.validateAndRedeemPin(tx, pinToUse, memberId, requestedCount);
      } else {
        // 2. Check wallet balance & debit atomically
        const wallet = await tx.wallet.findUnique({ where: { memberId } });
        if (!wallet || wallet.balancePaise < totalCostPaise) {
          const err = new Error(`Insufficient wallet balance (Required: ₹${(totalCostPaise / 100).toFixed(2)}) or valid activation PIN required.`);
          err.status = 400;
          err.code = "INSUFFICIENT_FUNDS";
          throw err;
        }

        await walletService.debit(
          tx,
          memberId,
          totalCostPaise,
          "ID_PURCHASE",
          null,
          `Purchase of ${requestedCount} ID card(s)`
        );

        await walletService.credit(
          tx,
          companyMemberId,
          totalCostPaise,
          "ID_SALE",
          null,
          `Revenue from ${requestedCount} ID card(s) purchase by member ${memberId}`
        );
      }

      return await idCardService.purchaseIds(memberId, requestedCount, sponsorIdCardId, sponsorSide, tx);
    }, { timeout: 30000 });

    res.status(201).json({
      success: true,
      message: `Successfully purchased ${cards.length} ID(s)`,
      data: cards
    });
  } catch (error) {
    if (error.status === 400 || error.code === "INSUFFICIENT_FUNDS" || error.code === "INVALID_PIN" || error.code === "PIN_NOT_AVAILABLE" || error.code === "PIN_ALREADY_REDEEMED" || error.code === "PIN_QTY_MISMATCH" || error.code === "BAD_REQUEST") {
      return res.status(400).json({
        success: false,
        error: { code: error.code || "BAD_REQUEST", message: error.message }
      });
    }
    next(error);
  }
});

// GET /api/id-cards/my-cards
router.get("/my-cards", async (req, res) => {
  try {
    const memberId = req.member.id;
    const cards = await prisma.memberIdCard.findMany({
      where: { memberId },
      include: {
        mySystemNode: true,
        autoPoolNode: true
      },
      orderBy: { createdAt: "asc" }
    });

    res.json({
      success: true,
      data: cards
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// GET /api/id-cards/commissions
router.get("/commissions", async (req, res) => {
  try {
    const memberId = req.member.id;
    const commissions = await prisma.commissionEntry.findMany({
      where: {
        idCard: { memberId }
      },
      include: {
        idCard: { select: { cardNumber: true, type: true } }
      },
      orderBy: { createdAt: "desc" }
    });

    res.json({
      success: true,
      data: commissions
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// GET /api/id-cards/tree/:memberId
router.get("/tree/:memberId", async (req, res) => {
  try {
    const { memberId } = req.params;

    // Enforce authorization: only account owner or Admin can inspect tree
    if (req.member?.id !== memberId && req.admin?.role !== "ADMIN" && req.admin?.role !== "SUPER_ADMIN") {
      return res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: "You are not authorized to view this tree." }
      });
    }

    const idCards = await prisma.memberIdCard.findMany({
      where: { memberId },
      include: {
        mySystemNode: true,
        autoPoolNode: true
      }
    });

    res.json({
      success: true,
      data: idCards
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// 🆕 POST /api/id-cards/purchase-additional
// For authenticated users to buy extra IDs (requires wallet balance or PIN)
router.post("/purchase-additional", async (req, res, next) => {
  try {
    const requested = parseInt(req.body && req.body.count, 10) || 1;
    const count = Math.min(Math.max(requested, 1), 10);
    const { pinCode, activationPin } = req.body || {};

    const memberId = (req.member && req.member.id) || req.memberId;
    if (!memberId) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Please log in to purchase IDs" }
      });
    }

    const mainCard = await prisma.memberIdCard.findFirst({
      where: { memberId, type: "MAIN" }
    });
    if (!mainCard) {
      return res.status(400).json({
        success: false,
        error: { code: "NO_MAIN_ID", message: "Please activate your membership (MAIN ID) first." }
      });
    }

    const pinToUse = (pinCode || activationPin || "").trim().toUpperCase();
    const idPricePaise = await adminService.getSetting("ID_PRICE_PAISE", 60000, "integer");
    const totalCostPaise = count * idPricePaise;
    const companyMemberId = await adminService.getSetting("COMPANY_WALLET_MEMBER_ID", "COMPANY_WALLET");

    await prisma.$transaction(async (tx) => {
      if (pinToUse) {
        await pinService.validateAndRedeemPin(tx, pinToUse, memberId, count);
      } else {
        const wallet = await tx.wallet.findUnique({ where: { memberId } });
        if (!wallet || wallet.balancePaise < totalCostPaise) {
          const err = new Error(`Insufficient wallet balance (Required: ₹${(totalCostPaise / 100).toFixed(2)}) or valid activation PIN required.`);
          err.status = 400;
          err.code = "INSUFFICIENT_FUNDS";
          throw err;
        }

        await walletService.debit(
          tx,
          memberId,
          totalCostPaise,
          "ID_PURCHASE",
          null,
          `Purchase of ${count} additional ID card(s)`
        );

        await walletService.credit(
          tx,
          companyMemberId,
          totalCostPaise,
          "ID_SALE",
          null,
          `Revenue from ${count} additional ID card(s) purchase by member ${memberId}`
        );
      }

      await idCardService.purchaseIds(memberId, count, null, null, tx);
    }, { timeout: 30000 });

    const newCards = await prisma.memberIdCard.findMany({
      where: { memberId },
      orderBy: { createdAt: "desc" },
      take: count,
      include: {
        mySystemNode: {
          include: {
            parent: { include: { idCard: { select: { cardNumber: true, member: { select: { memberCode: true } } } } } }
          }
        },
        autoPoolNode: true
      }
    });

    res.json({
      success: true,
      data: {
        purchased: newCards.length,
        cards: newCards.map((c) => ({
          cardNumber: c.cardNumber,
          type: c.type,
          placedUnder: c.mySystemNode && c.mySystemNode.parent ? c.mySystemNode.parent.idCard.cardNumber : "ROOT",
          side: c.mySystemNode ? c.mySystemNode.side : null,
          poolPosition: c.autoPoolNode ? c.autoPoolNode.globalPosition : null
        }))
      }
    });
  } catch (err) {
    if (err.status === 400 || err.code === "INSUFFICIENT_FUNDS" || err.code === "INVALID_PIN" || err.code === "PIN_NOT_AVAILABLE" || err.code === "PIN_ALREADY_REDEEMED" || err.code === "PIN_QTY_MISMATCH" || err.code === "BAD_REQUEST" || err.code === "NO_MAIN_ID") {
      return res.status(400).json({
        success: false,
        error: { code: err.code || "BAD_REQUEST", message: err.message }
      });
    }
    next(err);
  }
});

module.exports = router;