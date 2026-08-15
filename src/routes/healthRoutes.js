const express = require("express");
const healthController = require("../controllers/healthController");

const router = express.Router();

router.get("/", healthController.checkHealth);
router.get("/db", healthController.checkDbHealth);

module.exports = router;
