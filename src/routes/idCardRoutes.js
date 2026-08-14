const express = require("express");
const router = express.Router();
const idCardService = require("../services/idCardService");

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

module.exports = router;