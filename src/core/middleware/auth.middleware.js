const jwt = require("jsonwebtoken");
const prisma = require("../database/prisma");

if (!process.env.JWT_SECRET) {
  throw new Error("FATAL ERROR: JWT_SECRET is not defined.");
}
const JWT_SECRET = process.env.JWT_SECRET;

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Missing or invalid authorization header" } });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
    
    // Cross-auth protection: Reject VENDOR and ADMIN tokens on member endpoints
    if (decoded.type === "VENDOR" || decoded.type === "ADMIN") {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid token type: Member authentication required" }
      });
    }

    // Attach member to request
    const member = await prisma.member.findUnique({ where: { id: decoded.id } });
    if (!member) {
      return res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Member not found" } });
    }
    
    req.member = member;
    req.loginContext = {
      loginCardId: decoded.loginCardId || null,
      cardId: decoded.loginCardId || null,
      cardNumber: decoded.loginCardNumber || member.memberCode,
      loginCardNumber: decoded.loginCardNumber || member.memberCode,
      cardType: decoded.loginCardType || "MAIN",
      loginCardType: decoded.loginCardType || "MAIN",
      isSubCard: decoded.loginCardType ? decoded.loginCardType !== "MAIN" : false,
      ownerMemberCode: member.memberCode
    };
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Invalid or expired token" } });
  }
}

module.exports = authMiddleware;
