const express = require("express");
const { createRateLimiter } = require("../../core/utils/rateLimiter");
const pinController = require("./pin.controller");
const authMiddleware = require("../../core/middleware/auth.middleware");

const router = express.Router();

const pinValidateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  prodMax: 5,
  message: "Too many PIN validation attempts, please try again later."
});

// Member PIN Endpoints
router.post("/purchase", authMiddleware, (req, res, next) => pinController.purchase(req, res, next));
router.post("/validate", pinValidateLimiter, authMiddleware, (req, res, next) => pinController.validate(req, res, next));
router.get("/my-pins", authMiddleware, (req, res, next) => pinController.getMyPins(req, res, next));

module.exports = router;
