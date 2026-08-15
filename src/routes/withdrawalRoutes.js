const express = require("express");
const withdrawalController = require("../controllers/withdrawalController");
const authMiddleware = require("../middleware/authMiddleware");
const validate = require("../middleware/validateMiddleware");
const schemas = require("../validations/schemas");

const router = express.Router();

router.use(authMiddleware);

router.post("/request", validate(schemas.withdrawalRequestSchema), withdrawalController.request);
router.get("/history", withdrawalController.getHistory);
router.get("/tds-preview", withdrawalController.getTdsPreview);

module.exports = router;
