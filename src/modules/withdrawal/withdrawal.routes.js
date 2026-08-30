const express = require("express");
const withdrawalController = require("./withdrawal.controller");
const authMiddleware = require("../../core/middleware/auth.middleware");
const adminAuthMiddleware = require("../../core/middleware/admin-auth.middleware");
const optionalAuthMiddleware = require("../../core/middleware/optional-auth.middleware");
const validate = require("../../core/middleware/validate.middleware");
const { withdrawalRequestSchema } = require("./withdrawal.schemas");

const router = express.Router();

// Member Endpoints
router.post("/request", authMiddleware, validate(withdrawalRequestSchema), withdrawalController.request);
router.get("/history", authMiddleware, withdrawalController.getHistory);
router.get("/tds-preview", optionalAuthMiddleware, withdrawalController.getTdsPreview);

// Admin Approval & Rejection Endpoints
router.post("/:id/complete", adminAuthMiddleware(["SUPER_ADMIN", "ADMIN"]), withdrawalController.complete);
router.post("/:id/approve", adminAuthMiddleware(["SUPER_ADMIN", "ADMIN"]), withdrawalController.complete);
router.post("/:id/reject", adminAuthMiddleware(["SUPER_ADMIN", "ADMIN"]), withdrawalController.reject);

module.exports = router;
