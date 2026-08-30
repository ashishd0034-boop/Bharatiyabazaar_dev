const ledgerService = require("./ledger.service");
const prisma = require("../database/prisma");

async function credit(tx, memberId, amountPaise, source, referenceId = null, description = null) {
  if (amountPaise <= 0) return null; // Ignore zero or negative credits

  // Atomic upsert ensures race conditions are impossible during credit.
  const updatedWallet = await tx.wallet.upsert({
    where: { memberId },
    update: { balancePaise: { increment: amountPaise } },
    create: { memberId, balancePaise: amountPaise }
  });

  const balanceAfter = updatedWallet.balancePaise;
  const balanceBefore = balanceAfter - amountPaise;

  // Append strictly to Ledger
  const ledger = await ledgerService.createEntry(tx, {
    walletId: updatedWallet.id,
    type: "CREDIT",
    amountPaise,
    balanceBeforePaise: balanceBefore,
    balanceAfterPaise: balanceAfter,
    source,
    referenceId,
    description
  });

  return { wallet: updatedWallet, ledger };
}

async function debit(tx, memberId, amountPaise, source, referenceId = null, description = null) {
  if (amountPaise <= 0) return null;

  // Since we don't upsert on debit (can't debit if wallet doesn't exist),
  // we do an update with decrement. This is atomic at the database level.
  let updatedWallet;
  try {
    updatedWallet = await tx.wallet.update({
      where: { memberId },
      data: {
        balancePaise: {
          decrement: amountPaise
        }
      }
    });
  } catch (error) {
    if (error.code === 'P2025') { // Prisma RecordNotFound
      throw new Error(`Insufficient funds for member ${memberId}.`);
    }
    throw error;
  }

  // Insufficient Funds Validation
  if (updatedWallet.balancePaise < 0) {
    throw new Error(`Insufficient funds for member ${memberId}.`);
  }

  const balanceAfter = updatedWallet.balancePaise;
  const balanceBefore = balanceAfter + amountPaise;

  const ledger = await ledgerService.createEntry(tx, {
    walletId: updatedWallet.id,
    type: "DEBIT",
    amountPaise,
    balanceBeforePaise: balanceBefore,
    balanceAfterPaise: balanceAfter,
    source,
    referenceId,
    description
  });

  return { wallet: updatedWallet, ledger };
}

async function getWalletBalance(memberId) {
  const wallet = await prisma.wallet.findUnique({
    where: { memberId }
  });
  
  if (!wallet) {
    return { balancePaise: 0 };
  }
  
  return wallet;
}

async function getLedgerHistory(memberId, limit = 50, offset = 0) {
  const wallet = await prisma.wallet.findUnique({
    where: { memberId },
    include: {
      ledgerEntries: {
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset
      }
    }
  });
  
  if (!wallet) {
    return [];
  }
  
  return wallet.ledgerEntries;
}

/**
 * Adjust wallet balance for authorized administrative adjustments.
 * deltaPaise > 0 performs an ADMIN_ADJUSTMENT credit.
 * deltaPaise < 0 performs an ADMIN_ADJUSTMENT debit.
 */
async function adjustBalance(tx, memberId, deltaPaise, reason = "Administrative adjustment", referenceId = null) {
  if (!deltaPaise || deltaPaise === 0) return null;

  if (deltaPaise > 0) {
    return await credit(tx, memberId, deltaPaise, "ADMIN_ADJUSTMENT", referenceId, reason);
  } else {
    return await debit(tx, memberId, Math.abs(deltaPaise), "ADMIN_ADJUSTMENT", referenceId, reason);
  }
}

module.exports = { credit, debit, adjustBalance, getWalletBalance, getLedgerHistory };
