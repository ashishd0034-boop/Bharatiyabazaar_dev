const express = require("express");
const memberController = require("./member.controller");
const authMiddleware = require("../../core/middleware/auth.middleware");
const validate = require("../../core/middleware/validate.middleware");
const schemas = require("./member.schemas");

const router = express.Router();

router.use(authMiddleware);

router.get("/profile", memberController.getProfile);
router.get("/autopool-tree", memberController.getAutoPoolTree);
router.get("/autopool-explorer", memberController.getAutoPoolExplorer);
router.get("/my-system-tree", memberController.getMySystemTree);
router.put("/kyc", validate(schemas.kycSchema), memberController.updateKyc);
router.get("/check-availability", memberController.checkAvailability);
router.get("/my-placement", memberController.getMyPlacement);
router.get("/my-referrals", memberController.getMyReferralCount);
router.get("/my-referral-count", memberController.getMyReferralCount);
router.get("/notifications", memberController.getNotifications);

module.exports = router;
