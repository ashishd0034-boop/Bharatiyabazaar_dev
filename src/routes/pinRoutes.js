const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const pinService = require("../services/pinService");

const router = express.Router();

// POST /api/pins/purchase (Member auth)
router.post("/purchase", authMiddleware, async (req, res, next) => {
  try {
    const { quantity } = req.body;
    const memberId = req.member.id;

    const pin = await pinService.generatePin(memberId, quantity);

    res.status(201).json({
      success: true,
      message: `Successfully purchased activation PIN for ${pin.quantity} ID(s).`,
      data: pin
    });
  } catch (err) {
    if (err.message && err.message.includes("Insufficient funds")) {
      return res.status(400).json({
        success: false,
        error: { code: "INSUFFICIENT_FUNDS", message: err.message }
      });
    }
    if (err.code === "INVALID_QUANTITY" || err.status === 400) {
      return res.status(400).json({
        success: false,
        error: { code: err.code || "BAD_REQUEST", message: err.message }
      });
    }
    next(err);
  }
});

const rateLimit = require("express-rate-limit");

const pinValidateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: "TOO_MANY_REQUESTS", message: "Too many PIN validation attempts, please try again later." } }
});

// POST /api/pins/validate (Member auth + rate limited)
router.post("/validate", pinValidateLimiter, authMiddleware, async (req, res, next) => {
  try {
    const { pinCode } = req.body;
    const pin = await pinService.validatePin(pinCode);

    res.json({
      success: true,
      data: pin
    });
  } catch (err) {
    if (err.status === 400 || err.code === "INVALID_PIN" || err.code === "PIN_NOT_AVAILABLE" || err.code === "PIN_REQUIRED") {
      return res.status(400).json({
        success: false,
        error: { code: err.code || "BAD_REQUEST", message: err.message }
      });
    }
    next(err);
  }
});

// GET /api/pins/my-pins (Member auth)
router.get("/my-pins", authMiddleware, async (req, res, next) => {
  try {
    const memberId = req.member.id;
    const pins = await pinService.listPins({ purchasedByMemberId: memberId });

    res.json({
      success: true,
      data: pins
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
