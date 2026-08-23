const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");

const JWT_SECRET = process.env.JWT_SECRET;

function requireAdmin(roles = ["SUPPORT", "ADMIN", "SUPER_ADMIN"]) {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Missing or invalid authorization header" } });
    }

    const token = authHeader.split(" ")[1];

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      
      const admin = await prisma.adminUser.findUnique({ where: { id: decoded.id } });
      if (!admin) {
        return res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Admin not found" } });
      }

      if (!roles.includes(admin.role)) {
        return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Insufficient permissions" } });
      }
      
      req.admin = admin;
      next();
    } catch (err) {
      return res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Invalid or expired token" } });
    }
  };
}

module.exports = requireAdmin;
