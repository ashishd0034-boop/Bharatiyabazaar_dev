const express = require("express");
const adminController = require("../controllers/adminController");
const adminAuthMiddleware = require("../middleware/adminAuthMiddleware");
const validate = require("../middleware/validateMiddleware");
const schemas = require("../validations/schemas");

const router = express.Router();

// Require admin authentication for all routes
router.use(adminAuthMiddleware(["SUPER_ADMIN", "ADMIN", "SUPPORT"]));

router.get("/settings", adminController.getAllSettings);
router.put("/settings/:key", adminAuthMiddleware(["SUPER_ADMIN"]), validate(schemas.settingUpdateSchema), adminController.updateSettingValue);

router.post("/withdrawals/:id/approve", adminAuthMiddleware(["SUPER_ADMIN", "ADMIN"]), adminController.approveWithdrawalReq);
router.post("/withdrawals/:id/reject", adminAuthMiddleware(["SUPER_ADMIN", "ADMIN"]), adminController.rejectWithdrawalReq);

router.post("/settlements/run", adminAuthMiddleware(["SUPER_ADMIN"]), adminController.runSettlement);

router.get("/audit-logs", adminAuthMiddleware(["SUPER_ADMIN"]), adminController.getLogs);

module.exports = router;
