const express = require("express");
const adminController = require("../controllers/adminController");
const adminAuthMiddleware = require("../middleware/adminAuthMiddleware");
const validate = require("../middleware/validateMiddleware");
const schemas = require("../validations/schemas");

const router = express.Router();
const authController = require("../controllers/authController");

// Public admin login endpoint
router.post("/login", validate(schemas.adminLoginSchema), authController.adminLogin);

// Dashboard Summary (ADMIN & SUPER_ADMIN)
router.get("/dashboard-stats", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.getDashboardStats);

// Settings Endpoints
router.get("/settings", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.listSettings);
router.get("/settings/:key", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.getSingleSetting);
router.put("/settings/:key", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.updateSettingValue);
router.put("/categories/:category/margin", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.updateCategoryMarginReq);

// Operational & Reports Endpoints (ADMIN & SUPER_ADMIN)
router.get("/reports/reconciliation", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.getReconciliationReport);
router.get("/reports/withdrawals", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.getPendingWithdrawalsReport);
router.get("/reports/tds-summary", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.getTdsSummaryReport);
router.get("/reports/settlements", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.getSettlementsReport);

router.post("/withdrawals/:id/approve", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.approveWithdrawalReq);
router.post("/withdrawals/:id/reject", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.rejectWithdrawalReq);

router.post("/settlements/run", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.runSettlement);
router.post("/vendors/:id/penalize", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.penalizeVendorReq);
router.post("/vendors/:id/freeze", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.freezeVendorReq);

// PIN Management Endpoints (ADMIN & SUPER_ADMIN)
router.get("/pins", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.listPinsReq);
router.post("/pins/revoke/:id", adminAuthMiddleware(["ADMIN", "SUPER_ADMIN"]), adminController.revokePinReq);

// SUPER_ADMIN Exclusives: Audit Logs & Admin User Management
router.get("/audit-logs", adminAuthMiddleware(["SUPER_ADMIN"]), adminController.getLogs);
router.get("/users", adminAuthMiddleware(["SUPER_ADMIN"]), adminController.listAdminUsers);
router.post("/users", adminAuthMiddleware(["SUPER_ADMIN"]), adminController.createAdminUser);
router.put("/users/:id/role", adminAuthMiddleware(["SUPER_ADMIN"]), adminController.updateAdminUserRole);

module.exports = router;
