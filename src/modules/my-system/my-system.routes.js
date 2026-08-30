const express = require("express");
const mySystemController = require("./my-system.controller");
const authMiddleware = require("../../core/middleware/auth.middleware");

const router = express.Router();

router.use(authMiddleware);

router.get("/my-system-tree", mySystemController.getMySystemTree);
router.get("/my-placement", mySystemController.getMyPlacement);
router.get("/my-referrals", mySystemController.getMyReferralCount);
router.get("/my-referral-count", mySystemController.getMyReferralCount);

module.exports = router;
