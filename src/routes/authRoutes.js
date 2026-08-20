const express = require("express");
const authController = require("../controllers/authController");
const validate = require("../middleware/validateMiddleware");
const schemas = require("../validations/schemas");
const rateLimit = require("express-rate-limit");

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  message: { success: false, error: { code: "TOO_MANY_REQUESTS", message: "Too many login attempts" } }
});

router.get("/validate-referral", authController.validateReferral); // Add this line
router.post("/register", validate(schemas.registerSchema), authController.register);
router.post("/login", authLimiter, validate(schemas.loginSchema), authController.login);
router.post("/admin/login", authLimiter, validate(schemas.adminLoginSchema), authController.adminLogin);

module.exports = router;
