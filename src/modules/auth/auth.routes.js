const express = require("express");
const authController = require("./auth.controller");
const validate = require("../../core/middleware/validate.middleware");
const schemas = require("./auth.schemas");
const { createRateLimiter } = require("../../core/utils/rateLimiter");

const router = express.Router();

const strictAuthLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  prodMax: 5,
  message: "Too many attempts, please try again later."
});

const pinVerifyLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  prodMax: 10,
  message: "Too many PIN verification attempts, please try again later."
});

router.get("/validate-referral", authController.validateReferral);
router.post("/verify-pin", pinVerifyLimiter, validate(schemas.verifyPinSchema), authController.verifyPin);
router.post("/register", strictAuthLimiter, validate(schemas.registerSchema), authController.register);
router.post("/login", strictAuthLimiter, validate(schemas.loginSchema), authController.login);
router.post("/admin/login", strictAuthLimiter, validate(schemas.adminLoginSchema), authController.adminLogin);

module.exports = router;
