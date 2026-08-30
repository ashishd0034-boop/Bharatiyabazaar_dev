const authService = require("./auth.service");

async function validateReferral(req, res, next) {
  try {
    const { code } = req.query;
    const data = await authService.validateReferralCode(code);
    res.json({
      success: true,
      data
    });
  } catch (err) {
    if (err.status === 400 || err.status === 404) {
      return res.status(err.status).json({
        success: false,
        error: { code: err.code || "BAD_REQUEST", message: err.message }
      });
    }
    next(err);
  }
}

async function register(req, res, next) {
  try {
    const result = await authService.registerMember(req.body);
    res.status(201).json({
      success: true,
      data: result
    });
  } catch (err) {
    if (err.code === "CONFLICT" || err.status === 409) {
      return res.status(409).json({
        success: false,
        error: { code: "CONFLICT", message: err.message }
      });
    }
    if (err.status === 400 || err.code === "INVALID_PIN" || err.code === "PIN_NOT_AVAILABLE" || err.code === "PIN_ALREADY_REDEEMED" || err.code === "PIN_QTY_MISMATCH" || err.code === "PIN_REQUIRED" || err.code === "BAD_REQUEST") {
      return res.status(400).json({
        success: false,
        error: { code: err.code || "BAD_REQUEST", message: err.message }
      });
    }
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { mobile, password } = req.body;
    const result = await authService.authenticateMember(mobile, password);
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    if (err.status === 401 || err.code === "UNAUTHORIZED") {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: err.message }
      });
    }
    next(err);
  }
}

async function adminLogin(req, res, next) {
  try {
    const { email, password } = req.body;
    const result = await authService.authenticateAdmin(email, password);
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    if (err.status === 401 || err.code === "UNAUTHORIZED") {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: err.message }
      });
    }
    next(err);
  }
}

async function verifyPin(req, res, next) {
  try {
    const { pinCode } = req.body;
    const pin = await authService.verifyPin(pinCode);
    res.json({
      success: true,
      message: `PIN ${pin.pinCode} is valid for ${pin.quantity} ID(s).`,
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

module.exports = {
  validateReferral,
  register,
  login,
  adminLogin,
  verifyPin
};
