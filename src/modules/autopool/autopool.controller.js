const autopoolService = require("./autopool.service");

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

module.exports = {
  getAutoPoolTree,
  getAutoPoolExplorer
};
