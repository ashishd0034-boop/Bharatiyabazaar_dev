const mySystemService = require("./my-system.service");

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

module.exports = {
  getMySystemTree,
  getMyPlacement,
  getMyReferralCount
};
