const jwt = require("jsonwebtoken");
const prisma = require("../database/prisma");

if (!process.env.JWT_SECRET) {
  throw new Error("FATAL ERROR: JWT_SECRET is not defined.");
}
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Optional Authentication Middleware.
 * If a valid Bearer token is provided, attaches req.member and req.loginContext.
 * If no token is provided, allows request to proceed with req.member = null (for guest mode previews).
 */
async function optionalAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    req.member = null;
    req.loginContext = null;
    return next();
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });

    // Cross-auth protection: Reject VENDOR or ADMIN tokens when authenticating as member
    if (decoded.type === "VENDOR" || decoded.type === "ADMIN") {
      req.member = null;
      req.loginContext = null;
      return next();
    }

    const member = await prisma.member.findUnique({ where: { id: decoded.id } });
    if (member && member.status !== "BLOCKED") {
      req.member = member;
      req.loginContext = {
        loginCardId: decoded.loginCardId || null,
        cardNumber: decoded.loginCardNumber || member.memberCode,
        cardType: decoded.loginCardType || "MAIN",
        isSubCard: decoded.loginCardType ? decoded.loginCardType !== "MAIN" : false,
        ownerMemberCode: member.memberCode
      };
    } else {
      req.member = null;
      req.loginContext = null;
    }
  } catch (err) {
    // If token invalid, proceed as guest
    req.member = null;
    req.loginContext = null;
  }

  next();
}

module.exports = optionalAuthMiddleware;
