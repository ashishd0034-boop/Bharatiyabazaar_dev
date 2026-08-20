const prisma = require("/Users/ashishdubey/Desktop/coder/Bharatiya Bazaar/qewn/bb-backend/src/lib/prisma");

async function checkWalletImpact() {
  console.log("================================================================================");
  console.log("💰 CHECK WALLET & LEDGER IMPACT OF PHANTOM COMMISSIONS");
  console.log("================================================================================\n");

  const invalidCommIds = [
    "cmszruxpu0005xyq3l6izjv5a", // BB10007 AP L1
    "cmszruxpz0007xyq34lj90ygp", // BB10003 AP L2
    "cmszt6jip000783q3vxua32ym", // BB10008 AP L1
    "cmszt6jjz000h83q3iyc5x5x2", // BB10009 AP L1
    "cmszt6jk2000j83q39jpdgovk", // BB10004 AP L2
    "cmszt6jkk000t83q3zr99m9mz", // BB10010 AP L1
    "cmszt6jl1001583q35nrxn508", // BB10011 AP L1
    "cmszt6jl3001683q3xy18vmkp", // BB10005 AP L2
    "cmszt6jl5001883q3vy2y6ifj", // BB10002 AP L3 (WITHDRAWABLE - Rs.200!)
    "cmszxfzpe00080iq3gwi523o9", // BB10008 AP L1
    "cmszxfzq4000h0iq3p3stl12t", // BB10009 AP L1
    "cmszxfzq6000i0iq3ukk5b8p5", // BB10004 AP L2
    "cmszxfzqr000r0iq3j0lfrzf1", // BB10010 AP L1
    "cmszxfzre00120iq3v4zakiq6", // BB10011 AP L1
    "cmszxfzrj00130iq36v2hbent", // BB10002 AP L3
    "cmszxfzs4001d0iq3muoo49ok", // BB10012 AP L1
    "cmszxudlf00164sq3krdn1g3i"  // BB10012 AP L1
  ];

  console.log("Checking if any of these invalid commissions resulted in Wallet Ledger entries:");
  const ledgers = await prisma.ledgerEntry.findMany({
    where: {
      referenceId: { in: invalidCommIds }
    },
    include: {
      wallet: {
        include: {
          member: true
        }
      }
    }
  });

  console.log(`Found ${ledgers.length} ledger entries tied to invalid commissions:`);
  ledgers.forEach(l => {
    console.log(`  Ledger ID: ${l.id} | Wallet Member: ${l.wallet.member.memberCode} | Amount: Rs.${l.amountPaise / 100} | RefId: ${l.referenceId} | Desc: "${l.description}" | CreatedAt: ${l.createdAt.toISOString()}`);
  });

  console.log("\nChecking all wallets in database:");
  const wallets = await prisma.wallet.findMany({
    include: {
      member: true,
      ledgerEntries: true
    }
  });

  wallets.forEach(w => {
    const sumCredits = w.ledgerEntries.filter(e => e.type === "CREDIT").reduce((s, e) => s + e.amountPaise, 0);
    const sumDebits = w.ledgerEntries.filter(e => e.type === "DEBIT").reduce((s, e) => s + e.amountPaise, 0);
    console.log(`  Member: ${w.member.memberCode} (${w.member.name}) | Balance: Rs.${w.balancePaise / 100} (${w.balancePaise} paise) | Ledger Net: Rs.${(sumCredits - sumDebits) / 100} | Ledger count: ${w.ledgerEntries.length}`);
  });

  await prisma.$disconnect();
}

checkWalletImpact();
