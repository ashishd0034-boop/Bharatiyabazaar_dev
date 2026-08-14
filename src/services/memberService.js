const prisma = require("../lib/prisma");

async function createMember(args) {
  // Create member
  const member = await prisma.member.create({
    data: {
      name: args.name,
      mobile: args.mobile,
      email: args.email,
      address: args.address,
      pinCode: args.pinCode,
      kycTier: 1,
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

module.exports = {
  createMember,
  getMemberById,
  getMemberByMobile
};