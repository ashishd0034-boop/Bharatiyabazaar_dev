const jwt = require("jsonwebtoken");
const prisma = require("../database/prisma");

if (!process.env.JWT_SECRET) {
  throw new Error("FATAL ERROR: JWT_SECRET is not defined.");
}
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Dedicated Admin Authentication Middleware.
 * Enforces decoded.type === "ADMIN" and minimum ADMIN or SUPER_ADMIN role (no SUPPORT).
 */
function requireAdmin(roles = ["ADMIN", "SUPER_ADMIN"]) {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Missing or invalid authorization header" }
      });
    }

    const token = authHeader.split(" ")[1];

    try {
      const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });

      // Strict token type assertion: Must be an ADMIN token
      if (decoded.type !== "ADMIN") {
        return res.status(401).json({
          success: false,
          error: { code: "UNAUTHORIZED", message: "Invalid token type: Admin authentication required" }
        });
      }

      const admin = await prisma.adminUser.findUnique({ where: { id: decoded.id } });
      if (!admin || admin.status !== "ACTIVE") {
        return res.status(401).json({
          success: false,
          error: { code: "UNAUTHORIZED", message: "Admin account not found or inactive" }
        });
      }

      if (!roles.includes(admin.role)) {
        return res.status(403).json({
          success: false,
          error: { code: "FORBIDDEN", message: `Insufficient permissions: Requires ${roles.join(" or ")}` }
        });
      }

      req.admin = admin;
      next();
    } catch (err) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid or expired admin token" }
      });
    }
  };
}

module.exports = requireAdmin;
