const prisma = require("../database/prisma");

async function hasAlreadyPaid(tx, idCardId, level) {
  const db = tx || prisma;
  const record = await db.payOnceLedger.findUnique({
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
  const db = tx || prisma;
  return await db.payOnceLedger.create({
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
