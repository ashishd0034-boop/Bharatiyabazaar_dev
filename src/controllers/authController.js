const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");

const JWT_SECRET = process.env.JWT_SECRET;

async function validateReferral(req, res, next) {
  try {
    const { code } = req.query;
    const cleanCode = (code || "").trim().toUpperCase();
    if (!cleanCode) return res.status(400).json({ success: false, error: { message: "Code required" } });

    const sponsor = await prisma.member.findFirst({
      where: {
        OR: [
          { memberCode: cleanCode },
          { idCards: { some: { cardNumber: cleanCode } } }
        ]
      },
      include: {
        idCards: true
      }
    });

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
    const { name, mobile, email, address, pinCode, password, referralCode, side, activationPin, pin } = req.body;

    const existingMember = await prisma.member.findUnique({ where: { mobile } });
    if (existingMember) {
      return res.status(409).json({ success: false, error: { code: "CONFLICT", message: "Mobile number already registered" } });
    }

    let sponsorIdCardId = null;

    if (referralCode && referralCode.trim()) {
      const cleanRef = referralCode.trim().toUpperCase();
      const sponsor = await prisma.member.findFirst({
        where: {
          OR: [
            { memberCode: cleanRef },
            { idCards: { some: { cardNumber: cleanRef } } }
          ]
        },
        include: {
          idCards: true
        }
      });

      if (!sponsor) {
        return res.status(400).json({ success: false, error: { code: "BAD_REQUEST", message: "Invalid sponsor code" } });
      }

      // Find sponsor's MAIN ID card to place the new member under them
      const sponsorMainCard = sponsor.idCards?.find(c => c.type === "MAIN") || sponsor.idCards?.[0];
      if (sponsorMainCard) sponsorIdCardId = sponsorMainCard.id;
    }

    // Determine activation PIN vs postal code
    let activationPinCode = null;
    if (typeof activationPin === "string" && activationPin.trim()) {
      activationPinCode = activationPin.trim().toUpperCase();
    } else if (typeof pin === "string" && pin.trim()) {
      activationPinCode = pin.trim().toUpperCase();
    } else if (typeof pinCode === "string" && pinCode.trim().toUpperCase().startsWith("PIN-")) {
      activationPinCode = pinCode.trim().toUpperCase();
    }

    // Enforce mandatory PIN requirement in dev/production
    if (!activationPinCode && process.env.NODE_ENV !== "test") {
      return res.status(400).json({
        success: false,
        error: {
          code: "PIN_REQUIRED",
          message: "Activation PIN is required for registration."
        }
      });
    }

    let postalPinCode = pinCode;
    if (typeof pinCode === "string" && pinCode.trim().toUpperCase().startsWith("PIN-")) {
      postalPinCode = req.body.postalCode || null;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { createMember } = require("../services/memberService");
    const { purchaseIds } = require("../services/idCardService");
    const pinService = require("../services/pinService");
    const sponsorSide = (side === "LEFT" || side === "RIGHT") ? side : "LEFT"; // Default to LEFT

    // Safeguard 3: Atomic Transaction covering Member creation, PIN redemption, and Tree placement
    const { freshMember, mainCard, newCards, qty } = await prisma.$transaction(async (tx) => {
      // 1. Create Member record & Wallet
      const member = await createMember({
        name,
        mobile,
        email,
        passwordHash,
        address,
        pinCode: postalPinCode,
        kycStatus: "PENDING"
      }, tx);

      // 2. Validate & Redeem PIN if provided (Safeguard 1: Concurrency Lock inside tx)
      let quantityToProvision = 1;
      if (activationPinCode) {
        const redeemedPin = await pinService.validateAndRedeemPin(tx, activationPinCode, member.id, null);
        quantityToProvision = redeemedPin.quantity || 1;
      }

      // 3. Provision IDs in AutoPool & MY SYSTEM trees
      const createdCards = await purchaseIds(member.id, quantityToProvision, sponsorIdCardId, sponsorSide, tx);

      // 4. Fetch fresh member with generated memberCode & cards
      const fresh = await tx.member.findUnique({
        where: { id: member.id },
        include: { idCards: true }
      });

      const main = fresh.idCards.find(c => c.type === "MAIN") || fresh.idCards[0];

      return {
        freshMember: fresh,
        mainCard: main,
        newCards: createdCards,
        qty: quantityToProvision
      };
    }, { timeout: 30000 });

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
        member: {
          id: freshMember.id,
          memberCode: freshMember.memberCode,
          name: freshMember.name,
          mobile: freshMember.mobile,
          idCards: freshMember.idCards
        },
        token,
        cardsCreated: newCards.length,
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
    if (!validPassword) {
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

/**
 * Public Activation PIN Verification (Rate-limited, zero-auth).
 * Allows unauthenticated prospective registrants to validate their PIN
 * and see its ID capacity / value before submitting registration.
 */
async function verifyPin(req, res, next) {
  try {
    const pinService = require("../services/pinService");
    const { pinCode } = req.body;
    const pin = await pinService.validatePin(pinCode);

    res.json({
      success: true,
      message: `PIN ${pin.pinCode} is valid for ${pin.quantity} ID(s).`,
      data: {
        valid: true,
        pinCode: pin.pinCode,
        quantity: pin.quantity,
        pricePaise: pin.pricePaise
      }
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
  register,
  login,
  adminLogin,
  validateReferral,
  verifyPin
};
