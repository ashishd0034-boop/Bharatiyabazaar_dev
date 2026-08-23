const express = require("express");
const withdrawalController = require("../controllers/withdrawalController");
const authMiddleware = require("../middleware/authMiddleware");
const adminAuthMiddleware = require("../middleware/adminAuthMiddleware");
const validate = require("../middleware/validateMiddleware");
const schemas = require("../validations/schemas");

const optionalAuthMiddleware = require("../middleware/optionalAuthMiddleware");

const router = express.Router();

// Member Endpoints
router.post("/request", authMiddleware, validate(schemas.withdrawalRequestSchema), withdrawalController.request);
router.get("/history", authMiddleware, withdrawalController.getHistory);
router.get("/tds-preview", optionalAuthMiddleware, withdrawalController.getTdsPreview);

// Admin Approval & Rejection Endpoints
router.post("/:id/complete", adminAuthMiddleware(["SUPER_ADMIN", "ADMIN"]), withdrawalController.complete);
router.post("/:id/approve", adminAuthMiddleware(["SUPER_ADMIN", "ADMIN"]), withdrawalController.complete);
router.post("/:id/reject", adminAuthMiddleware(["SUPER_ADMIN", "ADMIN"]), withdrawalController.reject);

module.exports = router;
