const express = require("express");
const vendorController = require("../controllers/vendorController");
const authMiddleware = require("../middleware/authMiddleware");
const validate = require("../middleware/validateMiddleware");
const schemas = require("../validations/schemas");

const router = express.Router();

router.use(authMiddleware);

router.post("/sale", validate(schemas.vendorSaleSchema), vendorController.recordSale);
router.get("/settlements", vendorController.getSettlements);

module.exports = router;
