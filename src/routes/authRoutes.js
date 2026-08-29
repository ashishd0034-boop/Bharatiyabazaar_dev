const express = require("express");
const authController = require("../controllers/authController");
const validate = require("../middleware/validateMiddleware");
const schemas = require("../validations/schemas");
const rateLimit = require("express-rate-limit");

const router = express.Router();

const strictAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === "test" ? 100 : 5, // Strict 5 in prod/dev; permits test suite runs
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: "TOO_MANY_REQUESTS", message: "Too many attempts, please try again later." } }
});

router.get("/validate-referral", authController.validateReferral);
router.post("/register", strictAuthLimiter, validate(schemas.registerSchema), authController.register);
router.post("/login", strictAuthLimiter, validate(schemas.loginSchema), authController.login);
router.post("/admin/login", strictAuthLimiter, validate(schemas.adminLoginSchema), authController.adminLogin);

module.exports = router;
