const prisma = require("../lib/prisma");

async function hasAlreadyPaid(tx, idCardId, level) {
  const record = await tx.payOnceLedger.findUnique({
    where: {
      idCardId_level: {
        idCardId,
        level
      }
    }
  });
  return !!record;
}

async function recordPayment(tx, idCardId, level, paidVia) {
  return await tx.payOnceLedger.create({
    data: {
      idCardId,
      level,
      paidVia
    }
  });
}

module.exports = {
  hasAlreadyPaid,
  recordPayment
};
