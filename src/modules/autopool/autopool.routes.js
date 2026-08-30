const express = require("express");
const autopoolController = require("./autopool.controller");
const authMiddleware = require("../../core/middleware/auth.middleware");

const router = express.Router();

router.use(authMiddleware);

router.get("/autopool-tree", autopoolController.getAutoPoolTree);
router.get("/autopool-explorer", autopoolController.getAutoPoolExplorer);

module.exports = router;
