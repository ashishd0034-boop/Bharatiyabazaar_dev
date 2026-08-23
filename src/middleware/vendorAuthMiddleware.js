const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");

const JWT_SECRET = process.env.JWT_SECRET || "default_jwt_secret";

/**
 * Dedicated Vendor Authentication Middleware.
 * Enforces that decoded.type === "VENDOR" and attaches req.vendor and req.member.
 */
async function vendorAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Missing or invalid authorization header" }
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Enforce strictly VENDOR token type
    if (decoded.type !== "VENDOR" || !decoded.vendorId) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid token type: Vendor authentication required" }
      });
    }

    const vendor = await prisma.vendor.findUnique({
      where: { id: decoded.vendorId },
      include: {
        member: {
          include: {
            mainWallet: true
          }
        }
      }
    });

    if (!vendor) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Vendor account not found" }
      });
    }

    req.vendor = vendor;
    req.member = vendor.member;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Invalid or expired vendor token" }
    });
  }
}

module.exports = vendorAuthMiddleware;
