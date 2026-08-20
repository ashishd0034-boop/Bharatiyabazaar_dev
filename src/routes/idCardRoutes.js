const express = require("express");
const router = express.Router();
const idCardService = require("../services/idCardService");
const prisma = require("../lib/prisma");

// POST /api/id-cards/purchase
router.post("/purchase", async (req, res) => {
  try {
    const { memberId, count, sponsorIdCardId, sponsorSide } = req.body;

    if (!memberId || !count || count < 1) {
      return res.status(400).json({
        success: false,
        message: "memberId and count (minimum 1) are required"
      });
    }

    // Validate sponsor side if provided
    if (sponsorIdCardId && !["LEFT", "RIGHT"].includes(sponsorSide)) {
      return res.status(400).json({
        success: false,
        message: "sponsorSide must be LEFT or RIGHT when sponsorIdCardId is provided"
      });
    }

    const cards = await idCardService.purchaseIds(
      memberId,
      count,
      sponsorIdCardId,
      sponsorSide
    );

    res.status(201).json({
      success: true,
      message: `Successfully purchased ${cards.length} ID(s)`,
      data: cards
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
// For authenticated users to buy extra IDs (uses token, not memberId in body)
router.post("/purchase-additional", async (req, res) => {
  try {
    const requested = parseInt(req.body && req.body.count, 10) || 1;
    const count = Math.min(Math.max(requested, 1), 10);

    // Get memberId from auth token (set by auth middleware)
    const memberId = (req.member && req.member.id) || req.memberId || (req.user && (req.user.id || req.user.memberId));
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

    await idCardService.purchaseIds(memberId, count, null, null);

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
    res.status(500).json({
      success: false,
      error: { code: "PURCHASE_FAILED", message: err.message }
    });
  }
});

module.exports = router;