const prisma = require("./src/lib/prisma");

async function main() {
  const member = await prisma.member.findUnique({ where: { memberCode: "BB10001" } });
  const cards = await prisma.memberIdCard.findMany({ where: { memberId: member.id } });
  const cardIds = cards.map(c => c.id);

  const commissions = await prisma.commissionEntry.findMany({
    where: { idCardId: { in: cardIds } },
    orderBy: { createdAt: "asc" }
  });

  console.log(`\n📋 Commissions for BB10001 (${commissions.length} entries):\n`);
  commissions.forEach((c, i) => {
    const amt = 'Rs.' + (c.amountPaise / 100).toFixed(2);
    console.log(`${i + 1}. [${c.stream}] L${c.level} | ${amt} | ${c.status}`);
  });

  const wallet = await prisma.wallet.findUnique({ where: { memberId: member.id } });
  console.log(`\n💰 Wallet balance: Rs.${((wallet?.balancePaise || 0) / 100).toFixed(2)}`);

  // Count actual pool nodes under position 1 at each level
  const nodes = await prisma.autoPoolNode.findMany();
  const under1 = nodes.filter(n => {
    let p = n.globalPosition;
    while (p > 1) {
      p = Math.floor(p / 2);
      if (p === 1) return true;
    }
    return n.globalPosition === 1;
  });
  console.log(`\n🌀 AutoPool nodes under BB10001: ${under1.length}`);
  for (let L = 1; L <= 3; L++) {
    const count = under1.filter(n => n.depthLevel === L).length;
    const required = Math.pow(2, L);
    console.log(`   L${L}: ${count}/${required} ${count === required ? '✓ COMPLETE' : 'incomplete'}`);
  }

  await prisma.$disconnect();
}
main();
