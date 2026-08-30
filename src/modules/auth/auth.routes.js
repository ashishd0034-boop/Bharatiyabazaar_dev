const express = require("express");
const authController = require("./auth.controller");
const validate = require("../../core/middleware/validate.middleware");
const schemas = require("./auth.schemas");
const rateLimit = require("express-rate-limit");

const router = express.Router();

const strictAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === "test" ? 100 : 5, // Strict 5 in prod/dev; permits test suite runs
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: "TOO_MANY_REQUESTS", message: "Too many attempts, please try again later." } }
});

const pinVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === "test" ? 100 : 10, // 10 attempts per 15 min per IP to prevent PIN brute-forcing
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: "TOO_MANY_REQUESTS", message: "Too many PIN verification attempts, please try again later." } }
});

router.get("/validate-referral", authController.validateReferral);
router.post("/verify-pin", pinVerifyLimiter, validate(schemas.verifyPinSchema), authController.verifyPin);
router.post("/register", strictAuthLimiter, validate(schemas.registerSchema), authController.register);
router.post("/login", strictAuthLimiter, validate(schemas.loginSchema), authController.login);
router.post("/admin/login", strictAuthLimiter, validate(schemas.adminLoginSchema), authController.adminLogin);

module.exports = router;
