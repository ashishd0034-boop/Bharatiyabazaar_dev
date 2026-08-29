const express = require("express");
const setuKoshController = require("../controllers/setuKoshController");
const authMiddleware = require("../middleware/authMiddleware");
const vendorAuthMiddleware = require("../middleware/vendorAuthMiddleware");

const router = express.Router();

// Restrict purchase recording strictly to authenticated vendors
router.post("/purchase", vendorAuthMiddleware, setuKoshController.purchase);

// Member endpoints
router.get("/counter", authMiddleware, setuKoshController.getCounter);
router.get("/tree", authMiddleware, setuKoshController.getTree);

module.exports = router;
