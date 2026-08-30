const memberService = require("./member.service");
const mySystemService = require("../my-system/my-system.service");
const autopoolService = require("../autopool/autopool.service");

async function getProfile(req, res, next) {
  try {
    const data = await memberService.getMemberProfile(req.member.id, req.loginContext);
    res.json({
      success: true,
      data
    });
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: err.message } });
    }
    next(err);
  }
}

async function updateKyc(req, res, next) {
  try {
    const data = await memberService.submitKyc(req.member.id, req.body);
    res.json({
      success: true,
      data
    });
  } catch (err) {
    next(err);
  }
}

async function getMySystemTree(req, res, next) {
  try {
    const result = await mySystemService.getGenealogyTree(req.member.id, req.loginContext);
    if (result.isRebirth) {
      return res.json({
        success: true,
        data: null,
        isRebirth: true,
        message: result.message
      });
    }
    if (!result.tree) {
      return res.json({ success: true, data: null });
    }
    res.json({
      success: true,
      data: {
        tree: result.tree,
        stats: result.stats
      }
    });
  } catch (err) {
    next(err);
  }
}

async function getAutoPoolTree(req, res, next) {
  try {
    const data = await autopoolService.getAutoPoolTree(req.member.id, req.loginContext);
    res.json({
      success: true,
      data
    });
  } catch (err) {
    next(err);
  }
}

async function checkAvailability(req, res, next) {
  try {
    const result = await memberService.checkAvailability(req.query);
    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function getMyPlacement(req, res, next) {
  try {
    const result = await mySystemService.getMyPlacement(req.member.id, req.loginContext);
    if (result && result.isRebirth) {
      return res.json({ success: true, data: null, message: result.message });
    }
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

async function getMyReferralCount(req, res, next) {
  try {
    const data = await mySystemService.getDirectReferralCounts(req.member.id, req.loginContext);
    res.json({
      success: true,
      data
    });
  } catch (err) {
    next(err);
  }
}

async function getAutoPoolExplorer(req, res, next) {
  try {
    const { root, depth = 7 } = req.query;
    const data = await autopoolService.getAutoPoolExplorer(root, depth, req.member.id, req.loginContext);
    res.json({
      success: true,
      data
    });
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: err.message }
      });
    }
    next(err);
  }
}

async function getNotifications(req, res, next) {
  try {
    const data = await memberService.getMemberNotificationFeed(req.member.id);
    res.json({
      success: true,
      data
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getProfile,
  updateKyc,
  checkAvailability,
  getMySystemTree,
  getAutoPoolTree,
  getMyPlacement,
  getMyReferralCount,
  getAutoPoolExplorer,
  getNotifications
};
