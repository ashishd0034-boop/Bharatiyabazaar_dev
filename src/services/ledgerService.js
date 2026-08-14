async function createEntry(tx, { walletId, type, amountPaise, balanceBeforePaise, balanceAfterPaise, source, referenceId, description }) {
  // Ledger immutability rule: strictly append-only.
  return await tx.ledgerEntry.create({
    data: {
      walletId,
      type,
      amountPaise,
      balanceBeforePaise,
      balanceAfterPaise,
      source,
      referenceId,
      description
    }
  });
}

module.exports = { createEntry };
