const prisma = require("../lib/prisma");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

async function vendorAuthMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Authentication token required" }
      });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    // Verify vendor exists
    const vendor = await prisma.vendor.findFirst({
      where: {
        OR: [
          { id: decoded.vendorId || "" },
          { memberId: decoded.id }
        ]
      },
      include: { member: true }
    });

    if (!vendor) {
      return res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: "Vendor account not found or access denied" }
      });
    }

    req.vendor = vendor;
    req.member = vendor.member;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Invalid or expired token" }
    });
  }
}

module.exports = vendorAuthMiddleware;
