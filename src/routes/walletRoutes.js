const express = require("express");
const walletController = require("../controllers/walletController");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authMiddleware);

router.get("/balance", walletController.getBalance);
router.get("/ledger", walletController.getLedger);
router.get("/commissions", walletController.getCommissions);

module.exports = router;
