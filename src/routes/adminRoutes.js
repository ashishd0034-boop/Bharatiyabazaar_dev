const express = require("express");
const adminController = require("../controllers/adminController");
const adminAuthMiddleware = require("../middleware/adminAuthMiddleware");
const validate = require("../middleware/validateMiddleware");
const schemas = require("../validations/schemas");

const { createRateLimiter } = require("../core/utils/rateLimiter");

const router = express.Router();
const authController = require("../controllers/authController");

const adminLoginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  prodMax: 5,
  message: "Too many admin login attempts, please try again later."
});

// Public admin login endpoint (strictly rate limited)
router.post("/login", adminLoginLimiter, validate(schemas.adminLoginSchema), authController.adminLogin);

// Dashboard Summary (ADMIN & SUPER_ADMIN)
router.get("/dashboard-stats", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.getDashboardStats);

// Settings Endpoints
router.get("/settings", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.listSettings);
router.get("/settings/:key", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.getSingleSetting);
router.put("/settings/:key", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.updateSettingValue);
router.put("/categories/:category/margin", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.updateCategoryMarginReq);

const reconciliationLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  prodMax: 20,
  message: "Too many reconciliation report requests, please try again later."
});

// Operational & Reports Endpoints
router.get("/reports/reconciliation", reconciliationLimiter, adminAuthMiddleware(["SUPER_ADMIN"]), adminController.getReconciliationReport);
router.get("/reports/withdrawals", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.getPendingWithdrawalsReport);
router.get("/reports/tds-summary", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.getTdsSummaryReport);
router.get("/reports/settlements", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.getSettlementsReport);

router.post("/withdrawals/:id/approve", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.approveWithdrawalReq);
router.post("/withdrawals/:id/reject", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.rejectWithdrawalReq);

router.post("/settlements/run", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.runSettlement);
router.post("/vendors/:id/penalize", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.penalizeVendorReq);
router.post("/vendors/:id/freeze", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.freezeVendorReq);

const adminPinGenLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  prodMax: 10,
  message: "Too many PIN generation requests, please try again later."
});

// PIN Management Endpoints (ADMIN & SUPER_ADMIN)
router.get("/pins", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.listPinsReq);
router.post("/pins/generate", adminPinGenLimiter, adminAuthMiddleware(["SUPER_ADMIN"]), validate(schemas.adminGeneratePinSchema), adminController.generateAdminPinsReq);
router.post("/pins/revoke/:id", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.revokePinReq);

// Member & Vendor Management (ADMIN & SUPER_ADMIN)
router.get("/members", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.listMembersReq);
router.post("/members/:id/reset-password", adminPinGenLimiter, adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.resetMemberPasswordReq);
router.get("/vendors", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.listVendorsReq);

// KYC & Compliance (ADMIN & SUPER_ADMIN)
router.get("/kyc", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.listKycReq);
router.post("/kyc/:id/verify", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.verifyKycReq);

// Broadcast & Notifications (ADMIN & SUPER_ADMIN)
router.post("/broadcast", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.broadcastNotificationReq);

// Live MLM Tree Visualizers (ADMIN & SUPER_ADMIN)
router.get("/autopool/tree", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.getAutoPoolTreeReq);

// SUPER_ADMIN Exclusives: Audit Logs & Admin User Management
router.get("/audit-logs", adminAuthMiddleware(["SUPER_ADMIN"]), adminController.getLogs);
router.get("/users", adminAuthMiddleware(["SUPER_ADMIN"]), adminController.listAdminUsers);
router.post("/users", adminAuthMiddleware(["SUPER_ADMIN"]), adminController.createAdminUser);
router.put("/users/:id/role", adminAuthMiddleware(["SUPER_ADMIN"]), adminController.updateAdminUserRole);

module.exports = router;
