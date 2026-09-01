const prisma = require("../../core/database/prisma");
const mySystemService = require("../my-system/my-system.service");
const autopoolService = require("../autopool/autopool.service");

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
    if (err.code === "P2002") {
      const target = err.meta?.target;
      let field = "a unique field";
      if (Array.isArray(target)) field = target.join(", ");
      else if (typeof target === "string") field = target;
      
      throw new Error(`This ${field} is already registered`);
    }
    throw err;
  }
}

// Creates a new member with a temporary placeholder memberCode.
async function createMember(args, tx = null) {
  const db = tx || prisma;
  const tempCode = `TEMP_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // Create member
  const member = await db.member.create({
    data: {
      name: args.name,
      mobile: args.mobile,
      email: args.email,
      passwordHash: args.passwordHash,
      address: args.address,
      pinCode: args.pinCode,
      memberCode: tempCode,
      kycTier: args.kycTier || "NONE",
      kycStatus: args.kycStatus || "PENDING",
      status: "ACTIVE"
    }
  });

  // Create wallet for member
  await db.wallet.create({
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

async function getMemberByCode(memberCode) {
  return prisma.member.findUnique({
    where: { memberCode },
    include: {
      idCards: true,
      mainWallet: true
    }
  });
}

async function getMemberProfile(memberId, loginContext) {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    include: {
      mainWallet: true,
      idCards: {
        include: {
          autoPoolNode: true
        }
      },
      vouchers: true
    }
  });

  if (!member) {
    const err = new Error("Member not found");
    err.status = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  delete member.passwordHash;

  const activeCard = member.idCards.find(c => c.cardNumber === loginContext?.loginCardNumber) || 
                     member.idCards.find(c => c.type === "MAIN") || 
                     member.idCards[0];

  const resolvedLoginContext = {
    cardNumber: activeCard ? activeCard.cardNumber : member.memberCode,
    cardType: activeCard ? activeCard.type : "MAIN",
    isSubCard: activeCard ? activeCard.type !== "MAIN" : false,
    loginCardId: activeCard ? activeCard.id : null,
    loginCardNumber: activeCard ? activeCard.cardNumber : member.memberCode,
    loginCardType: activeCard ? activeCard.type : "MAIN",
    ownerMemberCode: member.memberCode
  };

  return {
    ...member,
    activeCard: activeCard ? {
      id: activeCard.id,
      cardNumber: activeCard.cardNumber,
      type: activeCard.type,
      acbStatus: activeCard.acbStatus
    } : null,
    loginContext: resolvedLoginContext
  };
}

async function submitKyc(memberId, kycData) {
  const { panNumber, panCardUrl, aadhaarFrontUrl, aadhaarBackUrl } = kycData;

  const updated = await prisma.member.update({
    where: { id: memberId },
    data: {
      panNumber,
      kycStatus: "PENDING"
    }
  });

  return updated;
}

async function checkAvailability({ mobile, email }) {
  if (!mobile) {
    const err = new Error("Mobile is required");
    err.status = 400;
    err.code = "BAD_REQUEST";
    throw err;
  }

  const existingMobile = await prisma.member.findUnique({ where: { mobile } });
  if (existingMobile) {
    return {
      available: false,
      reason: "mobile",
      message: "This mobile number is already registered"
    };
  }

  if (email) {
    const existingEmail = await prisma.member.findFirst({ where: { email } });
    if (existingEmail) {
      return {
        available: false,
        reason: "email",
        message: "This email is already registered"
      };
    }
  }

  return { available: true };
}

// Delegated to mySystemService
async function getMySystemTree(memberId, loginContext) {
  return await mySystemService.getGenealogyTree(memberId, loginContext);
}

async function getMyPlacement(memberId, loginContext) {
  return await mySystemService.getMyPlacement(memberId, loginContext);
}

async function getMyReferralCount(memberId, loginContext) {
  return await mySystemService.getDirectReferralCounts(memberId, loginContext);
}

// Delegated to autopoolService
async function getAutoPoolTree(memberId, loginContext) {
  return await autopoolService.getAutoPoolTree(memberId, loginContext);
}

async function getAutoPoolExplorer(root, depth = 7, memberId, loginContext) {
  return await autopoolService.getAutoPoolExplorer(root, depth, memberId, loginContext);
}

async function getMemberNotificationFeed(memberId) {
  const [ledgerEntries, withdrawals, rebirthCards, acbCards, referralBonuses, vouchers] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: {
        wallet: { memberId },
        type: "CREDIT"
      },
      orderBy: { createdAt: "desc" },
      take: 30
    }),
    prisma.withdrawal.findMany({
      where: { memberId },
      orderBy: { requestedAt: "desc" },
      take: 20
    }),
    prisma.memberIdCard.findMany({
      where: { memberId, type: "REBIRTH" },
      orderBy: { createdAt: "desc" },
      take: 20
    }),
    prisma.memberIdCard.findMany({
      where: { memberId, acbStatus: true },
      orderBy: { createdAt: "desc" },
      take: 20
    }),
    prisma.vendorReferralBonus.findMany({
      where: { memberId },
      orderBy: { createdAt: "desc" },
      take: 20
    }),
    prisma.voucher.findMany({
      where: { memberId },
      orderBy: { issuedAt: "desc" },
      take: 20
    })
  ]);

  const notifications = [];

  // 1. Ledger Entries
  for (const l of ledgerEntries) {
    notifications.push({
      id: `ledger-${l.id}`,
      type: "WALLET_CREDIT",
      category: "COMMISSION",
      title: "Wallet Credit Received",
      message: `₹${(l.amountPaise / 100).toFixed(2)} credited to your wallet (${l.description || l.source})`,
      timestamp: l.createdAt.toISOString()
    });
  }

  // 2. Withdrawals
  for (const w of withdrawals) {
    notifications.push({
      id: `wd-${w.id}`,
      type: "WITHDRAWAL_STATUS",
      category: "WITHDRAWAL",
      title: `Withdrawal ${w.status}`,
      message: `Withdrawal request for ₹${(w.grossPaise / 100).toFixed(2)} via ${w.method} is currently ${w.status}${w.rejectionReason ? ': ' + w.rejectionReason : ''}`,
      timestamp: (w.completedAt || w.requestedAt).toISOString()
    });
  }

  // 3. Rebirth Cards
  for (const r of rebirthCards) {
    notifications.push({
      id: `rebirth-${r.id}`,
      type: "REBIRTH_GENERATED",
      category: "LIFECYCLE",
      title: "Rebirth ID Generated 🎉",
      message: `Rebirth ID Card #${r.cardNumber} was auto-generated and placed into the AutoPool tree.`,
      timestamp: r.createdAt.toISOString()
    });
  }

  // 4. ACB Cards
  for (const a of acbCards) {
    notifications.push({
      id: `acb-${a.id}`,
      type: "ACB_UNLOCKED",
      category: "LIFECYCLE",
      title: "ACB Qualification Achieved 🚀",
      message: `Card #${a.cardNumber} has unlocked Active Commission Beneficiary (ACB) status for AutoPool payouts.`,
      timestamp: (a.acbUnlockedAt || a.createdAt).toISOString()
    });
  }

  // 5. Referral Bonuses
  for (const b of referralBonuses) {
    notifications.push({
      id: `ref-${b.id}`,
      type: "REFERRAL_BONUS",
      category: "SETU_KOSH",
      title: "Merchant Referral Bonus",
      message: `Earned ₹${(b.bonusPaise / 100).toFixed(2)} referral bonus from store purchase (Status: ${b.status}).`,
      timestamp: b.createdAt.toISOString()
    });
  }

  // 6. Vouchers
  for (const v of vouchers) {
    notifications.push({
      id: `voucher-${v.id}`,
      type: "VOUCHER_ISSUED",
      category: "COMMISSION",
      title: "Reward Voucher Issued 🎁",
      message: `Reward voucher worth ₹${(v.faceValuePaise / 100).toFixed(2)} issued (Status: ${v.status}).`,
      timestamp: (v.issuedAt || v.createdAt).toISOString()
    });
  }

  notifications.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return notifications.slice(0, 50);
}

module.exports = {
  generateMemberCode,
  createMember,
  getMemberById,
  getMemberByMobile,
  getMemberByCode,
  getMemberProfile,
  submitKyc,
  checkAvailability,
  getMySystemTree,
  getAutoPoolTree,
  getMyPlacement,
  getMyReferralCount,
  getAutoPoolExplorer,
  getMemberNotificationFeed
};
