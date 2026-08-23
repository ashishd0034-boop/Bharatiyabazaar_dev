const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");

const JWT_SECRET = process.env.JWT_SECRET;

async function validateReferral(req, res, next) {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ success: false, error: { message: "Code required" } });

    const sponsor = await prisma.member.findUnique({ where: { memberCode: code } });
    if (!sponsor) {
      return res.status(404).json({ success: false, error: { message: "Sponsor not found" } });
    }

    res.json({
      success: true,
      data: { name: sponsor.name, memberCode: sponsor.memberCode, valid: true }
    });
  } catch (err) {
    next(err);
  }
}

async function register(req, res, next) {
  try {
    const { name, mobile, email, address, pinCode, password, referralCode, side } = req.body;

    const existingMember = await prisma.member.findUnique({ where: { mobile } });
    if (existingMember) {
      return res.status(409).json({ success: false, error: { code: "CONFLICT", message: "Mobile number already registered" } });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const { createMember } = require("../services/memberService");
    
    const member = await createMember({
      name, mobile, email, address, pinCode, kycStatus: "PENDING"
    });

    await prisma.member.update({
      where: { id: member.id },
      data: { passwordHash }
    });

    // === NEW: Trigger ID Card Creation & Tree Placement ===
    const { purchaseIds } = require("../services/idCardService");
    let sponsorIdCardId = null;

    if (referralCode) {
      const sponsor = await prisma.member.findUnique({ where: { memberCode: referralCode } });
      if (sponsor) {
        // Find sponsor's MAIN ID card to place the new member under them
        const sponsorMainCard = await prisma.memberIdCard.findFirst({
          where: { memberId: sponsor.id, type: "MAIN" }
        });
        if (sponsorMainCard) sponsorIdCardId = sponsorMainCard.id;
      }
    }

    const sponsorSide = (side === "LEFT" || side === "RIGHT") ? side : "LEFT"; // Default to LEFT
    const newCards = await purchaseIds(member.id, 1, sponsorIdCardId, sponsorSide);
    // =====================================================

    // Re-fetch member to get the permanent memberCode (matches MAIN cardNumber)
    const freshMember = await prisma.member.findUnique({
      where: { id: member.id },
      include: { idCards: true }
    });

    const mainCard = freshMember.idCards.find(c => c.type === "MAIN") || freshMember.idCards[0];
    const loginCardNumber = mainCard ? mainCard.cardNumber : freshMember.memberCode;

    const token = jwt.sign({
      id: freshMember.id,
      type: "MEMBER",
      loginCardId: mainCard?.id,
      loginCardNumber,
      loginCardType: "MAIN",
      isSubCard: false,
      ownerMemberCode: freshMember.memberCode
    }, JWT_SECRET, { expiresIn: "7d" });

    res.status(201).json({
      success: true,
      data: {
        member: { id: freshMember.id, memberCode: freshMember.memberCode, name: freshMember.name, mobile: freshMember.mobile },
        token,
        loginContext: {
          loginCardId: mainCard?.id,
          cardNumber: loginCardNumber,
          cardType: "MAIN",
          isSubCard: false,
          ownerMemberCode: freshMember.memberCode
        }
      }
    });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { mobile, password } = req.body;
    const input = (mobile || "").trim();

    // 1. Search where mobile matches, memberCode matches, OR any owned card's cardNumber matches
    const member = await prisma.member.findFirst({
      where: {
        OR: [
          { mobile: input },
          { memberCode: input },
          { idCards: { some: { cardNumber: input } } }
        ]
      },
      include: {
        idCards: true
      }
    });

    if (!member || !member.passwordHash) {
      return res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Invalid credentials" } });
    }

    const validPassword = await bcrypt.compare(password, member.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Invalid credentials" } });
    }

    // 2. Identify the specific card used to login
    const matchedCard = member.idCards.find(c => c.cardNumber.toUpperCase() === input.toUpperCase());
    const mainCard = member.idCards.find(c => c.type === "MAIN") || member.idCards[0];

    const activeLoginCard = matchedCard || mainCard;
    const loginCardNumber = activeLoginCard ? activeLoginCard.cardNumber : member.memberCode;
    const loginCardType = activeLoginCard ? activeLoginCard.type : "MAIN";
    const loginCardId = activeLoginCard ? activeLoginCard.id : null;

    // 3. Issue JWT with Login Context
    const token = jwt.sign({
      id: member.id,
      type: "MEMBER",
      loginCardId,
      loginCardNumber,
      loginCardType
    }, JWT_SECRET, { expiresIn: "7d" });

    res.json({
      success: true,
      data: {
        member: { id: member.id, memberCode: member.memberCode, name: member.name, mobile: member.mobile },
        loginContext: {
          cardNumber: loginCardNumber,
          cardType: loginCardType,
          isSubCard: loginCardType !== "MAIN",
          ownerMemberCode: member.memberCode
        },
        token
      }
    });
  } catch (err) {
    next(err);
  }
}

async function adminLogin(req, res, next) {
  try {
    const { email, password } = req.body;

    const admin = await prisma.adminUser.findUnique({ where: { email } });
    if (!admin || !admin.passwordHash) {
      return res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Invalid credentials" } });
    }

    const validPassword = await bcrypt.compare(password, admin.passwordHash);
    if (!validPassword && password !== admin.passwordHash) {
      // Temporary fallback for seeded unhashed passwords like "hashed_password"
      return res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Invalid credentials" } });
    }

    const token = jwt.sign({ id: admin.id, type: "ADMIN", role: admin.role }, JWT_SECRET, { expiresIn: "1d" });

    res.json({
      success: true,
      data: {
        admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
        token
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  register,
  login,
  adminLogin,
  validateReferral // NEW
};
