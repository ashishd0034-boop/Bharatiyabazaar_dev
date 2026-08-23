const express = require("express");
const vendorController = require("../controllers/vendorController");
const vendorAuthMiddleware = require("../middleware/vendorAuthMiddleware");
const validate = require("../middleware/validateMiddleware");
const schemas = require("../validations/schemas");

const router = express.Router();

// Public vendor registration & login
router.post("/register", validate(schemas.vendorRegisterSchema), vendorController.register);
router.post("/login", validate(schemas.loginSchema), vendorController.login);

// Protected vendor routes (strictly vendorAuthMiddleware asserting token.type === 'VENDOR')
router.get("/me", vendorAuthMiddleware, vendorController.getProfile);
router.post("/sale", vendorAuthMiddleware, validate(schemas.vendorSaleSchema), vendorController.recordSale);
router.get("/settlements", vendorAuthMiddleware, vendorController.getSettlements);
router.post("/settlement/early", vendorAuthMiddleware, vendorController.requestEarlySettlement);

module.exports = router;
