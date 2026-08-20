const prisma = require("./src/lib/prisma");
const acbService = require("./src/services/acbService");

async function sweep() {
  console.log("\n🛡️ ACB SWEEP — checking every MAIN ID card...\n");
  const cards = await prisma.memberIdCard.findMany({
    where: { type: "MAIN" },
    include: { member: { select: { memberCode: true, name: true } } }
  });

  let unlocked = 0;
  for (const card of cards) {
    if (card.acbStatus) {
      console.log(`✓ ${card.member.memberCode} already ACB`);
      continue;
    }
    const ok = await acbService.checkAcbStatus(prisma, card.id);
    if (ok) {
      await acbService.unlockAcb(prisma, card.id);
      await acbService.unlockLockedEarnings(prisma, card.id);
      console.log(`🎉 UNLOCKED ACB for ${card.member.memberCode} (${card.member.name})`);
      unlocked++;
    } else {
      console.log(`… ${card.member.memberCode} not eligible yet`);
    }
  }
  console.log(`\nDone! Unlocked ${unlocked} member(s).\n`);
  await prisma.$disconnect();
}
sweep();
