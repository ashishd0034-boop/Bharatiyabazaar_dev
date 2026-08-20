const prisma = require("../src/lib/prisma");

async function checkLockedEarnings() {
  const cards = ["SB10019", "SB10020"];
  for (const cn of cards) {
    const card = await prisma.memberIdCard.findUnique({
      where: { cardNumber: cn },
      include: {
        commissionEntries: true
      }
    });
    console.log(`Card ${cn} commissions count: ${card.commissionEntries.length}`);
    for (const c of card.commissionEntries) {
      console.log(`  - Commission: id=${c.id}, amount=Rs.${c.amountPaise/100}, stream=${c.stream}, status=${c.status}, level=${c.level}`);
    }
  }
}

checkLockedEarnings().catch(console.error).finally(() => prisma.$disconnect());
