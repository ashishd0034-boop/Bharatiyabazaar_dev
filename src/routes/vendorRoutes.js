const express = require("express");
const vendorController = require("../controllers/vendorController");
const vendorAuthMiddleware = require("../middleware/vendorAuthMiddleware");
const validate = require("../middleware/validateMiddleware");
const schemas = require("../validations/schemas");

const rateLimit = require("express-rate-limit");

const router = express.Router();

const vendorAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "test" ? 100 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: "TOO_MANY_REQUESTS", message: "Too many attempts, please try again later." } }
});

// Public vendor registration & login (rate limited)
router.post("/register", vendorAuthLimiter, validate(schemas.vendorRegisterSchema), vendorController.register);
router.post("/login", vendorAuthLimiter, validate(schemas.loginSchema), vendorController.login);

// Protected vendor routes (strictly vendorAuthMiddleware asserting token.type === 'VENDOR')
router.get("/me", vendorAuthMiddleware, vendorController.getProfile);
router.post("/sale", vendorAuthMiddleware, validate(schemas.vendorSaleSchema), vendorController.recordSale);
router.get("/settlements", vendorAuthMiddleware, vendorController.getSettlements);
router.post("/settlement/early", vendorAuthMiddleware, vendorController.requestEarlySettlement);

module.exports = router;
