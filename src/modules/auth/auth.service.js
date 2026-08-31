const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const prisma = require("../../core/database/prisma");
const { createMember } = require("../member/member.service");
const { purchaseIds } = require("../../services/idCardService");
const pinService = require("../../services/pinService");

const JWT_SECRET = process.env.JWT_SECRET;

async function validateReferralCode(code) {
  const cleanCode = (code || "").trim().toUpperCase();
  if (!cleanCode) {
    const err = new Error("Code required");
    err.status = 400;
    err.code = "BAD_REQUEST";
    throw err;
  }

  // Check if this code belongs to a REBIRTH card
  const rebirthCard = await prisma.memberIdCard.findFirst({
    where: { cardNumber: cleanCode, type: "REBIRTH" }
  });
  if (rebirthCard) {
    const err = new Error("REBIRTH IDs cannot sponsor new members (placed automatically via global AutoPool)");
    err.status = 400;
    err.code = "REBIRTH_CANNOT_SPONSOR";
    throw err;
  }

  const sponsor = await prisma.member.findFirst({
    where: {
      OR: [
        { memberCode: cleanCode },
        { idCards: { some: { cardNumber: cleanCode, type: { in: ["MAIN", "SUB"] } } } }
      ]
    },
    include: {
      idCards: true
    }
  });

  if (!sponsor) {
    const err = new Error("Sponsor not found");
    err.status = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const specificCard = sponsor.idCards?.find(c => c.cardNumber === cleanCode && c.type !== "REBIRTH");
  const displayCode = specificCard ? specificCard.cardNumber : sponsor.memberCode;

  return {
    name: sponsor.name,
    memberCode: displayCode,
    valid: true
  };
}

async function registerMember(registrationData) {
  const { name, mobile, email, address, pinCode, password, referralCode, side, activationPin, pin, postalCode } = registrationData;

  const existingMember = await prisma.member.findUnique({ where: { mobile } });
  if (existingMember) {
    const err = new Error("Mobile number already registered");
    err.status = 409;
    err.code = "CONFLICT";
    throw err;
  }

  let sponsorIdCardId = null;

  if (referralCode && referralCode.trim()) {
    const cleanRef = referralCode.trim().toUpperCase();

    // Reject REBIRTH IDs from sponsoring
    const rebirthCard = await prisma.memberIdCard.findFirst({
      where: { cardNumber: cleanRef, type: "REBIRTH" }
    });
    if (rebirthCard) {
      const err = new Error("REBIRTH IDs cannot sponsor new members (placed automatically via global AutoPool)");
      err.status = 400;
      err.code = "REBIRTH_CANNOT_SPONSOR";
      throw err;
    }

    const sponsor = await prisma.member.findFirst({
      where: {
        OR: [
          { memberCode: cleanRef },
          { idCards: { some: { cardNumber: cleanRef, type: { in: ["MAIN", "SUB"] } } } }
        ]
      },
      include: {
        idCards: true
      }
    });

    if (!sponsor) {
      const err = new Error("Invalid sponsor code");
      err.status = 400;
      err.code = "BAD_REQUEST";
      throw err;
    }

    const specificCard = sponsor.idCards?.find(c => c.cardNumber === cleanRef && c.type !== "REBIRTH");
    const sponsorCard = specificCard || sponsor.idCards?.find(c => c.type === "MAIN") || sponsor.idCards?.[0];
    if (sponsorCard) sponsorIdCardId = sponsorCard.id;
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
    const err = new Error("Activation PIN is required for registration.");
    err.status = 400;
    err.code = "PIN_REQUIRED";
    throw err;
  }

  let postalPinCode = pinCode;
  if (typeof pinCode === "string" && pinCode.trim().toUpperCase().startsWith("PIN-")) {
    postalPinCode = postalCode || null;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const sponsorSide = (side === "LEFT" || side === "RIGHT") ? side : "LEFT";

  // Atomic Transaction covering Member creation, PIN redemption, and Tree placement
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

    // 2. Validate & Redeem PIN if provided
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

  return {
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
  };
}

async function authenticateMember(identifier, password) {
  const input = (identifier || "").trim();

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
    const err = new Error("Invalid credentials");
    err.status = 401;
    err.code = "UNAUTHORIZED";
    throw err;
  }

  const validPassword = await bcrypt.compare(password, member.passwordHash);
  if (!validPassword) {
    const err = new Error("Invalid credentials");
    err.status = 401;
    err.code = "UNAUTHORIZED";
    throw err;
  }

  const matchedCard = member.idCards.find(c => c.cardNumber.toUpperCase() === input.toUpperCase());
  const mainCard = member.idCards.find(c => c.type === "MAIN") || member.idCards[0];

  const activeLoginCard = matchedCard || mainCard;
  const loginCardNumber = activeLoginCard ? activeLoginCard.cardNumber : member.memberCode;
  const loginCardType = activeLoginCard ? activeLoginCard.type : "MAIN";
  const loginCardId = activeLoginCard ? activeLoginCard.id : null;

  const token = jwt.sign({
    id: member.id,
    type: "MEMBER",
    loginCardId,
    loginCardNumber,
    loginCardType
  }, JWT_SECRET, { expiresIn: "7d" });

  return {
    member: {
      id: member.id,
      memberCode: member.memberCode,
      name: member.name,
      mobile: member.mobile
    },
    loginContext: {
      cardNumber: loginCardNumber,
      cardType: loginCardType,
      isSubCard: loginCardType !== "MAIN",
      ownerMemberCode: member.memberCode
    },
    token
  };
}

async function authenticateAdmin(email, password) {
  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin || !admin.passwordHash) {
    const err = new Error("Invalid credentials");
    err.status = 401;
    err.code = "UNAUTHORIZED";
    throw err;
  }

  const validPassword = await bcrypt.compare(password, admin.passwordHash);
  if (!validPassword) {
    const err = new Error("Invalid credentials");
    err.status = 401;
    err.code = "UNAUTHORIZED";
    throw err;
  }

  const token = jwt.sign({ id: admin.id, type: "ADMIN", role: admin.role }, JWT_SECRET, { expiresIn: "1d" });

  return {
    admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
    token
  };
}

async function verifyPin(pinCode) {
  const pin = await pinService.validatePin(pinCode);
  return {
    valid: true,
    pinCode: pin.pinCode,
    quantity: pin.quantity,
    pricePaise: pin.pricePaise
  };
}

module.exports = {
  validateReferralCode,
  registerMember,
  authenticateMember,
  authenticateAdmin,
  verifyPin
};
