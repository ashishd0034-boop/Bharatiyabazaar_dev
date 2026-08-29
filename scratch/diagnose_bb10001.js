const prisma = require("../src/lib/prisma");

async function diagnoseBB10001() {
  console.log("=== DIAGNOSING BB10001 ===");

  // 1. Find member by memberCode BB10001 or ID Card BB10001
  const member = await prisma.member.findFirst({
    where: {
      OR: [
        { memberCode: "BB10001" },
        { idCards: { some: { cardNumber: "BB10001" } } }
      ]
    },
    include: {
      mainWallet: {
        include: {
          ledgerEntries: {
            orderBy: { createdAt: "asc" }
          }
        }
      },
      idCards: {
        include: {
          commissionEntries: true
        }
      },
      purchasedPins: true,
      redeemedPins: true,
      withdrawals: true
    }
  });

  if (!member) {
    console.log("Member BB10001 not found in dev database! Checking all members...");
    const members = await prisma.member.findMany({
      select: { id: true, memberCode: true, name: true, mobile: true },
      take: 10
    });
    console.log("Found members:", members);
    return;
  }

  console.log("\n--- MEMBER INFO ---");
  console.log({
    id: member.id,
    memberCode: member.memberCode,
    name: member.name,
    mobile: member.mobile,
    createdAt: member.createdAt
  });

  console.log("\n--- 1. WALLET STATE ---");
  const wallet = member.mainWallet;
  console.log("Wallet:", {
    id: wallet?.id,
    balancePaise: wallet?.balancePaise,
    balanceINR: (wallet?.balancePaise || 0) / 100
  });

  // Calculate earnings from commission entries
  let totalCommissionsPaise = 0;
  let withdrawableCommissionsPaise = 0;
  let heldCommissionsPaise = 0;
  for (const card of member.idCards) {
    console.log(`Card ${card.cardNumber} (${card.type}, ACB: ${card.acbStatus}):`);
    for (const comm of card.commissionEntries) {
      totalCommissionsPaise += comm.amountPaise;
      if (comm.status === "WITHDRAWABLE" || comm.status === "CONFIRMED") {
        withdrawableCommissionsPaise += comm.amountPaise;
      } else {
        heldCommissionsPaise += comm.amountPaise;
      }
      console.log(`  - Commission: ₹${comm.amountPaise / 100} (${comm.stream} L${comm.level}, status: ${comm.status}, created: ${comm.createdAt})`);
    }
  }

  // Calculate withdrawals
  let totalWithdrawnGrossPaise = 0;
  let totalWithdrawnNetPaise = 0;
  for (const wd of member.withdrawals) {
    if (wd.status === "COMPLETED" || wd.status === "REQUESTED") {
      totalWithdrawnGrossPaise += wd.grossPaise;
      totalWithdrawnNetPaise += wd.netPaise;
    }
    console.log(`  - Withdrawal: Gross ₹${wd.grossPaise / 100}, Net ₹${wd.netPaise / 100}, Status: ${wd.status}, Date: ${wd.requestedAt}`);
  }

  console.log({
    totalCommissionsPaise,
    totalCommissionsINR: totalCommissionsPaise / 100,
    withdrawableCommissionsPaise,
    withdrawableCommissionsINR: withdrawableCommissionsPaise / 100,
    heldCommissionsPaise,
    heldCommissionsINR: heldCommissionsPaise / 100,
    totalWithdrawnGrossPaise,
    totalWithdrawnGrossINR: totalWithdrawnGrossPaise / 100
  });

  console.log("\n--- 2. LEDGER AUDIT ---");
  const ledger = wallet?.ledgerEntries || [];
  console.log(`Total ledger entries: ${ledger.length}`);
  let totalCreditsPaise = 0;
  let totalDebitsPaise = 0;
  let pinPurchaseDebitsCount = 0;
  let pinPurchaseDebitsTotalPaise = 0;

  for (const entry of ledger) {
    console.log(`  [${entry.type}] ₹${entry.amountPaise / 100} | Source: ${entry.source} | Ref: ${entry.referenceId} | Desc: "${entry.description}" | Before: ₹${entry.balanceBeforePaise / 100} | After: ₹${entry.balanceAfterPaise / 100} | Time: ${entry.createdAt.toISOString()}`);
    if (entry.type === "CREDIT") {
      totalCreditsPaise += entry.amountPaise;
    } else if (entry.type === "DEBIT") {
      totalDebitsPaise += entry.amountPaise;
      if (entry.source === "PIN_PURCHASE") {
        pinPurchaseDebitsCount++;
        pinPurchaseDebitsTotalPaise += entry.amountPaise;
      }
    }
  }

  console.log({
    totalCreditsPaise,
    totalCreditsINR: totalCreditsPaise / 100,
    totalDebitsPaise,
    totalDebitsINR: totalDebitsPaise / 100,
    netLedgerPaise: totalCreditsPaise - totalDebitsPaise,
    netLedgerINR: (totalCreditsPaise - totalDebitsPaise) / 100,
    pinPurchaseDebitsCount,
    pinPurchaseDebitsTotalPaise,
    pinPurchaseDebitsTotalINR: pinPurchaseDebitsTotalPaise / 100
  });

  console.log("\n--- 3. PIN PURCHASES ---");
  const purchasedPins = member.purchasedPins || [];
  console.log(`Total ActivationPins purchased by member: ${purchasedPins.length}`);
  let totalPinsQuantity = 0;
  let totalPinsPricePaise = 0;
  for (const pin of purchasedPins) {
    totalPinsQuantity += pin.quantity;
    totalPinsPricePaise += pin.pricePaise;
    console.log(`  - PIN: ${pin.pinCode} | Qty: ${pin.quantity} | Price: ₹${pin.pricePaise / 100} | Status: ${pin.status} | RedeemedBy: ${pin.redeemedByMemberId} | Created: ${pin.createdAt.toISOString()}`);
  }

  console.log({
    totalPinsCount: purchasedPins.length,
    totalPinsQuantity,
    totalPinsPricePaise,
    totalPinsPriceINR: totalPinsPricePaise / 100
  });

  // Check company wallet
  const companyWallet = await prisma.member.findUnique({
    where: { id: "COMPANY_WALLET" },
    include: { mainWallet: { include: { ledgerEntries: true } } }
  });
  console.log("\n--- COMPANY WALLET ---");
  console.log("Company wallet balance:", (companyWallet?.mainWallet?.balancePaise || 0) / 100);

  await prisma.$disconnect();
}

diagnoseBB10001().catch(err => {
  console.error("Diagnosis error:", err);
  process.exit(1);
});
