const express = require("express");
const setuKoshController = require("../controllers/setuKoshController");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authMiddleware);

router.post("/purchase", setuKoshController.purchase);
router.get("/counter", setuKoshController.getCounter);
router.get("/tree", setuKoshController.getTree);

module.exports = router;
