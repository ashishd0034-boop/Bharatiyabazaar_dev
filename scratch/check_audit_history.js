const prisma = require("/Users/ashishdubey/Desktop/coder/Bharatiya Bazaar/qewn/bb-backend/src/lib/prisma");

async function checkHistory() {
  console.log("=== AUDIT LOGS ===");
  const auditLogs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50
  });
  console.log(`Found ${auditLogs.length} audit logs:`);
  auditLogs.forEach(a => console.log(a));

  console.log("\n=== ALL MEMBERS IN DB ===");
  const members = await prisma.member.findMany({
    include: {
      idCards: {
        include: { autoPoolNode: true }
      }
    },
    orderBy: { createdAt: 'asc' }
  });
  console.log(`Found ${members.length} members:`);
  members.forEach(m => {
    console.log(`  ${m.memberCode} | ${m.name} | ${m.mobile} | Cards: ${m.idCards.map(c => `${c.cardNumber} (AP #${c.autoPoolNode?.globalPosition})`).join(', ')} | Created: ${m.createdAt.toISOString()}`);
  });

  console.log("\n=== ALL COMMISSION ENTRIES IN DB ===");
  const comms = await prisma.commissionEntry.findMany({
    include: {
      idCard: {
        include: { member: true }
      }
    },
    orderBy: { createdAt: 'asc' }
  });
  console.log(`Found ${comms.length} commission entries:`);
  comms.forEach(c => {
    console.log(`  ID: ${c.id} | Card: ${c.idCard.cardNumber} (${c.idCard.member.memberCode}) | Stream: ${c.stream} L${c.level} | Rs.${c.amountPaise / 100} | Status: ${c.status} | CreatedAt: ${c.createdAt.toISOString()}`);
  });

  console.log("\n=== SYSTEM COUNTER ===");
  const counters = await prisma.systemCounter.findMany();
  console.log(counters);

  await prisma.$disconnect();
}

checkHistory();
