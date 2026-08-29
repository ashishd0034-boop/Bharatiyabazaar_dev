const prisma = require("../src/lib/prisma");

async function checkAllLedgersAndWallets() {
  console.log("=== ALL WALLETS IN SYSTEM ===");
  const wallets = await prisma.wallet.findMany({
    include: { member: true }
  });
  for (const w of wallets) {
    console.log(`Wallet ${w.id} | Member: ${w.member?.memberCode || w.memberId} | Name: ${w.member?.name} | Balance: ₹${w.balancePaise / 100}`);
  }

  console.log("\n=== ALL ACTIVATION PINS IN SYSTEM ===");
  const pins = await prisma.activationPin.findMany({
    include: {
      purchasedByMember: { select: { memberCode: true, name: true } },
      redeemedByMember: { select: { memberCode: true, name: true } }
    },
    orderBy: { createdAt: "asc" }
  });
  for (const p of pins) {
    console.log(`PIN: ${p.pinCode} | Qty: ${p.quantity} | Price: ₹${p.pricePaise / 100} | Status: ${p.status} | Buyer: ${p.purchasedByMember?.memberCode} | RedeemedBy: ${p.redeemedByMember?.memberCode} | Created: ${p.createdAt.toISOString()} | Redeemed: ${p.redeemedAt ? p.redeemedAt.toISOString() : "null"}`);
  }

  console.log("\n=== ALL LEDGER ENTRIES IN SYSTEM ===");
  const allLedgers = await prisma.ledgerEntry.findMany({
    orderBy: { createdAt: "asc" },
    include: { wallet: { include: { member: true } } }
  });
  for (const l of allLedgers) {
    console.log(`[${l.createdAt.toISOString()}] Wallet: ${l.wallet.member?.memberCode || l.wallet.memberId} | ${l.type} ₹${l.amountPaise / 100} | Src: ${l.source} | Ref: ${l.referenceId} | Bal: ₹${l.balanceBeforePaise / 100} -> ₹${l.balanceAfterPaise / 100} | ${l.description}`);
  }

  await prisma.$disconnect();
}

checkAllLedgersAndWallets().catch(console.error);
