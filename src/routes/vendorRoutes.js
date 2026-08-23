const express = require("express");
const vendorController = require("../controllers/vendorController");
const authMiddleware = require("../middleware/authMiddleware");
const vendorAuthMiddleware = require("../middleware/vendorAuthMiddleware");
const validate = require("../middleware/validateMiddleware");
const schemas = require("../validations/schemas");

const router = express.Router();

// Public vendor login endpoint
router.post("/login", validate(schemas.loginSchema), vendorController.login);

// Vendor endpoints (accepts member token if vendor, or dedicated vendor token)
router.post("/sale", authMiddleware, validate(schemas.vendorSaleSchema), vendorController.recordSale);
router.get("/settlements", authMiddleware, vendorController.getSettlements);

module.exports = router;
