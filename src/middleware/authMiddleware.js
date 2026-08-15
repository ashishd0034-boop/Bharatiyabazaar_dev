const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_dev";

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Missing or invalid authorization header" } });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Attach member to request
    const member = await prisma.member.findUnique({ where: { id: decoded.id } });
    if (!member) {
      return res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Member not found" } });
    }
    
    req.member = member;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Invalid or expired token" } });
  }
}

module.exports = authMiddleware;
