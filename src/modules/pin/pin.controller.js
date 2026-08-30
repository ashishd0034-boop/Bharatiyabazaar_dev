const pinService = require("./pin.service");

async function purchase(req, res, next) {
  try {
    const { quantity } = req.body;
    const memberId = req.member.id;

    const pin = await pinService.generatePin(memberId, quantity);

    res.status(201).json({
      success: true,
      message: `Successfully purchased activation PIN for ${pin.quantity} ID(s).`,
      data: pin
    });
  } catch (err) {
    if (err.message && err.message.includes("Insufficient funds")) {
      return res.status(400).json({
        success: false,
        error: { code: "INSUFFICIENT_FUNDS", message: err.message }
      });
    }
    if (err.code === "INVALID_QUANTITY" || err.status === 400) {
      return res.status(400).json({
        success: false,
        error: { code: err.code || "BAD_REQUEST", message: err.message }
      });
    }
    next(err);
  }
}

async function validate(req, res, next) {
  try {
    const { pinCode } = req.body;
    const pin = await pinService.validatePin(pinCode);

    res.json({
      success: true,
      data: pin
    });
  } catch (err) {
    if (err.status === 400 || err.code === "INVALID_PIN" || err.code === "PIN_NOT_AVAILABLE" || err.code === "PIN_REQUIRED") {
      return res.status(400).json({
        success: false,
        error: { code: err.code || "BAD_REQUEST", message: err.message }
      });
    }
    next(err);
  }
}

async function getMyPins(req, res, next) {
  try {
    const memberId = req.member.id;
    const pins = await pinService.listPins({ purchasedByMemberId: memberId });

    res.json({
      success: true,
      data: pins
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  purchase,
  validate,
  getMyPins
};
