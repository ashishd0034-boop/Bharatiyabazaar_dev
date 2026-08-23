const express = require("express");
const adminController = require("../controllers/adminController");
const adminAuthMiddleware = require("../middleware/adminAuthMiddleware");
const validate = require("../middleware/validateMiddleware");
const schemas = require("../validations/schemas");

const router = express.Router();
const authController = require("../controllers/authController");

// Public admin login endpoint
router.post("/login", validate(schemas.adminLoginSchema), authController.adminLogin);

// Require admin authentication for all subsequent routes
router.use(adminAuthMiddleware(["SUPER_ADMIN", "ADMIN", "SUPPORT"]));

// Settings Endpoints
router.get("/settings", adminController.listSettings);
router.get("/settings/:key", adminController.getSingleSetting);
router.put("/settings/:key", adminAuthMiddleware(["SUPER_ADMIN", "ADMIN"]), adminController.updateSettingValue);
router.put("/categories/:category/margin", adminAuthMiddleware(["SUPER_ADMIN", "ADMIN"]), adminController.updateCategoryMarginReq);

// Operational Endpoints
router.post("/withdrawals/:id/approve", adminAuthMiddleware(["SUPER_ADMIN", "ADMIN"]), adminController.approveWithdrawalReq);
router.post("/withdrawals/:id/reject", adminAuthMiddleware(["SUPER_ADMIN", "ADMIN"]), adminController.rejectWithdrawalReq);

router.post("/settlements/run", adminAuthMiddleware(["SUPER_ADMIN", "ADMIN"]), adminController.runSettlement);
router.post("/vendors/:id/penalize", adminAuthMiddleware(["SUPER_ADMIN", "ADMIN"]), adminController.penalizeVendorReq);
router.post("/vendors/:id/freeze", adminAuthMiddleware(["SUPER_ADMIN", "ADMIN"]), adminController.freezeVendorReq);

router.get("/audit-logs", adminAuthMiddleware(["SUPER_ADMIN"]), adminController.getLogs);

module.exports = router;
