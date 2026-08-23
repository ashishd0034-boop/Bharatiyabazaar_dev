const express = require("express");
const memberController = require("../controllers/memberController");
const authMiddleware = require("../middleware/authMiddleware");
const validate = require("../middleware/validateMiddleware");
const schemas = require("../validations/schemas");

const router = express.Router();

router.use(authMiddleware);

// 👇 THIS WAS MISSING! Added it back.
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
