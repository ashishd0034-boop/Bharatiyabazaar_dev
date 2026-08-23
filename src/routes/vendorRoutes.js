const express = require("express");
const vendorController = require("../controllers/vendorController");
const authMiddleware = require("../middleware/authMiddleware");
const validate = require("../middleware/validateMiddleware");
const schemas = require("../validations/schemas");

const router = express.Router();

// Public vendor login endpoint
router.post("/login", validate(schemas.loginSchema), vendorController.login);

// Vendor endpoints (accepts member token if vendor, or dedicated vendor token)
router.post("/sale", authMiddleware, validate(schemas.vendorSaleSchema), vendorController.recordSale);
router.get("/settlements", authMiddleware, vendorController.getSettlements);
router.post("/settlement/early", authMiddleware, vendorController.requestEarlySettlement);

module.exports = router;
