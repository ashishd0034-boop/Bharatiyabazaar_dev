const prisma = require("../src/lib/prisma");

async function generateInventory() {
  const [
    members,
    wallets,
    ledgerEntries,
    pins,
    idCards,
    autopoolCount,
    mysystemCount,
    adminUsers,
    vendors,
    settingsCount
  ] = await Promise.all([
    prisma.member.findMany({
      include: {
        idCards: true,
        mainWallet: true
      },
      orderBy: { createdAt: "asc" }
    }),
    prisma.wallet.findMany({
      include: {
        member: { select: { memberCode: true, name: true } }
      },
      orderBy: { createdAt: "asc" }
    }),
    prisma.ledgerEntry.findMany({
      include: {
        wallet: {
          include: {
            member: { select: { memberCode: true } }
          }
        }
      }
    }),
    prisma.activationPin.findMany({
      include: {
        purchasedByMember: { select: { memberCode: true } },
        redeemedByMember: { select: { memberCode: true } }
      },
      orderBy: { createdAt: "asc" }
    }),
    prisma.memberIdCard.findMany({
      include: {
        member: { select: { memberCode: true } }
      },
      orderBy: { createdAt: "asc" }
    }),
    prisma.autoPoolNode.count(),
    prisma.mySystemNode.count(),
    prisma.adminUser.findMany({
      select: { email: true, role: true, name: true, createdAt: true },
      orderBy: { createdAt: "asc" }
    }),
    prisma.vendor.findMany({
      select: {
        id: true,
        businessName: true,
        category: true,
        status: true,
        marginRatePct: true,
        walletBalancePaise: true,
        joinedAt: true,
        member: { select: { memberCode: true, mobile: true } }
      },
      orderBy: { joinedAt: "asc" }
    }),
    prisma.platformSetting.count()
  ]);

  // Aggregate ledger per wallet
  const ledgerByWallet = {};
  for (const entry of ledgerEntries) {
    if (!ledgerByWallet[entry.walletId]) {
      ledgerByWallet[entry.walletId] = {
        walletId: entry.walletId,
        memberCode: entry.wallet?.member?.memberCode || entry.wallet?.memberId || "UNKNOWN",
        count: 0,
        creditsPaise: 0,
        debitsPaise: 0
      };
    }
    ledgerByWallet[entry.walletId].count++;
    if (entry.type === "CREDIT") {
      ledgerByWallet[entry.walletId].creditsPaise += entry.amountPaise;
    } else if (entry.type === "DEBIT") {
      ledgerByWallet[entry.walletId].debitsPaise += entry.amountPaise;
    }
  }

  console.log(JSON.stringify({
    members: members.map(m => ({
      memberCode: m.memberCode,
      name: m.name,
      mobile: m.mobile,
      kycStatus: m.kycStatus,
      idCardCount: m.idCards.length,
      walletBalanceRs: m.mainWallet ? (m.mainWallet.balancePaise / 100).toFixed(2) : "0.00",
      createdAt: m.createdAt.toISOString()
    })),
    wallets: wallets.map(w => ({
      walletId: w.id,
      memberId: w.memberId,
      ownerMemberCode: w.member?.memberCode || w.memberId,
      ownerName: w.member?.name || "System Reserve / Service",
      balancePaise: w.balancePaise,
      balanceRs: (w.balancePaise / 100).toFixed(2)
    })),
    ledgerSummary: Object.values(ledgerByWallet).map(l => ({
      walletId: l.walletId,
      memberCode: l.memberCode,
      entryCount: l.count,
      creditsRs: (l.creditsPaise / 100).toFixed(2),
      debitsRs: (l.debitsPaise / 100).toFixed(2),
      netLedgerRs: ((l.creditsPaise - l.debitsPaise) / 100).toFixed(2)
    })),
    pins: pins.map(p => ({
      pinCode: p.pinCode,
      quantity: p.quantity,
      pricePaise: p.pricePaise,
      priceRs: (p.pricePaise / 100).toFixed(2),
      status: p.status,
      purchasedBy: p.purchasedByMember?.memberCode || p.purchasedByMemberId,
      redeemedBy: p.redeemedByMember?.memberCode || p.redeemedByMemberId || "—",
      createdAt: p.createdAt.toISOString()
    })),
    idCards: idCards.map(c => ({
      cardNumber: c.cardNumber,
      type: c.type,
      status: c.status || (c.acbStatus ? "ACTIVE" : "INACTIVE"),
      ownerMemberCode: c.member?.memberCode || c.memberId
    })),
    treeNodes: {
      autopoolCount,
      mysystemCount
    },
    adminUsers,
    vendors: vendors.map(v => ({
      id: v.id,
      businessName: v.businessName,
      category: v.category,
      marginRatePct: v.marginRatePct,
      status: v.status,
      walletBalanceRs: (v.walletBalancePaise / 100).toFixed(2),
      memberCode: v.member?.memberCode || "—",
      mobile: v.member?.mobile || "—",
      joinedAt: v.joinedAt.toISOString()
    })),
    settingsCount
  }, null, 2));
}

generateInventory()
  .then(() => prisma.$disconnect())
  .catch(err => {
    console.error("Inventory error:", err);
    prisma.$disconnect();
    process.exit(1);
  });
