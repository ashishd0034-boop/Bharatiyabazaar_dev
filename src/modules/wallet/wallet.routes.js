const express = require("express");
const walletController = require("./wallet.controller");
const withdrawalController = require("../../controllers/withdrawalController");
const authMiddleware = require("../../core/middleware/auth.middleware");
const adminAuthMiddleware = require("../../core/middleware/admin-auth.middleware");
const validate = require("../../core/middleware/validate.middleware");
const schemas = require("../../validations/schemas");

const router = express.Router();

// Member Wallet Endpoints
router.get("/balance", authMiddleware, walletController.getBalance);
router.get("/summary", authMiddleware, walletController.getBalance);
router.get("/ledger", authMiddleware, walletController.getLedger);
router.get("/commissions", authMiddleware, walletController.getCommissions);
router.post("/withdraw", authMiddleware, validate(schemas.withdrawalRequestSchema), withdrawalController.request);
router.get("/withdrawals", authMiddleware, withdrawalController.getHistory);
router.get("/withdraw/preview", authMiddleware, withdrawalController.getTdsPreview);

// Admin Approval & Rejection on Wallet Route
router.post("/withdraw/complete", adminAuthMiddleware(["SUPER_ADMIN", "ADMIN"]), withdrawalController.complete);
router.post("/withdraw/reject", adminAuthMiddleware(["SUPER_ADMIN", "ADMIN"]), withdrawalController.reject);

module.exports = router;
