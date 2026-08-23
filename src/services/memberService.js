const prisma = require("../lib/prisma");

// Generates sequential, human-readable member codes: BB10001, BB10002, ...
async function generateMemberCode() {
  try {
    const counter = await prisma.systemCounter.upsert({
      where: { id: "MEMBER_CODE" },
      update: { currentValue: { increment: 1 } },
      create: { id: "MEMBER_CODE", currentValue: 10001 },
    });
    return `BB${counter.currentValue}`;
  } catch (err) {
    // Race-safety: if two registrations hit at the same millisecond
    if (err.code === "P2002") {
      const target = err.meta?.target;
      let field = "a unique field";
      if (Array.isArray(target)) field = target.join(", ");
      else if (typeof target === "string") field = target;
      
      throw new Error(`This ${field} is already registered`);
    }
    throw err; // Re-throw other errors
  }
}

// Creates a new member with a temporary placeholder memberCode.
// The permanent memberCode is assigned in idCardService.purchaseIds matching the MAIN card number (BBxxxxx).
async function createMember(args) {
  const tempCode = `TEMP_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // Create member
  const member = await prisma.member.create({
    data: {
      name: args.name,
      mobile: args.mobile,
      email: args.email,
      address: args.address,
      pinCode: args.pinCode,
      memberCode: tempCode,
      kycTier: args.kycTier || "NONE",
      kycStatus: args.kycStatus || "PENDING",
      status: "ACTIVE"
    }
  });

  // Create wallet for member
  await prisma.wallet.create({
    data: {
      memberId: member.id,
      balancePaise: 0
    }
  });

  return member;
}

async function getMemberById(id) {
  return prisma.member.findUnique({
    where: { id },
    include: {
      idCards: true,
      mainWallet: true
    }
  });
}

async function getMemberByMobile(mobile) {
  return prisma.member.findUnique({
    where: { mobile },
    include: {
      idCards: true,
      mainWallet: true
    }
  });
}

// For sponsor/referral lookups (BB10001 → member)
async function getMemberByCode(memberCode) {
  return prisma.member.findUnique({
    where: { memberCode },
    include: {
      idCards: true,
      mainWallet: true
    }
  });
}

module.exports = {
  createMember,
  getMemberById,
  getMemberByMobile,
  getMemberByCode
};