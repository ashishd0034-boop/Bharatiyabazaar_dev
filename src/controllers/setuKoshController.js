const { recordPurchase, getMemberCounter, getSetuKoshTree } = require("../services/setuKoshService");

async function purchase(req, res, next) {
  try {
    const { amountPaise, memberId, buyerCode, cardNumber, memberCode, idCardId, idempotencyKey } = req.body;
    const vendor = req.vendor;

    if (!vendor) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Vendor authentication required" }
      });
    }

    const targetMemberId = memberId;
    if (!targetMemberId || !amountPaise || parseInt(amountPaise) <= 0) {
      return res.status(400).json({
        success: false,
        error: { code: "BAD_REQUEST", message: "Valid memberId and positive amountPaise are required" }
      });
    }

    const result = await recordPurchase(targetMemberId, vendor.id, parseInt(amountPaise), {
      idCardId,
      idempotencyKey: idempotencyKey || req.headers["x-idempotency-key"] || null
    });

    res.status(201).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

async function getCounter(req, res, next) {
  try {
    const memberId = req.params.memberId || req.member.id;
    const counter = await getMemberCounter(memberId);
    res.json({
      success: true,
      data: counter
    });
  } catch (err) {
    next(err);
  }
}

async function getTree(req, res, next) {
  try {
    const { root = 1, depth = 10 } = req.query;
    const tree = await getSetuKoshTree(parseInt(root), parseInt(depth));
    if (!tree) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: `Setu Kosh node at position ${root} not found` }
      });
    }

    res.json({
      success: true,
      data: tree
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  purchase,
  getCounter,
  getTree
};
