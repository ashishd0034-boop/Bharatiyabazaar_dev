const express = require("express");
const walletController = require("../controllers/walletController");
const withdrawalController = require("../controllers/withdrawalController");
const authMiddleware = require("../middleware/authMiddleware");
const adminAuthMiddleware = require("../middleware/adminAuthMiddleware");
const validate = require("../middleware/validateMiddleware");
const schemas = require("../validations/schemas");

const router = express.Router();

// Member Wallet Endpoints
router.get("/balance", authMiddleware, walletController.getBalance);
router.get("/ledger", authMiddleware, walletController.getLedger);
router.get("/commissions", authMiddleware, walletController.getCommissions);
router.post("/withdraw", authMiddleware, validate(schemas.withdrawalRequestSchema), withdrawalController.request);
router.get("/withdrawals", authMiddleware, withdrawalController.getHistory);
router.get("/withdraw/preview", authMiddleware, withdrawalController.getTdsPreview);

// Admin Approval & Rejection on Wallet Route
router.post("/withdraw/complete", adminAuthMiddleware(["SUPER_ADMIN", "ADMIN"]), withdrawalController.complete);
router.post("/withdraw/reject", adminAuthMiddleware(["SUPER_ADMIN", "ADMIN"]), withdrawalController.reject);

module.exports = router;
