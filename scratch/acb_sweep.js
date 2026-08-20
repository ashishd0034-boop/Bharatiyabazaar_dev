const prisma = require("../src/lib/prisma");
const acbService = require("../src/services/acbService");

async function runAcbSweep() {
  console.log("================================================================================");
  console.log("🌟 EXECUTING PERMANENT ACB SWEEP FOR ALL CARDS");
  console.log("================================================================================\n");

  const cards = await prisma.memberIdCard.findMany({
    include: {
      member: true,
      sponsoredNodes: true
    },
    orderBy: { cardNumber: "asc" }
  });

  const unlocked = [];

  await prisma.$transaction(async (tx) => {
    for (const card of cards) {
      const qualifies = await acbService.checkAcbStatus(tx, card.id);
      if (qualifies && !card.acbStatus) {
        const leftCount = card.sponsoredNodes.filter(n => n.side === "LEFT").length;
        const rightCount = card.sponsoredNodes.filter(n => n.side === "RIGHT").length;

        console.log(`✨ Unlocking ACB for Card ${card.cardNumber} (${card.type}):`);
        console.log(`   Owner Member: ${card.member.memberCode} (${card.member.name})`);
        console.log(`   Referrals: LEFT=${leftCount}, RIGHT=${rightCount}`);

        await acbService.unlockAcb(tx, card.id);
        await acbService.unlockLockedEarnings(tx, card.id);

        unlocked.push({ cardNumber: card.cardNumber, type: card.type, owner: card.member.memberCode });
      }
    }
  });

  console.log(`\n✅ ACB Sweep complete. Unlocked ${unlocked.length} card(s):\n`);
  for (const u of unlocked) {
    console.log(`   - ${u.cardNumber} (${u.type}) owned by ${u.owner}`);
  }
}

runAcbSweep().catch(console.error).finally(() => prisma.$disconnect());
