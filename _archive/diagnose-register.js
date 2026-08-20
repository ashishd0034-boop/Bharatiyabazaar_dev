const prisma = require("./src/lib/prisma");

async function main() {
  const orphans = await prisma.member.findMany({
    where: { idCards: { none: {} } },
    select: { id: true, name: true, mobile: true, memberCode: true, createdAt: true }
  });

  console.log("\n👥 Members WITHOUT ID cards (failed registrations):");
  if (orphans.length === 0) console.log("  (none)");
  orphans.forEach(m => console.log(`  - ${m.name} | ${m.mobile} | ${m.memberCode || 'no code'}`));

  const counter = await prisma.systemCounter.findUnique({ where: { id: "AUTOPOOL_GLOBAL" } });
  const maxNode = await prisma.autoPoolNode.findFirst({ orderBy: { globalPosition: "desc" } });
  const cards = await prisma.memberIdCard.findMany({ orderBy: { cardNumber: "desc" }, take: 1 });

  console.log(`\n🔢 Counter: ${counter?.currentValue} | Max pool position: ${maxNode?.globalPosition} | Last card: ${cards[0]?.cardNumber}`);
  console.log(counter?.currentValue === maxNode?.globalPosition ? "✅ Counter in sync" : "❌ COUNTER OUT OF SYNC!");
  await prisma.$disconnect();
}
main();
